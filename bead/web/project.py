"""项目文件打开/保存与状态持久化路由。"""

from __future__ import annotations

import base64
import json
import os
import threading

from flask import Blueprint, jsonify, request

from bead import project_file as pj
from bead.web.assets import original_path, store_original
from bead.web.common import MAX_STATE_BYTES, cfg, err

_state_lock = threading.Lock()

project_bp = Blueprint("project", __name__)


def load_project_document(data: bytes) -> dict:
    sections = pj.parse_project_file(data)
    if "state" not in sections:
        raise ValueError("项目文件缺少状态段")
    doc = json.loads(sections["state"].decode("utf-8"))
    pj.validate_project_document(doc)
    orig_raw = sections.get("original")
    if orig_raw:
        sha256 = store_original(orig_raw)
        doc["original"] = {
            "id": sha256,
            "name": (doc.get("original") or {}).get("name"),
            "sha256": sha256,
            "size": len(orig_raw),
        }
    else:
        doc["original"] = None
    return doc


@project_bp.post("/api/project/open-upload")
def api_project_open_upload():
    f = request.files.get("file")
    if not f:
        return err("未收到项目文件")
    try:
        doc = load_project_document(f.read())
    except (ValueError, OSError, json.JSONDecodeError) as e:
        return err("打开项目失败：" + str(e))
    return jsonify({"ok": True, "document": doc})


@project_bp.post("/api/project/save")
def api_project_save():
    data = request.get_json(force=True)
    doc = data.get("document")
    if not doc or not doc.get("project"):
        return err("没有可保存的项目")
    try:
        pj.validate_project_document(doc)
    except ValueError as e:
        return err(str(e))
    filename = data.get("filename") or pj.default_project_filename(
        (doc.get("original") or {}).get("name") or (doc.get("projectName") or None)
    )
    filename = pj.safe_filename(filename, "未命名.ssfbp")
    if not filename.lower().endswith(".ssfbp"):
        filename += ".ssfbp"

    orig_ref = doc.get("original") or {}
    orig_raw = None
    if orig_ref.get("id"):
        path = original_path(str(orig_ref["id"]))
        if path and os.path.exists(path):
            with open(path, "rb") as fh:
                orig_raw = fh.read()

    sections = {
        "meta": pj.meta_json(),
        "state": json.dumps(doc, ensure_ascii=False).encode("utf-8"),
    }
    if orig_raw:
        sections["original"] = orig_raw
    file_bytes = pj.build_project_file(sections)

    return jsonify({
        "ok": True,
        "mode": "download",
        "filename": filename,
        "dataBase64": base64.b64encode(file_bytes).decode("ascii"),
    })


@project_bp.get("/api/state")
def api_state_get():
    if not os.path.exists(cfg().state_file):
        return jsonify({})
    try:
        with open(cfg().state_file, encoding="utf-8") as fh:
            return jsonify(json.load(fh))
    except Exception:
        # 损坏的状态文件先备份再返回空态，避免下一次自动保存直接覆盖掉可抢救数据
        try:
            os.replace(cfg().state_file, cfg().state_file + ".corrupt")
        except OSError:
            pass
        return jsonify({})


@project_bp.put("/api/state")
def api_state_put():
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return err("状态数据无效")
    if len(request.get_data()) > MAX_STATE_BYTES:
        return err("状态数据过大", 413)
    tmp = cfg().state_file + ".tmp"
    with _state_lock:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, cfg().state_file)
    return jsonify({"ok": True})
