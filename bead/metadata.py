"""导出文件元数据：JPG EXIF / PNG tEXt / PDF docinfo 共用同一套字段值。"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from reportlab.pdfgen import canvas as rl_canvas

from bead.meta import (
    APP_NAME_ZH,
    AUTHOR_DISPLAY,
    COPYRIGHT,
    REPO_URL,
    software_name,
)


def export_description(
    width: int, height: int, total_count: int, now: datetime | None = None
) -> str:
    """Description 字段：图案尺寸 / 总豆量 / 导出时间。"""
    stamp = (now or datetime.now()).strftime("%Y-%m-%d %H:%M:%S")
    return f"由{APP_NAME_ZH}生成的拼豆图案：{width}×{height}，共 {total_count} 豆，导出于 {stamp}"


def metadata_values(
    width: int, height: int, total_count: int, now: datetime | None = None
) -> dict[str, str]:
    """统一元数据字段（不含动态尺寸的软件名等单独处理）。"""
    return {
        "title": f"{APP_NAME_ZH}生成的拼豆图案",
        "author": AUTHOR_DISPLAY,
        "copyright": COPYRIGHT,
        "description": export_description(width, height, total_count, now),
        "software": software_name(),
        "url": REPO_URL,
    }


def jpeg_exif(values: dict[str, str]) -> object:
    """构造 JPG EXIF（Image.Exif，可传给 img.save(..., exif=...)）。

    EXIF 文本字段按 UTF-8 字节写入：PIL 对 str 会按 ASCII 编码并丢弃非 ASCII
    字符（中文/© 变 ?），因此传 bytes 以保留完整中文与版权符号。
    """
    from PIL import Image

    exif = Image.Exif()
    exif[0x010E] = values["description"].encode("utf-8")  # ImageDescription
    exif[0x0131] = values["software"].encode("utf-8")     # Software
    exif[0x013B] = values["author"].encode("utf-8")       # Artist
    exif[0x8298] = values["copyright"].encode("utf-8")    # Copyright
    return exif


def png_text(values: dict[str, str]) -> object:
    """构造 PNG tEXt 文本块（PngInfo，可传给 img.save(..., pnginfo=...)）。"""
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("Title", values["title"])
    info.add_text("Author", values["author"])
    info.add_text("Artist", values["author"])
    info.add_text("Description", values["description"])
    info.add_text("Copyright", values["copyright"])
    info.add_text("Software", values["software"])
    info.add_text("URL", values["url"])
    return info


def apply_pdf_docinfo(canvas: rl_canvas.Canvas, values: dict[str, str]) -> None:
    """把元数据写入 reportlab Canvas 的文档信息字典。"""
    canvas.setTitle(values["title"])
    canvas.setAuthor(values["author"])
    canvas.setSubject(values["description"])
    canvas.setCreator(values["software"])
    canvas.setProducer(values["software"])
    canvas.setKeywords(f"{APP_NAME_ZH}, fuse beads, perler, 拼豆, 图案")
