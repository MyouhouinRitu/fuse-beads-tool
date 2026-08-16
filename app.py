"""拼豆工具 - Flask 应用入口（组装与启动）。

路由按领域拆分在 bead/web/：认证、调色板配置、原图、项目/状态、导出。
"""

from __future__ import annotations

import logging
import os
import secrets
import sys
import threading
from logging.handlers import RotatingFileHandler

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from bead import desktop
from bead.web import assets, auth, configs, export, project
from bead.web.common import (
    BASE_DIR,
    DEFAULT_PORT,
    MAX_UPLOAD_BYTES,
    RESOURCE_DIR,
    WAITRESS_THREADS,
    BeadConfig,
)


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
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # NAS 走 HTTPS 反向代理时可设 APP_COOKIE_SECURE=1，避免会话 Cookie 明文传输
        SESSION_COOKIE_SECURE=os.environ.get("APP_COOKIE_SECURE") == "1",
    )

    app.before_request(auth.auth_gate)
    app.register_blueprint(auth.auth_bp)
    app.register_blueprint(configs.configs_bp)
    app.register_blueprint(assets.assets_bp)
    app.register_blueprint(project.project_bp)
    app.register_blueprint(export.export_bp)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.errorhandler(HTTPException)
    def handle_http_exception(e):
        if request.path.startswith("/api/"):
            return jsonify({"error": e.description or e.name}), e.code
        return e.get_response()

    @app.errorhandler(Exception)
    def handle_unexpected_error(e):
        logging.getLogger(__name__).exception("未处理异常: %s", e)
        if request.path.startswith("/api/"):
            return jsonify({"error": "服务器内部错误"}), 500
        return "服务器内部错误", 500

    configs.ensure_default_config(config)
    assets.gc_originals(config)
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
