"""图案导出与 PDF 分页预览路由。"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import struct
import threading
import time
import zlib
from collections import OrderedDict

from flask import Blueprint, jsonify, request, send_file

from bead import export as ex
from bead import metadata as md
from bead import pdf_export as pdfx
from bead import watermark as wm
from bead.web.common import err, opt_bool, opt_int

SUPPORTED_EXPORT_FORMATS = {"png", "jpg", "pdf-a4", "pdf-multi-a4", "pdf-a3-a4"}

PDF_PREVIEW_CACHE_SIZE = 4  # PDF 分页预览内存缓存条数
PDF_PREVIEW_CACHE_TTL = 60.0  # PDF 分页预览缓存有效期（秒）

_pdf_preview_cache: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()
_pdf_preview_lock = threading.Lock()

export_bp = Blueprint("export", __name__)


def parse_export_grid(data: dict) -> tuple[int, int, list[int]]:
    """解析并校验导出请求的网格数据，失败时抛 ValueError（由路由转成 JSON 400）。"""
    try:
        width = int(data.get("width", 0))
        height = int(data.get("height", 0))
        grid = [int(v) for v in data.get("grid", [])]
    except (TypeError, ValueError):
        raise ValueError("网格数据无效")
    if width <= 0 or height <= 0 or len(grid) != width * height:
        raise ValueError("网格数据无效")
    return width, height, grid


def _pdf_preview_cache_key(
    fmt: str,
    width: int,
    height: int,
    grid: list[int],
    payload: dict,
    opts: dict,
) -> str:
    """预览缓存键：网格用轻量 CRC 摘要，其余选项按规范化 JSON 哈希，避免大网格重复序列化。"""
    grid_digest = zlib.crc32(
        b"".join(struct.pack("<h", v) for v in grid)
    ) & 0xFFFFFFFF
    canonical = json.dumps(
        {
            "fmt": fmt,
            "width": width,
            "height": height,
            "gridCrc": grid_digest,
            "palette": payload.get("palette", []),
            "legend": payload.get("legend", []),
            "codes": payload.get("codes") or None,
            "options": opts,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@export_bp.post("/api/export")
def api_export():
    data = request.get_json(force=True)
    try:
        width, height, grid = parse_export_grid(data)
    except ValueError as e:
        return err(str(e))
    opts = data.get("options", {})
    fmt = (opts.get("format") or "jpg").lower()
    if fmt not in SUPPORTED_EXPORT_FORMATS:
        return err("不支持的导出格式，仅支持 png / jpg / PDF")

    try:
        total_count = sum(int(e.get("count", 0)) for e in data.get("legend", []))
        meta_values = md.metadata_values(width, height, total_count)
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
                metadata=meta_values,
            )
            return send_file(
                io.BytesIO(pdf_bytes),
                mimetype="application/pdf",
                as_attachment=True,
                download_name="拼豆图案.pdf",
            )

        img = ex.render_pattern(
            width,
            height,
            grid,
            ex.build_palette_map(data.get("palette", [])),
            cell=opt_int(opts.get("cellSize"), ex.DEFAULT_CELL),
            grid_lines=opt_bool(opts.get("gridLines"), True),
            outer_pad=opt_int(opts.get("outerPad"), 0),
            hatch=opt_bool(opts.get("hatch"), True),
            empty_style=opts.get("emptyStyle") or "default",
            legend=data.get("legend", []),
            codes=data.get("codes", []),
            show_codes=opt_bool(opts.get("showCodes"), True),
            show_legend=opt_bool(opts.get("legend"), True),
            edge_numbers=opt_bool(opts.get("edgeNumbers"), False),
        )
        # 导出图片叠加隐写水印（肉眼不可见，JPG 亦可提取）
        img = wm.embed(img)
        buf = io.BytesIO()
        if fmt == "png":
            img.save(buf, "PNG", pnginfo=md.png_text(meta_values))
        else:
            img.save(
                buf,
                "JPEG",
                quality=opt_int(opts.get("quality"), ex.DEFAULT_QUALITY),
                exif=md.jpeg_exif(meta_values),
            )
        buf.seek(0)
        mime = "image/png" if fmt == "png" else "image/jpeg"
        ext = "png" if fmt == "png" else "jpg"
        return send_file(
            buf,
            mimetype=mime,
            as_attachment=True,
            download_name=f"拼豆图案.{ext}",
        )
    except Exception:
        logging.getLogger(__name__).exception("导出失败")
        return err("导出失败，请重试", 500)


@export_bp.post("/api/export-preview")
def api_export_preview():
    data = request.get_json(force=True)
    try:
        width, height, grid = parse_export_grid(data)
    except ValueError as e:
        return err(str(e))
    opts = data.get("options", {})
    fmt = (opts.get("format") or "jpg").lower()
    if fmt not in SUPPORTED_EXPORT_FORMATS:
        return err("不支持的导出格式，仅支持 png / jpg / PDF")
    if not fmt.startswith("pdf-"):
        return err("仅 PDF 格式支持分页预览")
    cache_key = _pdf_preview_cache_key(
        fmt, width, height, grid, data, opts,
    )
    now = time.monotonic()
    with _pdf_preview_lock:
        cached = _pdf_preview_cache.get(cache_key)
        if cached and now - cached[0] < PDF_PREVIEW_CACHE_TTL:
            _pdf_preview_cache.move_to_end(cache_key)
            return jsonify({"pages": cached[1]})
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
    with _pdf_preview_lock:
        _pdf_preview_cache[cache_key] = (time.monotonic(), pages)
        _pdf_preview_cache.move_to_end(cache_key)
        while len(_pdf_preview_cache) > PDF_PREVIEW_CACHE_SIZE:
            _pdf_preview_cache.popitem(last=False)
    return jsonify({"pages": pages})
