"""Soul String Fuse Beads Project (.ssfbp) binary container.

Layout:
  header: magic(8) + format_version(4) + section_count(4) + flags(4) + sha256(32)
  section table: id(16) + offset(8) + length(8) + uncompressed(8) + flags(4) + crc32(4) + reserved(4)
  section data
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import struct
import zlib
from datetime import datetime

MAGIC = b"FUSEBEAD"
FORMAT_VERSION = 1
HEADER_SIZE = 8 + 4 + 4 + 4 + 32
ENTRY_SIZE = 16 + 8 + 8 + 8 + 4 + 4 + 4
FLAG_ZLIB = 1

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


def meta_json(app_version: str = "0.4.0") -> bytes:
    return json.dumps({
        "formatVersion": FORMAT_VERSION,
        "appVersion": app_version,
        "savedAt": datetime.now().isoformat(timespec="seconds"),
    }, ensure_ascii=False).encode("utf-8")
