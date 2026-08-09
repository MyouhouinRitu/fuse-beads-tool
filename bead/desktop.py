"""桌面运行时：系统托盘、单实例、浏览器自动打开等平台相关逻辑。

仅在 EXE 打包版或 APP_TRAY=1 调试时使用；Docker 等容器内不会启用托盘。
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser

# ---------------- 常量 ----------------
LOCALHOST = "127.0.0.1"
READY_POLL_INTERVAL = 0.1     # 就绪检测轮询间隔（秒）
READY_POLL_TIMEOUT = 0.5      # 单次连接检测超时（秒）
BROWSER_READY_TIMEOUT = 30    # 自动打开浏览器的最长等待（秒）
SECOND_INSTANCE_TIMEOUT = 20  # 第二个实例打开浏览器的最长等待（秒）
TRAY_DOUBLE_CLICK_WINDOW = 0.45  # 托盘图标双击判定窗口（秒）
SINGLE_INSTANCE_MUTEX_NAME = "Local\\fuse-beads-tool-single-instance"
ERROR_ALREADY_EXISTS = 183    # Windows 错误码：命名互斥体已存在

_single_instance_handle = None


def in_container() -> bool:
    """判断是否运行在 Docker 等容器内（容器内不自动打开浏览器）。"""
    if os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv"):
        return True
    try:
        with open("/proc/1/cgroup", "r", encoding="utf-8", errors="ignore") as fh:
            return any(k in fh.read() for k in ("docker", "containerd", "kubepods"))
    except OSError:
        return False


def open_browser_when_ready(
    host: str, port: int, url: str, timeout: float = BROWSER_READY_TIMEOUT
) -> None:
    """轮询端口直到后端可连接，然后立即在浏览器中打开前端页面。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=READY_POLL_TIMEOUT):
                break
        except OSError:
            time.sleep(READY_POLL_INTERVAL)
    else:
        return
    webbrowser.open(url)


def acquire_single_instance() -> bool:
    """Windows 命名互斥体：保证后台进程唯一。

    返回 True 表示本实例取得运行权；返回 False 表示已有实例在运行。
    非 Windows 平台不限制。句柄需在进程存活期间持有，否则互斥体会被释放。
    """
    global _single_instance_handle
    if sys.platform != "win32":
        return True
    try:
        import ctypes

        handle = ctypes.windll.kernel32.CreateMutexW(
            None, False, SINGLE_INSTANCE_MUTEX_NAME
        )
        if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            ctypes.windll.kernel32.CloseHandle(handle)
            return False
        _single_instance_handle = handle
        return True
    except Exception:
        # 互斥体获取失败时放行，避免单实例误伤正常启动
        return True


def start_tray(url: str, resource_dir: str, base_dir: str) -> object | None:
    """系统托盘图标：双击打开网页，右键菜单可退出后台进程。"""
    try:
        import pystray
        from PIL import Image
    except Exception:
        return None

    def _icon_image() -> Image.Image:
        candidates = [
            os.path.join(resource_dir, "assets", "app-icon.png"),
            os.path.join(base_dir, "assets", "app-icon.png"),
        ]
        for p in candidates:
            if os.path.exists(p):
                try:
                    return Image.open(p).convert("RGBA")
                except Exception:
                    pass
        # 兜底：纯色图标
        return Image.new("RGB", (64, 64), (59, 130, 246))

    def _open_web(icon=None, item=None) -> None:
        webbrowser.open(url)

    def _quit(icon=None, item=None) -> None:
        icon.stop()
        os._exit(0)

    # pystray(Windows) 单击左键会触发默认菜单项，且没有原生双击事件。
    # 用一个隐藏的默认项做点击计数：单击只记时间，窗口时间内第二次点击才打开网页，
    # 避免误触；右键菜单里的「打开拼豆工具」则直接生效。
    click_state = {"last": 0.0}

    def _on_tray_click(icon=None, item=None) -> None:
        now = time.monotonic()
        if now - click_state["last"] <= TRAY_DOUBLE_CLICK_WINDOW:
            click_state["last"] = 0.0
            webbrowser.open(url)
        else:
            click_state["last"] = now

    menu = pystray.Menu(
        pystray.MenuItem("打开拼豆工具", _open_web),
        pystray.MenuItem("退出", _quit),
        pystray.MenuItem("__tray_click__", _on_tray_click, default=True, visible=False),
    )
    icon = pystray.Icon("fuse-beads-tool", _icon_image(), "拼豆工具", menu=menu)
    try:
        threading.Thread(target=icon.run, daemon=True).start()
    except Exception:
        return None
    return icon
