"""Soul String Fuse Beads Project (.ssfbp) binary container.

Layout:
  header: magic(8) + format_version(4) + section_count(4) + flags(4) + sha256(32)
  section table: id(16) + offset(8) + length(8) + uncompressed(8) + flags(4) + crc32(4) + reserved(4)
  section data
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import zlib
from datetime import datetime
from pathlib import Path
from ctypes import wintypes

MAGIC = b"FUSEBEAD"
FORMAT_VERSION = 1
HEADER_SIZE = 8 + 4 + 4 + 4 + 32
ENTRY_SIZE = 16 + 8 + 8 + 8 + 4 + 4 + 4
FLAG_ZLIB = 1
OFN_OVERWRITEPROMPT = 0x00000002
OFN_HIDEREADONLY = 0x00000004
OFN_PATHMUSTEXIST = 0x00000800
OFN_FILEMUSTEXIST = 0x00001000


class OPENFILENAMEW(ctypes.Structure):
    _fields_ = [
        ("lStructSize", wintypes.DWORD),
        ("hwndOwner", wintypes.HWND),
        ("hInstance", wintypes.HINSTANCE),
        ("lpstrFilter", wintypes.LPCWSTR),
        ("lpstrCustomFilter", wintypes.LPWSTR),
        ("nMaxCustFilter", wintypes.DWORD),
        ("nFilterIndex", wintypes.DWORD),
        ("lpstrFile", wintypes.LPWSTR),
        ("nMaxFile", wintypes.DWORD),
        ("lpstrFileTitle", wintypes.LPWSTR),
        ("nMaxFileTitle", wintypes.DWORD),
        ("lpstrInitialDir", wintypes.LPCWSTR),
        ("lpstrTitle", wintypes.LPCWSTR),
        ("Flags", wintypes.DWORD),
        ("nFileOffset", wintypes.WORD),
        ("nFileExtension", wintypes.WORD),
        ("lpstrDefExt", wintypes.LPCWSTR),
        ("lCustData", wintypes.LPARAM),
        ("lpfnHook", ctypes.c_void_p),
        ("lpTemplateName", wintypes.LPCWSTR),
        ("pvReserved", ctypes.c_void_p),
        ("dwReserved", wintypes.DWORD),
        ("FlagsEx", wintypes.DWORD),
    ]

INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def section_id(name: str) -> bytes:
    return name.encode("utf-8")[:16].ljust(16, b"\x00")


def build_project_file(sections: dict[str, bytes]) -> bytes:
    order = [k for k in ("meta", "state", "original", "palettes") if k in sections]
    entries = []
    payloads = []
    for name in order:
        raw = sections[name]
        comp = zlib.compress(raw)
        use_zlib = len(comp) < len(raw)
        payload = comp if use_zlib else raw
        entries.append({
            "name": name,
            "offset": 0,
            "length": len(payload),
            "uncompressed": len(raw),
            "flags": FLAG_ZLIB if use_zlib else 0,
            "crc": zlib.crc32(raw) & 0xFFFFFFFF,
        })
        payloads.append(payload)

    table_size = ENTRY_SIZE * len(entries)
    offset = HEADER_SIZE + table_size
    for entry in entries:
        entry["offset"] = offset
        offset += entry["length"]

    digest = hashlib.sha256(b"".join(payloads)).digest()
    header = MAGIC + struct.pack("<III", FORMAT_VERSION, len(entries), 0) + digest
    table = b"".join(
        struct.pack(
            "<16sQQQIII",
            section_id(e["name"]),
            e["offset"],
            e["length"],
            e["uncompressed"],
            e["flags"],
            e["crc"],
            0,
        )
        for e in entries
    )
    return header + table + b"".join(payloads)


def parse_project_file(data: bytes) -> dict[str, bytes]:
    if len(data) < HEADER_SIZE or data[:8] != MAGIC:
        raise ValueError("不是有效的 .ssfbp 项目文件")
    version, count, flags = struct.unpack_from("<III", data, 8)
    if version != FORMAT_VERSION:
        raise ValueError(f"不支持的项目文件版本：{version}")
    if count > 64:
        raise ValueError("项目文件段数量异常")
    digest = data[20:52]
    entries = []
    for i in range(count):
        off = HEADER_SIZE + i * ENTRY_SIZE
        raw_id, eoff, length, uncompressed, eflags, crc, _reserved = struct.unpack_from(
            "<16sQQQIII", data, off
        )
        entries.append({
            "name": raw_id.split(b"\x00", 1)[0].decode("utf-8", errors="replace"),
            "offset": eoff,
            "length": length,
            "uncompressed": uncompressed,
            "flags": eflags,
            "crc": crc,
        })
    stored_payloads = []
    payloads = []
    for e in entries:
        if e["offset"] + e["length"] > len(data):
            raise ValueError("项目文件段越界")
        payload = data[e["offset"]:e["offset"] + e["length"]]
        stored_payloads.append(payload)
        if e["flags"] & FLAG_ZLIB:
            raw = zlib.decompress(payload)
        else:
            raw = payload
        if len(raw) != e["uncompressed"]:
            raise ValueError("项目文件段长度不一致")
        if (zlib.crc32(raw) & 0xFFFFFFFF) != e["crc"]:
            raise ValueError("项目文件段校验失败")
        payloads.append(raw)
    if hashlib.sha256(b"".join(stored_payloads)).digest() != digest:
        raise ValueError("项目文件整体校验失败")
    return {e["name"]: raw for e, raw in zip(entries, payloads)}


def safe_filename(name: str, fallback: str = "未命名") -> str:
    cleaned = INVALID_FILENAME_CHARS.sub("_", str(name or "")).strip()
    cleaned = cleaned.rstrip(". ")
    return cleaned or fallback


def default_project_filename(original_name: str | None = None) -> str:
    date = datetime.now().strftime("%Y%m%d")
    stem = os.path.splitext(os.path.basename(original_name or ""))[0]
    stem = safe_filename(stem)
    return f"{date}_{stem}_拼豆图.ssfbp"


def _powershell_dialog(script: str, arg: str | None = None) -> tuple[str | None, bool]:
    if sys.platform != "win32":
        return None, False
    cmd = ["powershell.exe", "-NoProfile", "-STA", "-Command", script]
    env = os.environ.copy()
    if arg is not None:
        env["SSFBP_DIALOG_ARG"] = arg
    try:
        kwargs = {"capture_output": True, "text": True, "timeout": 30}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        proc = subprocess.run(cmd, env=env, **kwargs)
    except Exception:
        return None, False
    if proc.returncode != 0:
        return None, False
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    return (lines[-1] if lines else None), True


def _win32_file_dialog(kind: str, default_name: str | None = None) -> tuple[str | None, bool]:
    if sys.platform != "win32":
        return None, False
    try:
        filter_buf = ctypes.create_unicode_buffer(
            "拼豆图项目 (*.ssfbp)\0*.ssfbp\0", 64
        )
        file_buf = ctypes.create_unicode_buffer(default_name or "", 4096)
        ofn = OPENFILENAMEW()
        ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
        ofn.hwndOwner = ctypes.windll.user32.GetForegroundWindow()
        ofn.lpstrFilter = ctypes.cast(filter_buf, wintypes.LPCWSTR)
        ofn.lpstrFile = ctypes.cast(file_buf, wintypes.LPWSTR)
        ofn.nMaxFile = 4096
        initial = ensure_default_dir()
        ofn.lpstrInitialDir = str(initial)
        if kind == "open":
            ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY
            fn = ctypes.windll.comdlg32.GetOpenFileNameW
        else:
            ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST
            ofn.lpstrDefExt = "ssfbp"
            fn = ctypes.windll.comdlg32.GetSaveFileNameW
        fn(ctypes.byref(ofn))
        return (file_buf.value or None), True
    except Exception:
        return None, False


def show_save_dialog(default_name: str) -> str | None:
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = "拼豆图项目 (*.ssfbp)|*.ssfbp"
$d.FileName = $env:SSFBP_DIALOG_ARG
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }
"""
    path, _ok = _powershell_dialog(script, default_name)
    return path


def show_save_dialog_result(default_name: str) -> tuple[str | None, bool]:
    path, ok = _win32_file_dialog("save", default_name)
    if ok:
        return path, True
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = "拼豆图项目 (*.ssfbp)|*.ssfbp"
$d.FileName = $env:SSFBP_DIALOG_ARG
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }
"""
    return _powershell_dialog(script, default_name)


def show_open_dialog() -> str | None:
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "拼豆图项目 (*.ssfbp)|*.ssfbp"
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }
"""
    path, _ok = _powershell_dialog(script)
    return path


def show_open_dialog_result() -> tuple[str | None, bool]:
    path, ok = _win32_file_dialog("open")
    if ok:
        return path, True
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "拼豆图项目 (*.ssfbp)|*.ssfbp"
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }
"""
    return _powershell_dialog(script)


def meta_json(app_version: str = "0.4.0") -> bytes:
    return json.dumps({
        "formatVersion": FORMAT_VERSION,
        "appVersion": app_version,
        "savedAt": datetime.now().isoformat(timespec="seconds"),
    }, ensure_ascii=False).encode("utf-8")


def ensure_default_dir() -> Path:
    path = Path.home() / "Documents" / "拼豆图"
    path.mkdir(parents=True, exist_ok=True)
    return path
