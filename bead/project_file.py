"""Soul String Fuse Beads Project (.ssfbp) binary container.

Layout:
  header: magic(8) + format_version(4) + section_count(4) + flags(4) + sha256(32)
  section table: id(16) + offset(8) + length(8) + uncompressed(8) + flags(4) + crc32(4) + reserved(4)
  section data
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import zlib
from datetime import datetime

from bead.version import APP_VERSION

MAGIC = b"FUSEBEAD"
FORMAT_VERSION = 1
HEADER_SIZE = 8 + 4 + 4 + 4 + 32
ENTRY_SIZE = 16 + 8 + 8 + 8 + 4 + 4 + 4
FLAG_ZLIB = 1
MAX_SECTION_BYTES = 512 * 1024 * 1024  # 单个段解压后体积上限（防解压炸弹）

INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
RESERVED_WINDOWS_NAMES = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


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
    table_end = HEADER_SIZE + count * ENTRY_SIZE
    seen_names: set[str] = set()
    for i in range(count):
        off = HEADER_SIZE + i * ENTRY_SIZE
        raw_id, eoff, length, uncompressed, eflags, crc, _reserved = struct.unpack_from(
            "<16sQQQIII", data, off
        )
        name = raw_id.split(b"\x00", 1)[0].decode("utf-8", errors="replace")
        if name in seen_names:
            raise ValueError("项目文件段名重复")
        seen_names.add(name)
        if eflags & ~FLAG_ZLIB:
            raise ValueError("项目文件段标志不受支持")
        if eoff < table_end:
            raise ValueError("项目文件段偏移异常")
        entries.append({
            "name": name,
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
        if e["uncompressed"] > MAX_SECTION_BYTES:
            raise ValueError("项目文件段体积超限")
        payload = data[e["offset"]:e["offset"] + e["length"]]
        stored_payloads.append(payload)
        if e["flags"] & FLAG_ZLIB:
            try:
                raw = zlib.decompress(payload)
            except zlib.error:
                raise ValueError("项目文件段解压失败")
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


def decode_grid_base64(b64: str) -> list[int]:
    """解码前端 grid-codec.js 的小端 Int16Array base64 网格；损坏时抛 ValueError。"""
    try:
        raw = base64.b64decode(b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("项目网格数据无法解码") from exc
    if not raw or len(raw) % 2 != 0:
        raise ValueError("项目网格数据无法解码")
    return list(struct.unpack(f"<{len(raw) // 2}h", raw))


def validate_project_document(doc: dict) -> None:
    """校验项目文档的领域载荷：尺寸 / 网格长度 / 网格值域。

    与前端 static/js/validate.js 保持同一套规则；
    不合法时抛 ValueError（由路由转成 JSON 400），避免把损坏文档写入原图目录或状态。
    """
    project = doc.get("project")
    if not isinstance(project, dict):
        raise ValueError("项目缺少画布数据")
    width = project.get("width")
    height = project.get("height")
    if (
        not isinstance(width, int)
        or not isinstance(height, int)
        or width <= 0
        or height <= 0
    ):
        raise ValueError("项目尺寸无效")
    grid = project.get("grid")
    grid_base64 = project.get("gridBase64")
    if isinstance(grid, list):
        if len(grid) != width * height:
            raise ValueError("项目网格数据无效")
        for v in grid:
            if not isinstance(v, int) or v < -1:
                raise ValueError("项目网格包含非法值")
    elif isinstance(grid_base64, str):
        try:
            values = decode_grid_base64(grid_base64)
        except ValueError as exc:
            raise ValueError("项目网格数据无法解码") from exc
        if len(values) != width * height:
            raise ValueError("项目网格数据无效")
        if any(v < -1 for v in values):
            raise ValueError("项目网格包含非法值")
    else:
        raise ValueError("项目网格数据无效")


def safe_filename(name: str, fallback: str = "未命名") -> str:
    return clean_filename(name, fallback)


def clean_filename(
    name: str | None,
    fallback: str = "未命名",
    max_length: int | None = None,
) -> str:
    """统一文件名清洗：替换非法字符、去首尾空白、可选截断、去结尾点/空格。

    所有「把任意字符串变成安全文件名」的入口都应走本函数；
    需要不同长度上限的调用方通过 max_length 表达（如配置名 60、项目文件不截断）。
    """
    cleaned = INVALID_FILENAME_CHARS.sub("_", str(name or "").strip())
    if max_length is not None:
        cleaned = cleaned[:max_length]
    stem = cleaned.split(".", 1)[0].upper()
    if stem in RESERVED_WINDOWS_NAMES:
        cleaned = "_" + cleaned  # Windows 保留名（CON/NUL/COM1 等）加前缀避免创建失败
    cleaned = cleaned.rstrip(". ")
    return cleaned or fallback


def default_project_filename(original_name: str | None = None) -> str:
    date = datetime.now().strftime("%Y%m%d")
    stem = os.path.splitext(os.path.basename(original_name or ""))[0]
    stem = safe_filename(stem)
    return f"{date}_{stem}_拼豆图.ssfbp"


def meta_json(app_version: str = APP_VERSION) -> bytes:
    return json.dumps({
        "formatVersion": FORMAT_VERSION,
        "appVersion": app_version,
        "savedAt": datetime.now().isoformat(timespec="seconds"),
    }, ensure_ascii=False).encode("utf-8")
