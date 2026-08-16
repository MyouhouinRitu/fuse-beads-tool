"""认证路由与登录失败限流。"""

from __future__ import annotations

import hmac
import threading
import time

from flask import Blueprint, jsonify, request, session

from bead.web.common import cfg, err

# Token 认证（NAS 部署用）：未设置 APP_TOKEN 时保持本地开发直连
PUBLIC_API = {"/api/auth/login", "/api/auth/logout", "/api/auth/status"}

LOGIN_MAX_ATTEMPTS = 5  # 登录失败限流：窗口期内最多尝试次数
LOGIN_WINDOW_SECONDS = 60  # 登录失败限流窗口（秒）

_login_lock = threading.Lock()
_login_failures: dict[str, list[float]] = {}

auth_bp = Blueprint("auth", __name__)


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


def auth_gate():
    """全局 Token 门禁：由 create_app 注册为 before_request。"""
    if not cfg().app_token:
        return None
    path = request.path
    if path.startswith("/static") or path in PUBLIC_API:
        return None
    if path.startswith("/api/") and not session.get("authed"):
        return err("需要 Token 验证", 401)
    return None


@auth_bp.post("/api/auth/login")
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


@auth_bp.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@auth_bp.get("/api/auth/status")
def api_auth_status():
    authenticated = bool(session.get("authed")) or not cfg().app_token
    return jsonify({"authenticated": authenticated, "requiresAuth": bool(cfg().app_token)})
