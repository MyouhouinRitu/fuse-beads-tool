"""拼豆工具 - Flask backend."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import shutil
import sys
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler

from flask import Blueprint, Flask, current_app, jsonify, render_template, request, send_file, session

from bead import desktop
from bead import compress as comp
from bead import export as ex
from bead import palette as pal
from bead import pdf_export as pdfx
from bead import project_file as pj

# 打包（PyInstaller）后：资源在 _MEIPASS，数据放在 exe 同级 data 目录
if getattr(sys, "frozen", False):
    RESOURCE_DIR = sys._MEIPASS
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    RESOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR = RESOURCE_DIR

DEFAULT_CONFIG_NAME = "mard-221-alfonse-doudou"

# ---------------- 常量配置 ----------------
DEFAULT_PORT = 5000
WAITRESS_THREADS = 8
DEFAULT_TARGET_PIXELS = 4000  # 与 static/js/constants.js DEFAULT_TARGET_PIXELS 保持一致
MAX_UPLOAD_BYTES = 64 * 1024 * 1024  # 上传体积上限（字节）
MAX_STATE_BYTES = 64 * 1024 * 1024  # 状态写入体积上限（字节），超出返回明确的 JSON 错误
LOGIN_MAX_ATTEMPTS = 5  # 登录失败限流：窗口期内最多尝试次数
LOGIN_WINDOW_SECONDS = 60  # 登录失败限流窗口（秒）
PDF_PREVIEW_CACHE_SIZE = 4  # PDF 分页预览内存缓存条数
PDF_PREVIEW_CACHE_TTL = 60.0  # PDF 分页预览缓存有效期（秒）

@dataclass(frozen=True)
class BeadConfig:
    """单个 Flask 应用实例的运行时配置（数据目录 / Token / 会话密钥）。

    由 create_app() 构建并存入 app.config["BEAD_CONFIG"]，
    路由与辅助函数通过 cfg() 读取，避免模块级可变全局在多实例间互相踩踏。
    """

    data_dir: str
    config_dir: str
    original_dir: str
    state_file: str
    app_token: str
    app_secret: str


def cfg() -> BeadConfig:
    """读取当前请求所属应用的配置（仅可在应用/请求上下文中调用）。"""
    return current_app.config["BEAD_CONFIG"]

_state_lock = threading.Lock()
_login_lock = threading.Lock()
_login_failures: dict[str, list[float]] = {}
_configs_cache: dict[str, tuple[object, list[dict[str, object]]]] = {}
_pdf_preview_cache: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()
_pdf_preview_lock = threading.Lock()

ORIGINAL_ID_RE = re.compile(r"^[0-9a-f]{64}$")

# Token 认证（NAS 部署用）：未设置 APP_TOKEN 时保持本地开发直连
PUBLIC_API = {"/api/auth/login", "/api/auth/logout", "/api/auth/status"}


def _login_rate_limited(ip: str) -> bool:
    """登录失败限流：窗口期内失败次数达到上限则拒绝（内存态，仅防暴力尝试）。"""
    now = time.monotonic()
    with _login_lock:
        recent = [t for t in _login_failures.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
        _login_failures[ip] = recent
        return len(recent) >= LOGIN_MAX_ATTEMPTS


def _record_login_failure(ip: str) -> None:
    with _login_lock:
        _login_failures.setdefault(ip, []).append(time.monotonic())


def _clear_login_failures(ip: str) -> None:
    with _login_lock:
        _login_failures.pop(ip, None)


bp = Blueprint("main", __name__)


@bp.before_request
def auth_gate():
    if not cfg().app_token:
        return None
    path = request.path
    if path.startswith("/static") or path in PUBLIC_API:
        return None
    if path.startswith("/api/") and not session.get("authed"):
        return jsonify({"error": "需要 Token 验证"}), 401
    return None


@bp.post("/api/auth/login")
def api_login():
    data = request.get_json(force=True, silent=True) or {}
    token = str(data.get("token", "") or "")
    ip = request.remote_addr or "unknown"
    if _login_rate_limited(ip):
        return err("尝试次数过多，请稍后再试", 429)
    if not cfg().app_token or hmac.compare_digest(token, cfg().app_token):
        _clear_login_failures(ip)
        session["authed"] = True
        return jsonify({"ok": True})
    _record_login_failure(ip)
    return err("Token 不正确", 401)


@bp.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@bp.get("/api/auth/status")
def api_auth_status():
    authenticated = bool(session.get("authed")) or not cfg().app_token
    return jsonify({"authenticated": authenticated, "requiresAuth": bool(cfg().app_token)})


def safe_name(name: str | None, fallback: str = "未命名") -> str:
    # 与 pj.safe_filename 共用同一份清洗实现，配置名额外限制 60 字符
    return pj.clean_filename(name, fallback, max_length=60)


def config_path(name: str) -> str:
    return os.path.join(cfg().config_dir, safe_name(name) + ".csv")


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


def load_project_document(data: bytes) -> dict:
    sections = pj.parse_project_file(data)
    if "state" not in sections:
        raise ValueError("项目文件缺少状态段")
    doc = json.loads(sections["state"].decode("utf-8"))
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


def list_configs(config: BeadConfig) -> list[dict[str, object]]:
    """配置列表：按目录内容（文件名/修改时间/大小）缓存，避免每次请求重读全部 CSV。"""
    key = (config.data_dir, _configs_cache_signature(config))
    cached = _configs_cache.get(config.data_dir)
    if cached is not None and cached[0] == key:
        return list(cached[1])

    names: list[dict[str, object]] = []
    for fn in sorted(os.listdir(config.config_dir)):
        if not fn.lower().endswith(".csv"):
            continue
        path = os.path.join(config.config_dir, fn)
        try:
            colors = pal.read_csv(path)
        except Exception:
            continue
        names.append(
            {
                "name": fn[:-4],
                "colorCount": len(colors),
                "updatedAt": os.path.getmtime(path),
                "paletteHash": pal.palette_hash(colors),
            }
        )
    names.sort(key=lambda c: (c["name"] != DEFAULT_CONFIG_NAME, c["name"]))
    _configs_cache[config.data_dir] = (key, names)
    return names


def _configs_cache_signature(config: BeadConfig) -> tuple[tuple[str, int, int], ...] | None:
    try:
        with os.scandir(config.config_dir) as it:
            entries = []
            for de in it:
                if not de.name.lower().endswith(".csv") or not de.is_file():
                    continue
                st = de.stat()
                entries.append((de.name, st.st_mtime_ns, st.st_size))
    except OSError:
        return None
    return tuple(sorted(entries))


def _invalidate_configs_cache(config: BeadConfig | None = None) -> None:
    """配置列表缓存失效：指定应用清对应目录，未指定时全部清空。"""
    if config is None:
        _configs_cache.clear()
    else:
        _configs_cache.pop(config.data_dir, None)


def _pdf_preview_cache_key(
    fmt: str,
    width: int,
    height: int,
    grid: list[int],
    payload: dict,
    opts: dict,
) -> str:
    """预览缓存键：按请求内容哈希，避免相同预览反复渲染。"""
    canonical = json.dumps(
        {
            "fmt": fmt,
            "width": width,
            "height": height,
            "grid": grid,
            "palette": payload.get("palette", []),
            "legend": payload.get("legend", []),
            "codes": payload.get("codes") or None,
            "options": opts,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def ensure_default_config(config: BeadConfig) -> None:
    names = [c["name"] for c in list_configs(config)]
    if not names:
        bundled = os.path.join(RESOURCE_DIR, "data", "configs")
        if os.path.isdir(bundled) and any(f.endswith(".csv") for f in os.listdir(bundled)):
            for fn in os.listdir(bundled):
                if fn.lower().endswith(".csv"):
                    shutil.copy2(os.path.join(bundled, fn), os.path.join(config.config_dir, fn))
        else:
            pal.write_csv(os.path.join(config.config_dir, "default_48.csv"), pal.DEFAULT_PALETTE)
            pal.write_csv(
                os.path.join(config.config_dir, f"{DEFAULT_CONFIG_NAME}.csv"),
                pal.read_csv_text(pal.MARD_221_PALETTE_CSV),
            )
        _invalidate_configs_cache(config)
    elif DEFAULT_CONFIG_NAME not in names:
        pal.write_csv(
            os.path.join(config.config_dir, f"{DEFAULT_CONFIG_NAME}.csv"),
            pal.read_csv_text(pal.MARD_221_PALETTE_CSV),
        )
        _invalidate_configs_cache(config)


def err(msg: str, status: int = 400) -> tuple[object, int]:
    return jsonify({"error": msg}), status


def opt_bool(value: object, default: bool = True) -> bool:
    """把导出选项的布尔值规范化：兼容真实布尔与字符串表示。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return default if value is None else bool(value)


def opt_int(value: object, default: int) -> int:
    """把数值选项规范化：非法/缺失时回退默认值，避免 500。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


SUPPORTED_EXPORT_FORMATS = {"png", "jpg", "pdf-a4", "pdf-multi-a4", "pdf-a3-a4"}


def parse_export_grid(data: dict) -> tuple[int, int, list[int]]:
    """解析并校验导出请求的网格数据，失败时抛 ValueError（由路由转成 JSON 400）。"""
    try:
        width = int(data.get("width", 0))
        height = int(data.get("height", 0))
        grid = [int(v) for v in data.get("grid", [])]
    except (TypeError, ValueError):
        raise ValueError("网格数据无效")
    if width <= 0 or height <= 0 or len(grid) != width * height:
        raise ValueError("网格数据无效")
    return width, height, grid


@bp.get("/")
def index():
    return render_template("index.html")


# ---------------- 色板配置 ----------------


@bp.get("/api/configs")
def api_configs():
    return jsonify({"configs": list_configs(cfg())})


@bp.get("/api/configs/<name>")
def api_config_get(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    return jsonify({"name": safe_name(name), "colors": pal.read_csv(path)})


@bp.post("/api/configs")
def api_config_create():
    data = request.get_json(force=True)
    name = safe_name(data.get("name", ""))
    path = config_path(name)
    if os.path.exists(path):
        return err(f"配置「{name}」已存在")
    colors = pal.normalize_colors(data.get("colors", []))
    if not colors:
        return err("颜色列表不能为空")
    pal.write_csv(path, colors)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True, "name": name, "colors": colors})


@bp.put("/api/configs/<name>")
def api_config_update(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    data = request.get_json(force=True)
    colors = pal.normalize_colors(data.get("colors", []))
    if not colors:
        return err("颜色列表不能为空")
    pal.write_csv(path, colors)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True})


@bp.post("/api/configs/<name>/rename")
def api_config_rename(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    new_name = safe_name(request.get_json(force=True).get("newName", ""))
    new_path = config_path(new_name)
    if new_path == path:
        return jsonify({"ok": True, "name": new_name})
    if os.path.exists(new_path):
        return err(f"配置「{new_name}」已存在")
    os.replace(path, new_path)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True, "name": new_name})


@bp.delete("/api/configs/<name>")
def api_config_delete(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    try:
        os.remove(path)
    except OSError:
        return err("删除配置失败", 500)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True})


@bp.post("/api/configs/import")
def api_config_import():
    f = request.files.get("file")
    if not f:
        return err("未收到文件")
    text = f.read().decode("utf-8-sig", errors="replace")
    colors = pal.read_csv_text(text)
    if not colors:
        return err("CSV 中没有找到有效的颜色列（需要包含「编号、色号、名称、颜色」或英文表头）")
    stem = request.form.get("name") or os.path.splitext(f.filename or "配置")[0]
    name = safe_name(stem)
    path = config_path(name)
    suffix = 2
    while os.path.exists(path):
        path = config_path(f"{name} ({suffix})")
        suffix += 1
    pal.write_csv(path, colors)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True, "name": os.path.splitext(os.path.basename(path))[0], "colors": colors})


@bp.get("/api/configs/<name>/export")
def api_config_export(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    return send_file(
        path,
        mimetype="text/csv; charset=utf-8",
        as_attachment=True,
        download_name=f"{safe_name(name)}.csv",
    )


# ---------------- 图片处理 ----------------


@bp.post("/api/upload")
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
    except Exception:
        return err("无法解析该图片，请换一张试试")
    # 校验图片成功后再落盘，避免无效上传留下孤儿原图文件
    sha256 = store_original(raw)
    img = comp.compress(img, target, sharpen=sharpen)
    b64 = base64.b64encode(comp.to_png_base64(img)).decode("ascii")
    return jsonify({
        "width": img.width,
        "height": img.height,
        "pngBase64": b64,
        "originalId": sha256,
        "originalName": safe_name(original_name, "原图"),
        "originalSha256": sha256,
        "originalSize": len(raw),
    })


@bp.get("/api/originals/<original_id>")
def api_original_get(original_id: str):
    path = original_path(original_id)
    if not path or not os.path.exists(path):
        return err("原图不存在", 404)
    return send_file(path, mimetype="application/octet-stream")


@bp.delete("/api/originals/<original_id>")
def api_original_delete(original_id: str):
    path = original_path(original_id)
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            return err("删除原图失败", 500)
    return jsonify({"ok": True})


@bp.post("/api/project/open-upload")
def api_project_open_upload():
    f = request.files.get("file")
    if not f:
        return err("未收到项目文件")
    try:
        doc = load_project_document(f.read())
    except (ValueError, OSError, json.JSONDecodeError) as e:
        return err("打开项目失败：" + str(e))
    return jsonify({"ok": True, "document": doc})


@bp.post("/api/project/save")
def api_project_save():
    data = request.get_json(force=True)
    doc = data.get("document")
    if not doc or not doc.get("project"):
        return err("没有可保存的项目")
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


@bp.post("/api/export")
def api_export():
    data = request.get_json(force=True)
    try:
        width, height, grid = parse_export_grid(data)
    except ValueError as e:
        return err(str(e))
    opts = data.get("options", {})
    fmt = (opts.get("format") or "jpg").lower()
    if fmt not in SUPPORTED_EXPORT_FORMATS:
        return err("不支持的导出格式，仅支持 png / jpg / PDF")

    if fmt.startswith("pdf-"):
        pdf_bytes = pdfx.export_pdf(
            fmt,
            width,
            height,
            grid,
            data.get("palette", []),
            data.get("legend", []),
            data.get("codes") or None,
            opts,
        )
        b64 = base64.b64encode(pdf_bytes).decode("ascii")
        return jsonify({"dataUrl": f"data:application/pdf;base64,{b64}"})

    img = ex.render_pattern(
        width,
        height,
        grid,
        ex.build_palette_map(data.get("palette", [])),
        cell=opt_int(opts.get("cellSize"), ex.DEFAULT_CELL),
        grid_lines=opt_bool(opts.get("gridLines"), True),
        outer_pad=opt_int(opts.get("outerPad"), 0),
        hatch=opt_bool(opts.get("hatch"), True),
        empty_style=opts.get("emptyStyle") or "default",
        legend=data.get("legend", []),
        codes=data.get("codes", []),
        show_codes=opt_bool(opts.get("showCodes"), True),
        show_legend=opt_bool(opts.get("legend"), True),
        edge_numbers=opt_bool(opts.get("edgeNumbers"), False),
    )
    buf = io.BytesIO()
    if fmt == "png":
        img.save(buf, "PNG")
    else:
        img.save(buf, "JPEG", quality=opt_int(opts.get("quality"), ex.DEFAULT_QUALITY))
    # 已知限制：整张图 base64 内联返回（浏览器下载最小改动方案）；
    # 大图场景可改为返回二进制流 + URL.createObjectURL
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if fmt == "png" else "image/jpeg"
    return jsonify({"dataUrl": f"data:{mime};base64,{b64}"})


@bp.post("/api/export-preview")
def api_export_preview():
    data = request.get_json(force=True)
    try:
        width, height, grid = parse_export_grid(data)
    except ValueError as e:
        return err(str(e))
    opts = data.get("options", {})
    fmt = (opts.get("format") or "jpg").lower()
    if fmt not in SUPPORTED_EXPORT_FORMATS:
        return err("不支持的导出格式，仅支持 png / jpg / PDF")
    if not fmt.startswith("pdf-"):
        return err("仅 PDF 格式支持分页预览")
    cache_key = _pdf_preview_cache_key(
        fmt, width, height, grid, data, opts,
    )
    now = time.monotonic()
    with _pdf_preview_lock:
        cached = _pdf_preview_cache.get(cache_key)
        if cached and now - cached[0] < PDF_PREVIEW_CACHE_TTL:
            _pdf_preview_cache.move_to_end(cache_key)
            return jsonify({"pages": cached[1]})
    try:
        pages = pdfx.export_pdf_previews(
            fmt,
            width,
            height,
            grid,
            data.get("palette", []),
            data.get("legend", []),
            data.get("codes") or None,
            opts,
        )
    except Exception as e:
        return err("PDF 预览生成失败：" + str(e))
    with _pdf_preview_lock:
        _pdf_preview_cache[cache_key] = (time.monotonic(), pages)
        _pdf_preview_cache.move_to_end(cache_key)
        while len(_pdf_preview_cache) > PDF_PREVIEW_CACHE_SIZE:
            _pdf_preview_cache.popitem(last=False)
    return jsonify({"pages": pages})


# ---------------- 状态持久化 ----------------


@bp.get("/api/state")
def api_state_get():
    if not os.path.exists(cfg().state_file):
        return jsonify({})
    try:
        with open(cfg().state_file, "r", encoding="utf-8") as fh:
            return jsonify(json.load(fh))
    except Exception:
        return jsonify({})


@bp.put("/api/state")
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


def create_app(data_dir: str | None = None) -> Flask:
    """创建 Flask 应用（工厂模式）：可注入数据目录，便于测试隔离。"""
    # 测试等场景可通过 DATA_DIR 环境变量隔离数据目录，避免污染真实数据
    resolved_data_dir = data_dir or os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
    app_token = os.environ.get("APP_TOKEN", "").strip()
    # 未显式设置 APP_SECRET 时始终生成随机密钥，避免用 APP_TOKEN 作为会话签名密钥
    app_secret = os.environ.get("APP_SECRET", "").strip() or secrets.token_hex(16)
    config = BeadConfig(
        data_dir=resolved_data_dir,
        config_dir=os.path.join(resolved_data_dir, "configs"),
        original_dir=os.path.join(resolved_data_dir, "originals"),
        state_file=os.path.join(resolved_data_dir, "state.json"),
        app_token=app_token,
        app_secret=app_secret,
    )

    os.makedirs(config.config_dir, exist_ok=True)
    os.makedirs(config.original_dir, exist_ok=True)

    app = Flask(
        __name__,
        template_folder=os.path.join(RESOURCE_DIR, "templates"),
        static_folder=os.path.join(RESOURCE_DIR, "static"),
    )
    app.secret_key = config.app_secret
    app.config["BEAD_CONFIG"] = config
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
    app.register_blueprint(bp)

    ensure_default_config(config)
    return app


def setup_logging(log_dir: str | None = None) -> None:
    """统一日志：控制台始终输出；打包版额外写入可轮转的 data/app.log。"""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        root.addHandler(console)
    if log_dir and not any(isinstance(h, RotatingFileHandler) for h in root.handlers):
        try:
            os.makedirs(log_dir, exist_ok=True)
            file_handler = RotatingFileHandler(
                os.path.join(log_dir, "app.log"),
                maxBytes=1_000_000,
                backupCount=3,
                encoding="utf-8",
            )
            file_handler.setFormatter(fmt)
            root.addHandler(file_handler)
        except OSError:
            pass  # 数据目录不可写时仅跳过文件日志，服务照常启动


def main() -> None:
    port = int(os.environ.get("PORT", DEFAULT_PORT))
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])
    host = os.environ.get("HOST", desktop.LOCALHOST)
    url = f"http://{desktop.LOCALHOST}:{port}"

    # 托盘模式：EXE 打包版默认开启（可用 APP_TRAY=1 在直开时调试），容器内不启用
    tray_mode = (getattr(sys, "frozen", False) or os.environ.get("APP_TRAY") == "1") and not desktop.in_container()

    # 单实例：已有实例在运行时，打开网页后退出本实例
    if tray_mode and not desktop.acquire_single_instance():
        if os.environ.get("NO_BROWSER") != "1":
            threading.Thread(
                target=desktop.open_browser_when_ready,
                args=(desktop.LOCALHOST, port, url, desktop.SECOND_INSTANCE_TIMEOUT),
                daemon=True,
            ).start()
        sys.exit(0)

    app = create_app()
    setup_logging(os.path.join(BASE_DIR, "data") if getattr(sys, "frozen", False) else None)
    logging.getLogger(__name__).info("拼豆工具启动：http://%s:%s", host, port)

    # 托盘模式：后台常驻，图标在右下角系统托盘
    if tray_mode:
        desktop.start_tray(url, RESOURCE_DIR, BASE_DIR)

    # 打包版 / 生产模式使用 Waitress，并提供日志文件便于排查
    use_waitress = os.environ.get("USE_WAITRESS") == "1" or getattr(sys, "frozen", False)
    # 本地直开 / 打包版均自动打开浏览器；容器（Docker）内不打开
    if not desktop.in_container() and os.environ.get("NO_BROWSER") != "1":
        threading.Thread(
            target=desktop.open_browser_when_ready,
            args=(desktop.LOCALHOST, port, url),
            daemon=True,
        ).start()

    if use_waitress:
        from waitress import serve

        serve(app, host=host, port=port, threads=WAITRESS_THREADS)
    else:
        app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
