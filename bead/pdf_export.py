"""PDF export: A4 single page, A4 multi-page, A3-or-A4 auto fit."""

from __future__ import annotations

import base64
import io
import math

from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas

from bead.export import (
    _font,
    build_palette_map,
    legend_height,
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


def needs_split(width: int, height: int) -> bool:
    return width > SPLIT_WIDTH_THRESHOLD or height > SPLIT_HEIGHT_THRESHOLD


def pdf_paper(width: int, height: int) -> tuple[float, float]:
    """A3 或 A4 的判定：宽/高任一超过分页阈值用 A3，否则 A4。"""
    return A3_MM if needs_split(width, height) else A4_MM


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


def _tile_data(
    grid: list[int],
    width: int,
    codes: list[str] | None,
    palette_map: dict[int, str],
    full_legend: list[dict],
    col: int,
    row: int,
    tile_w: int,
    tile_h: int,
) -> tuple[list[int], list[str], list[dict]]:
    """单趟提取分页数据：子网格 + 子色号 + 本页图例（避免每页两次全量扫描）。"""
    sub = []
    subcodes = []
    counts: dict[int, int] = {}
    code_by_hex = {str(e.get("hex", "")).upper(): e.get("code", "") for e in full_legend}
    for y in range(row - 1, row - 1 + tile_h):
        for x in range(col - 1, col - 1 + tile_w):
            p = y * width + x
            v = grid[p]
            sub.append(v)
            subcodes.append(codes[p] if codes else "")
            if v >= 0:
                counts[v] = counts.get(v, 0) + 1
    legend = []
    for idx, count in counts.items():
        hex_color = palette_map.get(idx, "#FFFFFF")
        legend.append({
            "hex": hex_color,
            "code": code_by_hex.get(hex_color.upper(), ""),
            "count": count,
        })
    legend.sort(key=lambda e: (-e["count"], e["code"]))
    return sub, subcodes, legend


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
    legend_h = legend_height(legend_count, grid_w, cell) if show_legend else 0
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
    force_portrait: bool = False,
) -> Image.Image:
    landscape = not force_portrait and width > height
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
) -> list[tuple[str, Image.Image]]:
    pages = [(
        "总",
        _render_page(
            width,
            height,
            grid,
            palette_map,
            codes,
            legend,
            options,
            "总",
            A4_MM,
            dpi=dpi,
            force_portrait=True,
        ),
    )]
    tiles = page_tiles(width, height)
    split_needed = needs_split(width, height)
    if not split_needed:
        return pages
    for i, tile in enumerate(tiles, 1):
        sub, subcodes, page_legend = _tile_data(
            grid,
            width,
            codes,
            palette_map,
            legend,
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
            force_portrait=True,
        )))
    return pages


def build_pdf_pages(
    mode: str,
    width: int,
    height: int,
    grid: list[int],
    palette: list[dict],
    legend: list[dict],
    codes: list[str] | None,
    options: dict,
    dpi: int = DPI,
) -> list[tuple[str | None, Image.Image, tuple[float, float]]]:
    """按模式生成 PDF 各页图像（标签 + 图像 + 纸张），导出与预览共用。"""
    palette_map = build_palette_map(palette)
    pages: list[tuple[str | None, Image.Image, tuple[float, float]]] = []
    if mode == "pdf-a4":
        pages.append(("1", _render_single(width, height, grid, palette_map, codes, legend, options, A4_MM, dpi=dpi), A4_MM))
    elif mode == "pdf-multi-a4":
        pages.extend((*p, A4_MM) for p in _render_multi_a4(width, height, grid, palette_map, codes, legend, options, dpi=dpi))
    elif mode == "pdf-a3-a4":
        paper = pdf_paper(width, height)
        pages.append(("1", _render_single(width, height, grid, palette_map, codes, legend, options, paper, dpi=dpi), paper))
    else:
        raise ValueError("不支持的 PDF 格式")
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
    pages = build_pdf_pages(mode, width, height, grid, palette, legend, codes, options, dpi=DPI)
    images = [img for _label, img, _paper in pages]
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
    pages = build_pdf_pages(mode, width, height, grid, palette, legend, codes, options, dpi=PREVIEW_DPI)

    results = []
    for label, img, paper in pages:
        buf = io.BytesIO()
        img.save(buf, "PNG")
        paper_name = "A3" if paper == A3_MM else "A4"
        results.append({
            "page": label or "1",
            "paper": paper_name,
            "landscape": img.width > img.height,
            "width": img.width,
            "height": img.height,
            "dataUrl": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
        })
    return results
