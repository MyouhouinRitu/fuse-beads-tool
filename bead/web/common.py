"""HTTP 层共享配置与辅助函数。"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from flask import Response, current_app, jsonify

from bead import project_file as pj

# 打包（PyInstaller）后：资源在 _MEIPASS，数据放在 exe 同级 data 目录
if getattr(sys, "frozen", False):
    RESOURCE_DIR = sys._MEIPASS  # type: ignore[attr-defined]
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    RESOURCE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    BASE_DIR = RESOURCE_DIR

DEFAULT_CONFIG_NAME = "mard-221-alfonse-doudou"

# ---------------- 常量配置 ----------------
DEFAULT_PORT = 5000
WAITRESS_THREADS = 8
DEFAULT_TARGET_PIXELS = 4000  # 与 static/js/constants.js DEFAULT_TARGET_PIXELS 保持一致
MAX_UPLOAD_BYTES = 64 * 1024 * 1024  # 上传体积上限（字节）
MAX_STATE_BYTES = 64 * 1024 * 1024  # 状态写入体积上限（字节），超出返回明确的 JSON 错误


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


def safe_name(name: str | None, fallback: str = "未命名") -> str:
    # 与 pj.safe_filename 共用同一份清洗实现，配置名额外限制 60 字符
    return pj.clean_filename(name, fallback, max_length=60)


def config_stem(name: str) -> str:
    """配置名规范化：清洗后去掉多余的 .csv 后缀，避免生成 name.csv.csv。"""
    stem = safe_name(name)
    if stem.lower().endswith(".csv"):
        stem = stem[:-4]
    return stem


def config_path(name: str) -> str:
    return os.path.join(cfg().config_dir, config_stem(name) + ".csv")


def err(msg: str, status: int = 400) -> tuple[Response, int]:
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
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
