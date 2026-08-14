"""拼豆工具 - Flask backend."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import sys
import threading

from flask import Blueprint, Flask, jsonify, render_template, request, send_file, session

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

DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_DIR = os.path.join(DATA_DIR, "configs")
ORIGINAL_DIR = os.path.join(DATA_DIR, "originals")
STATE_FILE = os.path.join(DATA_DIR, "state.json")
PROJECT_PATH_FILE = os.path.join(DATA_DIR, "project_path.txt")
DEFAULT_CONFIG_NAME = "mard-221-alfonse-doudou"

# ---------------- 常量配置 ----------------
DEFAULT_PORT = 5000
WAITRESS_THREADS = 8
DEFAULT_TARGET_PIXELS = 5000  # 与 static/js/constants.js DEFAULT_TARGET_PIXELS 保持一致
MAX_UPLOAD_BYTES = 64 * 1024 * 1024  # 上传体积上限（字节）

# 运行时配置：由 create_app() 初始化（便于测试注入临时数据目录）
DATA_DIR: str | None = None
CONFIG_DIR: str | None = None
ORIGINAL_DIR: str | None = None
STATE_FILE: str | None = None
PROJECT_PATH_FILE: str | None = None
APP_TOKEN = ""
APP_SECRET = ""

_state_lock = threading.Lock()

INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')  # Windows 非法文件名字符
ORIGINAL_ID_RE = re.compile(r"^[0-9a-f]{64}$")

# Token 认证（NAS 部署用）：未设置 APP_TOKEN 时保持本地开发直连
PUBLIC_API = {"/api/auth/login", "/api/auth/logout", "/api/auth/status", "/api/app-info"}

bp = Blueprint("main", __name__)


@bp.before_request
def auth_gate():
    if not APP_TOKEN:
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
    if not APP_TOKEN or hmac.compare_digest(token, APP_TOKEN):
        session["authed"] = True
        return jsonify({"ok": True})
    return err("Token 不正确", 401)


@bp.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@bp.get("/api/auth/status")
def api_auth_status():
    authenticated = bool(session.get("authed")) or not APP_TOKEN
    return jsonify({"authenticated": authenticated, "requiresAuth": bool(APP_TOKEN)})


@bp.get("/api/app-info")
def api_app_info():
    return jsonify({
        "nativeDialogs": sys.platform == "win32" and not desktop.in_container(),
    })


def safe_name(name: str | None, fallback: str = "未命名") -> str:
    cleaned = INVALID_FILENAME_CHARS.sub("_", str(name or "").strip())[:60]
    cleaned = cleaned.rstrip(". ")  # Windows 文件名不允许以点或空格结尾
    return cleaned or fallback


def config_path(name: str) -> str:
    return os.path.join(CONFIG_DIR, safe_name(name) + ".csv")


def original_path(original_id: str) -> str | None:
    if not ORIGINAL_ID_RE.match(original_id or ""):
        return None
    return os.path.join(ORIGINAL_DIR, original_id)


def current_project_path() -> str | None:
    if not PROJECT_PATH_FILE or not os.path.exists(PROJECT_PATH_FILE):
        return None
    try:
        with open(PROJECT_PATH_FILE, "r", encoding="utf-8") as fh:
            path = fh.read().strip()
        return path or None
    except Exception:
        return None


def set_current_project_path(path: str | None) -> None:
    if not PROJECT_PATH_FILE:
        return
    os.makedirs(os.path.dirname(PROJECT_PATH_FILE), exist_ok=True)
    if path:
        with open(PROJECT_PATH_FILE, "w", encoding="utf-8") as fh:
            fh.write(path)
    elif os.path.exists(PROJECT_PATH_FILE):
        os.remove(PROJECT_PATH_FILE)


def write_project_file_atomic(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)


def load_project_document(data: bytes) -> dict:
    sections = pj.parse_project_file(data)
    if "state" not in sections:
        raise ValueError("项目文件缺少状态段")
    doc = json.loads(sections["state"].decode("utf-8"))
    orig_raw = sections.get("original")
    if orig_raw:
        sha256 = hashlib.sha256(orig_raw).hexdigest()
        dest = os.path.join(ORIGINAL_DIR, sha256)
        if not os.path.exists(dest):
            os.makedirs(ORIGINAL_DIR, exist_ok=True)
            tmp = dest + ".tmp"
            with open(tmp, "wb") as fh:
                fh.write(orig_raw)
            os.replace(tmp, dest)
        doc["original"] = {
            "id": sha256,
            "name": (doc.get("original") or {}).get("name"),
            "sha256": sha256,
            "size": len(orig_raw),
        }
    else:
        doc["original"] = None
    return doc


def list_configs() -> list[dict[str, object]]:
    names = []
    for fn in sorted(os.listdir(CONFIG_DIR)):
        if not fn.lower().endswith(".csv"):
            continue
        path = os.path.join(CONFIG_DIR, fn)
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
    return names


def ensure_default_config() -> None:
    if not list_configs():
        bundled = os.path.join(RESOURCE_DIR, "data", "configs")
        if os.path.isdir(bundled) and any(f.endswith(".csv") for f in os.listdir(bundled)):
            for fn in os.listdir(bundled):
                if fn.lower().endswith(".csv"):
                    shutil.copy2(os.path.join(bundled, fn), os.path.join(CONFIG_DIR, fn))
        else:
            pal.write_csv(config_path("default_48"), pal.DEFAULT_PALETTE)


def err(msg: str, status: int = 400) -> tuple[object, int]:
    return jsonify({"error": msg}), status


def opt_bool(value: object, default: bool = True) -> bool:
    """把导出选项的布尔值规范化：兼容真实布尔与字符串表示。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return default if value is None else bool(value)


@bp.get("/")
def index():
    return render_template("index.html")


# ---------------- 色板配置 ----------------


@bp.get("/api/configs")
def api_configs():
    return jsonify({"configs": list_configs()})


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
    return jsonify({"ok": True, "name": new_name})


@bp.delete("/api/configs/<name>")
def api_config_delete(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    os.remove(path)
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

    sha256 = hashlib.sha256(raw).hexdigest()
    dest = os.path.join(ORIGINAL_DIR, sha256)
    if not os.path.exists(dest):
        os.makedirs(ORIGINAL_DIR, exist_ok=True)
        tmp = dest + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(raw)
        os.replace(tmp, dest)

    try:
        target = int(request.form.get("targetPixels", DEFAULT_TARGET_PIXELS))
    except (TypeError, ValueError):
        target = DEFAULT_TARGET_PIXELS
    sharpen = request.form.get("sharpen", "0") in ("1", "true", "on")
    try:
        img = comp.open_image(raw)
    except Exception:
        return err("无法解析该图片，请换一张试试")
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
        os.remove(path)
    return jsonify({"ok": True})


@bp.post("/api/project/pick-open")
def api_project_pick_open():
    if sys.platform != "win32":
        return jsonify({"ok": False, "unsupported": True})
    path, ok = pj.show_open_dialog_result()
    if not ok:
        return jsonify({"ok": False, "error": "无法打开系统文件对话框"})
    if not path:
        return jsonify({"ok": False, "cancelled": True})
    return jsonify({"ok": True, "path": path})


@bp.post("/api/project/open-path")
def api_project_open_path():
    path = (request.get_json(force=True) or {}).get("path")
    if not path or not os.path.exists(path):
        return err("项目文件不存在", 404)
    try:
        with open(path, "rb") as fh:
            doc = load_project_document(fh.read())
    except (ValueError, OSError, json.JSONDecodeError) as e:
        return err("打开项目失败：" + str(e))
    set_current_project_path(path)
    return jsonify({"ok": True, "document": doc, "path": path})


@bp.post("/api/project/open-upload")
def api_project_open_upload():
    f = request.files.get("file")
    if not f:
        return err("未收到项目文件")
    try:
        doc = load_project_document(f.read())
    except (ValueError, OSError, json.JSONDecodeError) as e:
        return err("打开项目失败：" + str(e))
    set_current_project_path(None)
    return jsonify({"ok": True, "document": doc})


@bp.post("/api/project/save")
def api_project_save():
    data = request.get_json(force=True)
    doc = data.get("document")
    if not doc or not doc.get("project"):
        return err("没有可保存的项目")
    filename = data.get("filename") or pj.default_project_filename(
        (doc.get("original") or {}).get("name")
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

    if data.get("mode") == "download":
        return jsonify({
            "ok": True,
            "mode": "download",
            "filename": filename,
            "dataBase64": base64.b64encode(file_bytes).decode("ascii"),
        })

    if sys.platform == "win32":
        path = current_project_path()
        if not path:
            path, ok = pj.show_save_dialog_result(filename)
            if not ok:
                return jsonify({
                    "ok": True,
                    "mode": "download",
                    "filename": filename,
                    "dataBase64": base64.b64encode(file_bytes).decode("ascii"),
                })
            if not path:
                return jsonify({"ok": False, "cancelled": True})
        write_project_file_atomic(path, file_bytes)
        set_current_project_path(path)
        return jsonify({"ok": True, "mode": "saved", "path": path})

    return jsonify({
        "ok": True,
        "mode": "download",
        "filename": filename,
        "dataBase64": base64.b64encode(file_bytes).decode("ascii"),
    })


@bp.post("/api/export")
def api_export():
    data = request.get_json(force=True)
    width = int(data.get("width", 0))
    height = int(data.get("height", 0))
    grid = [int(v) for v in data.get("grid", [])]
    if width <= 0 or height <= 0 or len(grid) != width * height:
        return err("网格数据无效")
    palette_map = {}
    for c in data.get("palette", []):
        palette_map[int(c["index"])] = c["hex"]
    opts = data.get("options", {})
    fmt = (opts.get("format") or "jpg").lower()
    if fmt not in ("png", "jpg", "pdf-a4", "pdf-multi-a4", "pdf-a3-a4"):
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
        palette_map,
        cell=int(opts.get("cellSize", ex.DEFAULT_CELL)),
        grid_lines=opt_bool(opts.get("gridLines"), True),
        outer_pad=int(opts.get("outerPad", 0)),
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
        img.save(buf, "JPEG", quality=int(opts.get("quality", ex.DEFAULT_QUALITY)))
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if fmt == "png" else "image/jpeg"
    return jsonify({"dataUrl": f"data:{mime};base64,{b64}"})


@bp.post("/api/export-preview")
def api_export_preview():
    data = request.get_json(force=True)
    width = int(data.get("width", 0))
    height = int(data.get("height", 0))
    grid = [int(v) for v in data.get("grid", [])]
    if width <= 0 or height <= 0 or len(grid) != width * height:
        return err("网格数据无效")
    opts = data.get("options", {})
    fmt = (opts.get("format") or "jpg").lower()
    if not fmt.startswith("pdf-"):
        return err("仅 PDF 格式支持分页预览")
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
    return jsonify({"pages": pages})


# ---------------- 状态持久化 ----------------


@bp.get("/api/state")
def api_state_get():
    if not os.path.exists(STATE_FILE):
        return jsonify({})
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return jsonify(json.load(fh))
    except Exception:
        return jsonify({})


@bp.put("/api/state")
def api_state_put():
    data = request.get_json(force=True)
    tmp = STATE_FILE + ".tmp"
    with _state_lock:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
    return jsonify({"ok": True})


def create_app(data_dir: str | None = None) -> Flask:
    """创建 Flask 应用（工厂模式）：可注入数据目录，便于测试隔离。"""
    global DATA_DIR, CONFIG_DIR, ORIGINAL_DIR, STATE_FILE, PROJECT_PATH_FILE, APP_TOKEN, APP_SECRET

    # 测试等场景可通过 DATA_DIR 环境变量隔离数据目录，避免污染真实数据
    DATA_DIR = data_dir or os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
    CONFIG_DIR = os.path.join(DATA_DIR, "configs")
    ORIGINAL_DIR = os.path.join(DATA_DIR, "originals")
    STATE_FILE = os.path.join(DATA_DIR, "state.json")
    PROJECT_PATH_FILE = os.path.join(DATA_DIR, "project_path.txt")
    APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
    APP_SECRET = os.environ.get("APP_SECRET", "").strip() or (APP_TOKEN or secrets.token_hex(16))

    os.makedirs(CONFIG_DIR, exist_ok=True)
    os.makedirs(ORIGINAL_DIR, exist_ok=True)

    app = Flask(
        __name__,
        template_folder=os.path.join(RESOURCE_DIR, "templates"),
        static_folder=os.path.join(RESOURCE_DIR, "static"),
    )
    app.secret_key = APP_SECRET
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
    app.register_blueprint(bp)

    ensure_default_config()
    return app


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

        if getattr(sys, "frozen", False):
            log_file = os.path.join(BASE_DIR, "data", "app.log")
            try:
                os.makedirs(os.path.dirname(log_file), exist_ok=True)
                sys.stdout = open(log_file, "a", encoding="utf-8")
                sys.stderr = sys.stdout
            except Exception:
                pass  # 数据目录不可写时仅跳过日志，服务照常启动
        serve(app, host=host, port=port, threads=WAITRESS_THREADS)
    else:
        app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()
