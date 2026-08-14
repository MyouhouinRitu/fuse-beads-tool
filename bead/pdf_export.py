"""PDF export: A4 single page, A4 multi-page, A3-or-A4 auto fit."""

from __future__ import annotations

import base64
import io
import math

from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas

from bead.export import (
    LEGEND_BOTTOM_GAP_RATIO,
    LEGEND_FONT_MIN,
    LEGEND_FONT_RATIO,
    LEGEND_ROW_EXTRA_H,
    LEGEND_ROW_FONT_EXTRA,
    LEGEND_SWATCH_MIN,
    LEGEND_SWATCH_RATIO,
    _font,
    _legend_rows,
    render_pattern,
)

DPI = 300
PREVIEW_DPI = 120
MM_PER_INCH = 25.4
A4_MM = (210, 297)
A3_MM = (297, 420)
MARGIN_MM = 5
SPLIT_WIDTH_THRESHOLD = 50
SPLIT_HEIGHT_THRESHOLD = 60


def _px(mm: float, dpi: int = DPI) -> int:
    return max(1, round(mm * dpi / MM_PER_INCH))


def _round_up_5(n: float) -> int:
    return int(math.ceil(n / 5) * 5)


def page_tiles(width: int, height: int) -> list[dict[str, int]]:
    """分页 A4 的图块划分：宽 >50 拆两段，高 >60 拆两段，段长向上取整到 5。"""
    cols = [width]
    if width > SPLIT_WIDTH_THRESHOLD:
        first = _round_up_5(width / 2)
        cols = [first, width - first]
    rows = [height]
    if height > SPLIT_HEIGHT_THRESHOLD:
        first = _round_up_5(height / 2)
        rows = [first, height - first]

    tiles = []
    row_start = 1
    for rh in rows:
        col_start = 1
        for cw in cols:
            tiles.append({
                "col": col_start,
                "row": row_start,
                "width": cw,
                "height": rh,
            })
            col_start += cw
        row_start += rh
    return tiles


def _page_legend(
    grid: list[int],
    width: int,
    palette_map: dict[int, str],
    full_legend: list[dict],
    col: int,
    row: int,
    tile_w: int,
    tile_h: int,
) -> list[dict]:
    counts: dict[int, int] = {}
    for y in range(row - 1, row - 1 + tile_h):
        for x in range(col - 1, col - 1 + tile_w):
            idx = grid[y * width + x]
            if idx >= 0:
                counts[idx] = counts.get(idx, 0) + 1
    code_by_hex = {str(e.get("hex", "")).upper(): e.get("code", "") for e in full_legend}
    entries = []
    for idx, count in counts.items():
        hex_color = palette_map.get(idx, "#FFFFFF")
        entries.append({
            "hex": hex_color,
            "code": code_by_hex.get(hex_color.upper(), ""),
            "count": count,
        })
    entries.sort(key=lambda e: (-e["count"], e["code"]))
    return entries


def _subgrid(
    grid: list[int],
    width: int,
    codes: list[str] | None,
    col: int,
    row: int,
    tile_w: int,
    tile_h: int,
) -> tuple[list[int], list[str]]:
    sub = []
    subcodes = []
    for y in range(row - 1, row - 1 + tile_h):
        for x in range(col - 1, col - 1 + tile_w):
            p = y * width + x
            sub.append(grid[p])
            subcodes.append(codes[p] if codes else "")
    return sub, subcodes


def _fits(
    cell: int,
    width: int,
    height: int,
    legend_count: int,
    page_w: int,
    page_h: int,
    margin: int,
    edge_numbers: bool,
    show_legend: bool,
) -> bool:
    edge = cell if edge_numbers else 0
    grid_w = width * cell
    grid_h = height * cell
    rows = _legend_rows(legend_count, grid_w, cell) if show_legend else 0
    font_size = max(LEGEND_FONT_MIN, int(cell * LEGEND_FONT_RATIO))
    sw = max(LEGEND_SWATCH_MIN, int(cell * LEGEND_SWATCH_RATIO))
    row_h = max(sw + LEGEND_ROW_EXTRA_H, font_size + LEGEND_ROW_FONT_EXTRA)
    legend_h = rows * row_h + int(cell * LEGEND_BOTTOM_GAP_RATIO) if rows else 0
    total_w = grid_w + 2 * edge + 2 * margin
    total_h = grid_h + 2 * edge + 2 * margin + legend_h
    return total_w <= page_w and total_h <= page_h


def _max_cell(
    width: int,
    height: int,
    legend_count: int,
    page_w: int,
    page_h: int,
    margin: int,
    edge_numbers: bool,
    show_legend: bool,
) -> int:
    lo, hi = 1, max(2, max(page_w, page_h) // 2)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if _fits(mid, width, height, legend_count, page_w, page_h, margin, edge_numbers, show_legend):
            lo = mid
        else:
            hi = mid - 1
    return max(1, lo)


def _render_page(
    width: int,
    height: int,
    grid: list[int],
    palette_map: dict[int, str],
    codes: list[str] | None,
    legend: list[dict],
    options: dict,
    label: str | None,
    paper_mm: tuple[float, float],
    col: int = 1,
    row: int = 1,
    dpi: int = DPI,
) -> Image.Image:
    landscape = width > height
    page_w_mm, page_h_mm = (max(paper_mm), min(paper_mm)) if landscape else (min(paper_mm), max(paper_mm))
    page_w = _px(page_w_mm, dpi)
    page_h = _px(page_h_mm, dpi)
    margin = _px(MARGIN_MM, dpi)
    edge_numbers = bool(options.get("edgeNumbers"))
    show_legend = bool(options.get("legend", True))

    cell = _max_cell(
        width,
        height,
        len(legend),
        page_w,
        page_h,
        margin,
        edge_numbers,
        show_legend,
    )
    img = render_pattern(
        width,
        height,
        grid,
        palette_map,
        cell=cell,
        grid_lines=bool(options.get("gridLines", True)),
        outer_pad=margin,
        hatch=True,
        empty_style=options.get("emptyStyle") or "default",
        legend=legend,
        codes=codes,
        show_codes=bool(options.get("showCodes", True)),
        show_legend=show_legend,
        edge_numbers=edge_numbers,
        col_offset=col - 1,
        row_offset=row - 1,
    )
    canvas = Image.new("RGB", (page_w, page_h), "white")
    canvas.paste(img, ((page_w - img.width) // 2, (page_h - img.height) // 2))
    if label:
        draw = ImageDraw.Draw(canvas)
        label_size = max(24, int(margin * 2.5))
        label_font = _font(label_size, 1.0)
        draw.text(
            (page_w - margin * 0.15, margin * 0.05),
            label,
            fill="#000000",
            font=label_font,
            anchor="ra",
        )
    return canvas


def _render_single(
    width: int,
    height: int,
    grid: list[int],
    palette_map: dict[int, str],
    codes: list[str] | None,
    legend: list[dict],
    options: dict,
    paper_mm: tuple[float, float],
    dpi: int = DPI,
) -> Image.Image:
    return _render_page(width, height, grid, palette_map, codes, legend, options, None, paper_mm, dpi=dpi)


def _render_multi_a4(
    width: int,
    height: int,
    grid: list[int],
    palette_map: dict[int, str],
    codes: list[str] | None,
    legend: list[dict],
    options: dict,
    dpi: int = DPI,
) -> list[tuple[str | None, Image.Image]]:
    pages = [(
        "总",
        _render_page(width, height, grid, palette_map, codes, legend, options, "总", A4_MM, dpi=dpi),
    )]
    tiles = page_tiles(width, height)
    split_needed = width > SPLIT_WIDTH_THRESHOLD or height > SPLIT_HEIGHT_THRESHOLD
    if not split_needed:
        return pages
    for i, tile in enumerate(tiles, 1):
        sub, subcodes = _subgrid(
            grid, width, codes,
            tile["col"], tile["row"], tile["width"], tile["height"],
        )
        page_legend = _page_legend(
            grid, width, palette_map, legend,
            tile["col"], tile["row"], tile["width"], tile["height"],
        )
        pages.append((str(i), _render_page(
            tile["width"],
            tile["height"],
            sub,
            palette_map,
            subcodes,
            page_legend,
            options,
            str(i),
            A4_MM,
            col=tile["col"],
            row=tile["row"],
            dpi=dpi,
        )))
    return pages


def export_pdf(
    mode: str,
    width: int,
    height: int,
    grid: list[int],
    palette: list[dict],
    legend: list[dict],
    codes: list[str] | None,
    options: dict,
) -> bytes:
    palette_map = {c["index"]: c["hex"] for c in palette}
    if mode == "pdf-a4":
        pages = [(None, _render_single(width, height, grid, palette_map, codes, legend, options, A4_MM))]
    elif mode == "pdf-multi-a4":
        pages = _render_multi_a4(width, height, grid, palette_map, codes, legend, options)
    elif mode == "pdf-a3-a4":
        paper = A3_MM if width > SPLIT_WIDTH_THRESHOLD or height > SPLIT_HEIGHT_THRESHOLD else A4_MM
        pages = [(None, _render_single(width, height, grid, palette_map, codes, legend, options, paper))]
    else:
        raise ValueError("不支持的 PDF 格式")

    images = [img for _label, img in pages]
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf)
    for img in images:
        page_w_pt = img.width / DPI * 72
        page_h_pt = img.height / DPI * 72
        c.setPageSize((page_w_pt, page_h_pt))
        c.drawImage(ImageReader(img), 0, 0, width=page_w_pt, height=page_h_pt)
        c.showPage()
    c.save()
    return buf.getvalue()


def export_pdf_previews(
    mode: str,
    width: int,
    height: int,
    grid: list[int],
    palette: list[dict],
    legend: list[dict],
    codes: list[str] | None,
    options: dict,
) -> list[dict]:
    """生成 PDF 每页的低分辨率 PNG 预览（含页码/纸张/方向元数据）。"""
    palette_map = {c["index"]: c["hex"] for c in palette}
    if mode == "pdf-a4":
        pages = [("1", _render_single(width, height, grid, palette_map, codes, legend, options, A4_MM, dpi=PREVIEW_DPI))]
    elif mode == "pdf-multi-a4":
        pages = _render_multi_a4(width, height, grid, palette_map, codes, legend, options, dpi=PREVIEW_DPI)
    elif mode == "pdf-a3-a4":
        paper = A3_MM if width > SPLIT_WIDTH_THRESHOLD or height > SPLIT_HEIGHT_THRESHOLD else A4_MM
        label = "1"
        pages = [(label, _render_single(width, height, grid, palette_map, codes, legend, options, paper, dpi=PREVIEW_DPI))]
    else:
        raise ValueError("不支持的 PDF 格式")

    results = []
    for label, img in pages:
        buf = io.BytesIO()
        img.save(buf, "PNG")
        paper_name = "A3" if (
            mode == "pdf-a3-a4" and (width > SPLIT_WIDTH_THRESHOLD or height > SPLIT_HEIGHT_THRESHOLD)
        ) else "A4"
        results.append({
            "page": label or "1",
            "paper": paper_name,
            "landscape": img.width > img.height,
            "width": img.width,
            "height": img.height,
            "dataUrl": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
        })
    return results
