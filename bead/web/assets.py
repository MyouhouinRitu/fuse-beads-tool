"""原图存储、清理与上传/访问路由。"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re

from flask import Blueprint, jsonify, request, send_file

from bead import compress as comp
from bead.web.common import (
    DEFAULT_TARGET_PIXELS,
    BeadConfig,
    cfg,
    err,
    opt_bool,
    opt_int,
    safe_name,
)

ORIGINAL_ID_RE = re.compile(r"^[0-9a-f]{64}$")

assets_bp = Blueprint("assets", __name__)


def original_path(original_id: str) -> str | None:
    if not ORIGINAL_ID_RE.match(original_id or ""):
        return None
    return os.path.join(cfg().original_dir, original_id)


def store_original(raw: bytes) -> str:
    """按内容哈希保存原图（原子写入），返回 sha256 引用 id。"""
    sha256 = hashlib.sha256(raw).hexdigest()
    dest = os.path.join(cfg().original_dir, sha256)
    if not os.path.exists(dest):
        os.makedirs(cfg().original_dir, exist_ok=True)
        tmp = dest + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(raw)
        os.replace(tmp, dest)
    return sha256


def gc_originals(config: BeadConfig) -> None:
    """启动时清理未被当前 state.json 引用的原图。

    .ssfbp 项目文件内嵌原图字节，重新打开会自动重新落盘，
    因此服务端 originals 目录里只有当前状态引用的文件是必需的。
    """
    current_id = None
    try:
        with open(config.state_file, encoding="utf-8") as fh:
            state = json.load(fh)
        current_id = (state.get("original") or {}).get("id")
    except Exception:
        # 状态文件缺失或损坏时不做清理，避免误删原图
        return
    if not ORIGINAL_ID_RE.match(current_id or ""):
        return
    try:
        with os.scandir(config.original_dir) as it:
            for entry in it:
                if not entry.is_file() or not ORIGINAL_ID_RE.match(entry.name):
                    continue
                if entry.name == current_id:
                    continue
                try:
                    os.remove(entry.path)
                    logging.getLogger(__name__).info("清理未引用原图：%s", entry.name)
                except OSError:
                    pass
    except OSError:
        pass


@assets_bp.post("/api/upload")
def api_upload():
    f = request.files.get("image")
    original_id = (request.form.get("originalId") or "").strip()
    raw = None
    original_name = ""
    if f:
        # 已知限制：整文件读入内存 + base64 返回（本地单用户工具可接受；
        # 若未来需要支持超大图，可改为流式读取并让前端用 Blob URL 下载）
        raw = f.read()
        original_name = f.filename or ""
    elif original_id:
        path = original_path(original_id)
        if not path or not os.path.exists(path):
            return err("原图不存在", 404)
        with open(path, "rb") as fh:
            raw = fh.read()
    else:
        return err("未收到图片")

    target = opt_int(request.form.get("targetPixels"), DEFAULT_TARGET_PIXELS)
    sharpen = opt_bool(request.form.get("sharpen"), False)
    try:
        img = comp.open_image(raw)
    except ValueError as e:
        return err(str(e))
    except Exception:
        return err("无法解析该图片，请换一张试试")
    # 校验图片成功后再落盘，避免无效上传留下孤儿原图文件
    sha256 = store_original(raw)
    try:
        img = comp.compress(img, target, sharpen=sharpen)
        b64 = base64.b64encode(comp.to_png_base64(img)).decode("ascii")
    except Exception:
        return err("图片处理失败，请尝试更小的图片", 500)
    return jsonify({
        "width": img.width,
        "height": img.height,
        "pngBase64": b64,
        "originalId": sha256,
        "originalName": safe_name(original_name, "原图"),
        "originalSha256": sha256,
        "originalSize": len(raw),
    })


@assets_bp.get("/api/originals/<original_id>")
def api_original_get(original_id: str):
    path = original_path(original_id)
    if not path or not os.path.exists(path):
        return err("原图不存在", 404)
    return send_file(path, mimetype="application/octet-stream")


@assets_bp.delete("/api/originals/<original_id>")
def api_original_delete(original_id: str):
    path = original_path(original_id)
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            return err("删除原图失败", 500)
    return jsonify({"ok": True})
