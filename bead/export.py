"""Render the bead grid as a raster image (JPG/PNG)."""

from __future__ import annotations

import math

from PIL import Image, ImageDraw, ImageFont

from bead.colors import is_light_color

# ---------------- 渲染常量 ----------------
# 与 static/js/constants.js 及前端 render.js 对应，改动时需同步。
MARGIN_CELLS = 5                     # GRID_MARGIN_CELLS：图案外侧灰色 × 边距格数
DEFAULT_CELL = 20                    # EXPORT_CELL_DEFAULT：默认每格像素
DEFAULT_QUALITY = 95                 # 导出 JPG 默认质量

# 图例布局
LEGEND_ENTRY_W = 7.0                 # 图例每项预估宽度（格）
LEGEND_PAD_RATIO = 0.9               # 图例左右留白（格）
LEGEND_ROW_HEIGHT_CELLS = 2.0        # 图例每行高度（格）
LEGEND_ROW_GAP = 8                   # 图例行间距（像素）
LEGEND_BOTTOM_GAP_RATIO = 1.2        # 图例下方留白（格）
LEGEND_TOP_OFFSET_RATIO = 0.6        # 图例起始纵偏移（格）
LEGEND_FONT_RATIO = 0.9              # 图例字体大小（格）
LEGEND_FONT_MIN = 12
LEGEND_SWATCH_RATIO = 1.1            # 图例色块大小（格）
LEGEND_SWATCH_MIN = 8
LEGEND_ROW_EXTRA_H = 10              # 图例行高在色块外追加的高度
LEGEND_ROW_FONT_EXTRA = 20           # 图例行高在字体外追加的高度
LEGEND_TEXT_GAP = 8                  # 色块与文字间距
LEGEND_TEXT_DESCENT = 2              # 文字基线微调
LEGEND_SWATCH_BORDER = "#999999"
LEGEND_TEXT_COLOR = "#333333"

# 网格线
GRID_LINE_THIN_RATIO = 0.04          # 细网格线宽（格）
GRID_LINE_THICK_RATIO = 0.10         # 每 5 格加粗线宽（格）
GRID_LINE_COLOR = "#9A9A9A"

# 格内色号
CODE_MIN_CELL = 8                    # 格尺寸小于该值时不在格内显示色号
CODE_FONT_RATIO = 0.5                # 格内色号字号（格）
FONT_MIN = 8
FONT_CANDIDATES = ("arial.ttf", "segoeui.ttf", "msyh.ttc")

# 空位斜线
EMPTY_LINE_DIVISOR = 16              # 斜线线宽 = 格尺寸 // 该值


def _legend_rows(count: int, grid_w: int, cell: int) -> int:
    if not count:
        return 0
    pad = cell * LEGEND_PAD_RATIO
    per_row = max(1, int((grid_w - 2 * pad) // (cell * LEGEND_ENTRY_W)))
    return max(1, math.ceil(count / per_row))


def _font(cell: int, scale: float) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    size = max(FONT_MIN, int(cell * scale))
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _contrast_text(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    return "#111111" if is_light_color((r, g, b)) else "#FFFFFF"


EMPTY_STYLES = {
    "default": ("#ECECEC", "#C8C8C8"),
    "black": ("#000000", "#C8C8C8"),
    "white": ("#FFFFFF", "#C8C8C8"),
}


def _draw_empty(
    draw: ImageDraw.ImageDraw, x0: int, y0: int, cell: int, empty_style: str = "default"
) -> None:
    bg, line = EMPTY_STYLES.get(empty_style, EMPTY_STYLES["default"])
    draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=bg)
    lw = max(1, cell // EMPTY_LINE_DIVISOR)
    draw.line([(x0, y0), (x0 + cell - 1, y0 + cell - 1)], fill=line, width=lw)
    draw.line([(x0 + cell - 1, y0), (x0, y0 + cell - 1)], fill=line, width=lw)


def render_pattern(
    width: int,
    height: int,
    grid: list[int],
    palette_map: dict[int, str],
    cell: int = DEFAULT_CELL,
    grid_lines: bool = True,
    outer_pad: int = 0,
    hatch: bool = True,
    empty_style: str = "default",
    legend: list[dict] | None = None,
    codes: list[str] | None = None,
    show_codes: bool = True,
    show_legend: bool = True,
) -> Image.Image:
    legend = sorted(legend or [], key=lambda e: (-e.get("count", 0), e.get("code", "")))
    grid_w = (width + 2 * MARGIN_CELLS) * cell
    grid_h = (height + 2 * MARGIN_CELLS) * cell
    rows = _legend_rows(len(legend), grid_w, cell) if show_legend else 0
    legend_h = (
        rows * int(cell * LEGEND_ROW_HEIGHT_CELLS + LEGEND_ROW_GAP)
        + int(cell * LEGEND_BOTTOM_GAP_RATIO)
        if rows
        else 0
    )
    total_w = grid_w + 2 * outer_pad
    total_h = grid_h + 2 * outer_pad + legend_h

    img = Image.new("RGB", (total_w, total_h), "white")
    draw = ImageDraw.Draw(img)

    # 单元格：外圈 5 格为透明边距（与空位同底色），内部为图案
    for gy in range(height + 2 * MARGIN_CELLS):
        y0 = outer_pad + gy * cell
        for gx in range(width + 2 * MARGIN_CELLS):
            x0 = outer_pad + gx * cell
            px = gx - MARGIN_CELLS
            py = gy - MARGIN_CELLS
            if 0 <= px < width and 0 <= py < height:
                idx = grid[py * width + px]
                if idx >= 0:
                    draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=palette_map.get(idx, "#FFFFFF"))
                elif hatch:
                    _draw_empty(draw, x0, y0, cell, empty_style)
                else:
                    draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill="#FFFFFF")
            else:
                _draw_empty(draw, x0, y0, cell, empty_style)

    # 网格线（含边距区，每 5 格加粗）
    if grid_lines:
        thin = max(1, round(cell * GRID_LINE_THIN_RATIO))
        thick = max(2, round(cell * GRID_LINE_THICK_RATIO))
        for k in range(width + 2 * MARGIN_CELLS + 1):
            lw = thick if k % 5 == 0 else thin
            x = outer_pad + k * cell
            draw.line([(x, outer_pad), (x, outer_pad + grid_h)], fill=GRID_LINE_COLOR, width=lw)
        for k in range(height + 2 * MARGIN_CELLS + 1):
            lw = thick if k % 5 == 0 else thin
            y = outer_pad + k * cell
            draw.line([(outer_pad, y), (outer_pad + grid_w, y)], fill=GRID_LINE_COLOR, width=lw)

    # 格子内色号
    if show_codes and codes and cell >= CODE_MIN_CELL:
        font = _font(cell, CODE_FONT_RATIO)
        for y in range(height):
            for x in range(width):
                idx = grid[y * width + x]
                if idx < 0:
                    continue
                code = codes[y * width + x]
                if not code:
                    continue
                x0 = outer_pad + (x + MARGIN_CELLS) * cell + cell / 2
                y0 = outer_pad + (y + MARGIN_CELLS) * cell + cell / 2
                fill = palette_map.get(idx, "#FFFFFF")
                rgb = tuple(int(fill.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
                text = _contrast_text(rgb)
                tw, th = draw.textbbox((0, 0), code, font=font)[2:]
                draw.text((x0 - tw / 2, y0 - th / 2), code, fill=text, font=font)

    # 色号图例（按豆数量从多到少排序，约 2 倍字号）
    if legend and show_legend:
        font = _font(cell, LEGEND_FONT_RATIO)
        pad = int(cell * LEGEND_PAD_RATIO)
        entry_w = cell * LEGEND_ENTRY_W
        per_row = max(1, int((grid_w - 2 * pad) // entry_w))
        sw = max(LEGEND_SWATCH_MIN, int(cell * LEGEND_SWATCH_RATIO))
        row_h = max(sw + LEGEND_ROW_EXTRA_H, font.size + LEGEND_ROW_FONT_EXTRA)
        max_x = outer_pad + grid_w - pad
        x = outer_pad + pad
        y = outer_pad + grid_h + int(cell * LEGEND_TOP_OFFSET_RATIO)
        for e in legend:
            if x + entry_w > max_x and x > outer_pad + pad:
                x = outer_pad + pad
                y += row_h
            draw.rectangle(
                [x, y, x + sw - 1, y + sw - 1],
                fill=e.get("hex", "#FFFFFF"),
                outline=LEGEND_SWATCH_BORDER,
            )
            draw.text(
                (x + sw + LEGEND_TEXT_GAP, y + (sw - font.size) // 2 + LEGEND_TEXT_DESCENT),
                f"{e.get('code', '')}x{e.get('count', 0)}",
                fill=LEGEND_TEXT_COLOR,
                font=font,
            )
            x += entry_w

    return img
