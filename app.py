"""拼豆工具 - Flask backend."""

import base64
import hmac
import io
import json
import os
import re
import secrets
import shutil
import sys
import threading
import webbrowser

from flask import Flask, jsonify, render_template, request, send_file, session

from bead import compress as comp
from bead import export as ex
from bead import palette as pal

# 打包（PyInstaller）后：资源在 _MEIPASS，数据放在 exe 同级 data 目录
if getattr(sys, "frozen", False):
    RESOURCE_DIR = sys._MEIPASS
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    RESOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR = RESOURCE_DIR

DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_DIR = os.path.join(DATA_DIR, "configs")
STATE_FILE = os.path.join(DATA_DIR, "state.json")
DEFAULT_CONFIG_NAME = "mard-221-alfonse-doudou"

os.makedirs(CONFIG_DIR, exist_ok=True)

app = Flask(
    __name__,
    template_folder=os.path.join(RESOURCE_DIR, "templates"),
    static_folder=os.path.join(RESOURCE_DIR, "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
_state_lock = threading.Lock()

NAME_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')

# Token 认证（NAS 部署用）：未设置 APP_TOKEN 时保持本地开发直连
APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
APP_SECRET = os.environ.get("APP_SECRET", "").strip() or (APP_TOKEN or secrets.token_hex(16))
app.secret_key = APP_SECRET

PUBLIC_API = {"/api/auth/login", "/api/auth/logout", "/api/auth/status"}


@app.before_request
def auth_gate():
    if not APP_TOKEN:
        return None
    path = request.path
    if path.startswith("/static") or path in PUBLIC_API:
        return None
    if path.startswith("/api/") and not session.get("authed"):
        return jsonify({"error": "需要 Token 验证"}), 401
    return None


@app.post("/api/auth/login")
def api_login():
    data = request.get_json(force=True, silent=True) or {}
    token = str(data.get("token", "") or "")
    if not APP_TOKEN or hmac.compare_digest(token, APP_TOKEN):
        session["authed"] = True
        return jsonify({"ok": True})
    return err("Token 不正确", 401)


@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/auth/status")
def api_auth_status():
    authenticated = bool(session.get("authed")) or not APP_TOKEN
    return jsonify({"authenticated": authenticated, "requiresAuth": bool(APP_TOKEN)})


def safe_name(name, fallback="未命名"):
    cleaned = NAME_BAD.sub("_", str(name or "").strip())[:60]
    return cleaned or fallback


def config_path(name):
    return os.path.join(CONFIG_DIR, safe_name(name) + ".csv")


def list_configs():
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
            }
        )
    names.sort(key=lambda c: (c["name"] != DEFAULT_CONFIG_NAME, c["name"]))
    return names


def ensure_default_config():
    if not list_configs():
        bundled = os.path.join(RESOURCE_DIR, "data", "configs")
        if os.path.isdir(bundled) and any(f.endswith(".csv") for f in os.listdir(bundled)):
            for fn in os.listdir(bundled):
                if fn.lower().endswith(".csv"):
                    shutil.copy2(os.path.join(bundled, fn), os.path.join(CONFIG_DIR, fn))
        else:
            pal.write_csv(config_path("default_48"), pal.DEFAULT_PALETTE)


def err(msg, status=400):
    return jsonify({"error": msg}), status


@app.get("/")
def index():
    return render_template("index.html")


# ---------------- 色板配置 ----------------


@app.get("/api/configs")
def api_configs():
    return jsonify({"configs": list_configs()})


@app.get("/api/configs/<name>")
def api_config_get(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    return jsonify({"name": safe_name(name), "colors": pal.read_csv(path)})


@app.post("/api/configs")
def api_config_create():
    data = request.get_json(force=True)
    name = safe_name(data.get("name", ""))
    path = config_path(name)
    if os.path.exists(path):
        return err(f"配置「{name}」已存在")
    colors = pal.normalize_colors(data.get("colors", []))
    if not colors:
        return err("颜色列表不能为空")
    pal.ensure_dir(path)
    pal.write_csv(path, colors)
    return jsonify({"ok": True, "name": name, "colors": colors})


@app.put("/api/configs/<name>")
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


@app.post("/api/configs/<name>/rename")
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


@app.delete("/api/configs/<name>")
def api_config_delete(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    os.remove(path)
    return jsonify({"ok": True})


@app.post("/api/configs/import")
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
    pal.ensure_dir(path)
    pal.write_csv(path, colors)
    return jsonify({"ok": True, "name": os.path.basename(path)[:-4], "colors": colors})


@app.get("/api/configs/<name>/export")
def api_config_export(name):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    buf = io.BytesIO()
    with open(path, "rb") as fh:
        buf.write(fh.read())
    buf.seek(0)
    return send_file(
        buf,
        mimetype="text/csv; charset=utf-8",
        as_attachment=True,
        download_name=f"{safe_name(name)}.csv",
    )


# ---------------- 图片处理 ----------------


@app.post("/api/upload")
def api_upload():
    f = request.files.get("image")
    if not f:
        return err("未收到图片")
    try:
        target = int(request.form.get("targetPixels", 40000))
    except (TypeError, ValueError):
        target = 40000
    sharpen = request.form.get("sharpen", "0") in ("1", "true", "on")
    try:
        img = comp.open_image(f.read())
    except Exception:
        return err("无法解析该图片，请换一张试试")
    img = comp.compress(img, target, sharpen=sharpen)
    b64 = base64.b64encode(comp.to_png_base64(img)).decode("ascii")
    return jsonify({"width": img.width, "height": img.height, "pngBase64": b64})


@app.post("/api/export")
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
    img = ex.render_pattern(
        width,
        height,
        grid,
        palette_map,
        cell=int(opts.get("cellSize", 20)),
        grid_lines=bool(opts.get("gridLines", True)),
        outer_pad=int(opts.get("outerPad", 0)),
        hatch=bool(opts.get("hatch", True)),
        empty_style=opts.get("emptyStyle") or "default",
        legend=data.get("legend", []),
        codes=data.get("codes", []),
        show_codes=bool(opts.get("showCodes", True)),
        show_legend=bool(opts.get("legend", True)),
    )
    fmt = (opts.get("format") or "jpg").lower()
    buf = io.BytesIO()
    if fmt == "png":
        img.save(buf, "PNG")
    else:
        img.save(buf, "JPEG", quality=int(opts.get("quality", 95)))
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if fmt == "png" else "image/jpeg"
    return jsonify({"dataUrl": f"data:{mime};base64,{b64}"})


# ---------------- 状态持久化 ----------------


@app.get("/api/state")
def api_state_get():
    if not os.path.exists(STATE_FILE):
        return jsonify({})
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return jsonify(json.load(fh))
    except Exception:
        return jsonify({})


@app.put("/api/state")
def api_state_put():
    data = request.get_json(force=True)
    tmp = STATE_FILE + ".tmp"
    with _state_lock:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
    return jsonify({"ok": True})


ensure_default_config()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])
    host = os.environ.get("HOST", "127.0.0.1")

    # 打包版 / 生产模式使用 Waitress，并提供日志文件便于排查
    use_waitress = os.environ.get("USE_WAITRESS") == "1" or getattr(sys, "frozen", False)
    # 打包版或显式开启时，启动后自动打开浏览器
    auto_open = getattr(sys, "frozen", False) or os.environ.get("APP_AUTO_OPEN") == "1"
    if auto_open and os.environ.get("NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()

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
        serve(app, host=host, port=port, threads=8)
    else:
        app.run(host=host, port=port, debug=False)
