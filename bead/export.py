"""Render the bead grid as a raster image (JPG/PNG)."""

from __future__ import annotations

import math
from typing import cast

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from bead.colors import is_light_color
from bead.meta import ATTRIBUTION_TEXT

# ---------------- 渲染常量 ----------------
# 与 static/js/constants.js 及前端 render.js 对应，改动时需同步；
# 改任一侧后必须运行 tests/constants_sync_test.mjs 与 tests/render_consistency_test.mjs。
DEFAULT_CELL = 28                    # EXPORT_CELL_DEFAULT：默认每格像素
DEFAULT_QUALITY = 95                 # 导出 JPG 默认质量

# 图例布局
LEGEND_ENTRY_W = 7.0                 # 图例每项预估宽度（格）
LEGEND_PAD_RATIO = 0.9               # 图例左右留白（格）
LEGEND_BOTTOM_GAP_RATIO = 0.6        # 图例下方留白（格）
LEGEND_TOP_OFFSET_RATIO = 0.6        # 图例起始纵偏移（格）
LEGEND_FONT_RATIO = 0.9              # 图例字体大小（格）
LEGEND_FONT_MIN = 12
LEGEND_SWATCH_RATIO = 1.1            # 图例色块大小（格）
LEGEND_SWATCH_MIN = 8
LEGEND_ROW_EXTRA_H = 10              # 图例行高在色块外追加的高度
LEGEND_ROW_FONT_EXTRA = 20           # 图例行高在字体外追加的高度
LEGEND_TEXT_GAP = 8                  # 色块与文字间距
LEGEND_SWATCH_BORDER = "#999999"
LEGEND_TEXT_COLOR = "#333333"

# 底部署名（图案与图例之间、右侧对齐；与 static/js/constants.js ATTRIBUTION_* 对应）
ATTRIBUTION_FONT_RATIO = 0.7       # 署名字号（格）
ATTRIBUTION_FONT_MIN = 11
ATTRIBUTION_TOP_GAP_RATIO = 0.4    # 署名上方间距（格）
ATTRIBUTION_BOTTOM_GAP_RATIO = 0.4 # 署名下方间距（格）
ATTRIBUTION_TEXT_COLOR = "#8A8A8A"

# 网格线
GRID_LINE_THIN_RATIO = 0.04          # 细网格线宽（格）
GRID_LINE_THICK_RATIO = 0.10         # 每 5 格加粗线宽（格）
GRID_LINE_COLOR = "#9A9A9A"
GRID_DASH_RATIO = 0.5                # 每 5 格虚线每段长度（格）
GRID_BOUNDARY_COLOR = "#000000"      # 图片边缘粗黑线

# 格内色号
CODE_MIN_CELL = 8                    # 格尺寸小于该值时不在格内显示色号
CODE_FONT_RATIO = 0.4                # 格内色号字号（格）
FONT_MIN = 8
FONT_CANDIDATES = (
    "msyh.ttc",
    "msyhbd.ttc",
    "simhei.ttf",
    "simsun.ttc",
    "notosanscjksc.ttf",
    "arial.ttf",
    "segoeui.ttf",
)

# 边缘行列号
EDGE_NUMBER_BG = "#D6E6F7"           # 行列号格底色（浅蓝）
EDGE_NUMBER_FONT_RATIO = 0.5         # 行列号字号（格）
EDGE_NUMBER_MIN_CELL = 8             # 格尺寸小于该值时隐藏行列号

# 空位斜线
EMPTY_LINE_DIVISOR = 16              # 斜线线宽 = 格尺寸 // 该值


def _legend_rows(count: int, grid_w: int, cell: int) -> int:
    if not count:
        return 0
    pad = cell * LEGEND_PAD_RATIO
    per_row = max(1, int((grid_w - 2 * pad) // (cell * LEGEND_ENTRY_W)))
    return max(1, math.ceil(count / per_row))


def _legend_metrics(cell: int) -> tuple[int, int, int]:
    """图例单行的字号 / 色块 / 行高（像素），渲染与 PDF 适配共用同一套计算。"""
    font_size = max(LEGEND_FONT_MIN, int(cell * LEGEND_FONT_RATIO))
    sw = max(LEGEND_SWATCH_MIN, int(cell * LEGEND_SWATCH_RATIO))
    row_h = max(sw + LEGEND_ROW_EXTRA_H, font_size + LEGEND_ROW_FONT_EXTRA)
    return font_size, sw, row_h


def legend_height(
    count: int, grid_w: int, cell: int, extra_row: bool = False
) -> int:
    """图例总高（像素）：行数 × 行高 + 底部留白，供渲染与 PDF 适配共用。"""
    rows = _legend_rows(count, grid_w, cell)
    if not rows:
        return 0
    if extra_row:
        rows += 1
    _font_size, _sw, row_h = _legend_metrics(cell)
    return rows * row_h + int(cell * LEGEND_BOTTOM_GAP_RATIO)


def attribution_height(cell: int) -> int:
    """底部署名行高（像素）：顶部间距 + 字号 + 底部间距，渲染与 PDF 适配共用。"""
    font_size = max(ATTRIBUTION_FONT_MIN, int(cell * ATTRIBUTION_FONT_RATIO))
    top = int(cell * ATTRIBUTION_TOP_GAP_RATIO)
    bottom = int(cell * ATTRIBUTION_BOTTOM_GAP_RATIO)
    return top + font_size + bottom


def _legend_text_top(sw: int, font: ImageFont.FreeTypeFont, text: str) -> int:
    """图例文字垂直居中：文本包围盒中心与色块中心对齐，返回 PIL 顶边 y。"""
    _left, top, _right, bottom = font.getbbox(text)
    return int((sw - (bottom - top)) // 2 - top)


def _legend_total_needs_extra_row(
    legend: list[dict], grid_w: int, cell: int, font: ImageFont.FreeTypeFont
) -> bool:
    """总豆量文本放不下图例最后一行时，需要额外一行。"""
    if not legend:
        return False
    pad = int(cell * LEGEND_PAD_RATIO)
    entry_w = cell * LEGEND_ENTRY_W
    max_x = grid_w - pad
    x = pad
    for _ in legend:
        if x + entry_w > max_x and x > pad:
            x = pad
        x += entry_w
    total_text = f"总豆量：{sum(e.get('count', 0) for e in legend)}"
    _left, _top, right, _bottom = font.getbbox(total_text)
    return x + (right - _left) > max_x


def build_palette_map(palette: list[dict]) -> dict[int, str]:
    """把导出调色板列表收敛为 index -> hex 映射（JPG/PNG 与 PDF 共用）。"""
    return {int(c["index"]): str(c["hex"]) for c in palette}


def _font(cell: int, scale: float) -> ImageFont.FreeTypeFont:
    size = max(FONT_MIN, int(cell * scale))
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return cast(ImageFont.FreeTypeFont, ImageFont.load_default())


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


def _dashed_line(
    draw: ImageDraw.ImageDraw,
    p0: tuple[int, int],
    p1: tuple[int, int],
    fill: str,
    width: int,
    dash: int,
) -> None:
    """绘制水平 / 垂直虚线（PIL 无原生虚线，用分段实现）。"""
    x0, y0 = p0
    x1, y1 = p1
    if y0 == y1:
        x = x0
        while x < x1:
            draw.line([(x, y0), (min(x + dash, x1), y0)], fill=fill, width=width)
            x += dash * 2
    else:
        y = y0
        while y < y1:
            draw.line([(x0, y), (x0, min(y + dash, y1))], fill=fill, width=width)
            y += dash * 2


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
    show_attribution: bool = True,
    edge_numbers: bool = False,
    col_offset: int = 0,
    row_offset: int = 0,
) -> Image.Image:
    legend = sorted(legend or [], key=lambda e: (-e.get("count", 0), e.get("code", "")))
    edge = cell if edge_numbers else 0
    ox = outer_pad + edge
    oy = outer_pad + edge
    grid_w = width * cell
    grid_h = height * cell
    legend_font_size, legend_sw, legend_row_h = _legend_metrics(cell)
    legend_font = _font(cell, LEGEND_FONT_RATIO) if (show_legend and legend) else None
    extra_legend_row = bool(
        legend_font and _legend_total_needs_extra_row(legend, grid_w, cell, legend_font)
    )
    legend_h = (
        legend_height(len(legend), grid_w, cell, extra_row=extra_legend_row)
        if show_legend
        else 0
    )
    attr_h = attribution_height(cell) if show_attribution else 0
    total_w = grid_w + 2 * edge + 2 * outer_pad
    total_h = grid_h + 2 * edge + 2 * outer_pad + attr_h + legend_h

    img = Image.new("RGB", (total_w, total_h), "white")
    draw = ImageDraw.Draw(img)

    # 单元格：numpy 批量填充底色（替代 8 万次逐格 draw.rectangle），空位另行处理
    palette_rgb = {}
    for idx, hexv in palette_map.items():
        try:
            rgb = tuple(int(hexv.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        except (ValueError, IndexError):
            continue
        palette_rgb[idx] = rgb
    max_idx = max(palette_rgb, default=-1)
    rgb_lut = np.full((max_idx + 2, 3), 255, dtype=np.uint8)
    for idx, rgb in palette_rgb.items():
        rgb_lut[idx] = rgb
    grid_arr = np.asarray(grid, dtype=np.int64).reshape(height, width)
    # 负数（空位）映射到末尾的白色兜底行；超大/未知索引同样回退白色
    cell_index = np.where(grid_arr < 0, max_idx + 1, np.minimum(grid_arr, max_idx + 1))
    cell_colors = rgb_lut[cell_index]
    cell_img = Image.fromarray(cell_colors, "RGB").resize(
        (width * cell, height * cell), Image.Resampling.NEAREST
    )
    img.paste(cell_img, (ox, oy))
    if hatch:
        for py in range(height):
            for px in range(width):
                if grid_arr[py, px] < 0:
                    _draw_empty(draw, ox + px * cell, oy + py * cell, cell, empty_style)

    # 边缘行列号条（浅蓝底，不含四角）
    if edge_numbers:
        for rect in (
            (ox, oy - cell, width * cell, cell),
            (ox, oy + grid_h, width * cell, cell),
            (ox - cell, oy, cell, height * cell),
            (ox + grid_w, oy, cell, height * cell),
        ):
            draw.rectangle([rect[0], rect[1], rect[0] + rect[2] - 1, rect[1] + rect[3] - 1], fill=EDGE_NUMBER_BG)

    # 网格线：图案边缘粗黑实线；格内细灰线；每 5 格粗灰虚线；每 10 格粗灰实线。
    # 行列号条内：通常细灰线、每 5 格粗灰实线（不用虚线）；外圈不画线
    if grid_lines:
        thin = max(1, round(cell * GRID_LINE_THIN_RATIO))
        thick = max(2, round(cell * GRID_LINE_THICK_RATIO))
        dash = max(3, round(cell * GRID_DASH_RATIO))
        ec = cell if edge_numbers else 0
        x0 = ox - ec
        y0 = oy - ec
        span_w = grid_w + 2 * ec
        span_h = grid_h + 2 * ec
        ecells = 1 if edge_numbers else 0

        def pattern_style(kp, total):
            if kp in (0, total):
                return thick, GRID_BOUNDARY_COLOR, False
            if kp % 10 == 0:
                return thick, GRID_LINE_COLOR, False
            if kp % 5 == 0:
                return thick, GRID_LINE_COLOR, True
            return thin, GRID_LINE_COLOR, False

        def edge_style(kp, total):
            if kp in (0, total):
                return thick, GRID_BOUNDARY_COLOR, False
            if kp % 5 == 0:
                return thick, GRID_LINE_COLOR, False
            return thin, GRID_LINE_COLOR, False

        def draw_seg(x, y1, y2, style):
            lw, color, dashed = style
            if dashed:
                _dashed_line(draw, (x, y1), (x, y2), color, lw, dash)
            else:
                draw.line([(x, y1), (x, y2)], fill=color, width=lw)

        def draw_hseg(x1, x2, y, style):
            lw, color, dashed = style
            if dashed:
                _dashed_line(draw, (x1, y), (x2, y), color, lw, dash)
            else:
                draw.line([(x1, y), (x2, y)], fill=color, width=lw)

        for k in range(width + 2 * ecells + 1):
            kp = k - ecells
            if edge_numbers and kp in (-1, width + 1):
                continue  # 行列号外圈不画线
            ps = pattern_style(kp, width)
            es = edge_style(kp, width)
            x = x0 + k * cell
            if not edge_numbers and k in (0, width):
                x += (ps[0] if k == 0 else -ps[0]) / 2  # 无行列号时边缘防裁剪
            if edge_numbers:
                if kp not in (0, width):
                    draw_seg(x, y0, y0 + cell, es)                  # 顶部行列号条（两端帽不画）
                draw_seg(x, y0 + cell, y0 + cell + grid_h, ps)      # 图案
                if kp not in (0, width):
                    draw_seg(x, y0 + cell + grid_h, y0 + span_h, es)  # 底部行列号条（两端帽不画）
            else:
                draw_seg(x, y0, y0 + span_h, ps)
        for k in range(height + 2 * ecells + 1):
            kp = k - ecells
            if edge_numbers and kp in (-1, height + 1):
                continue  # 行列号外圈不画线
            ps = pattern_style(kp, height)
            es = edge_style(kp, height)
            y = y0 + k * cell
            if not edge_numbers and k in (0, height):
                y += (ps[0] if k == 0 else -ps[0]) / 2  # 无行列号时边缘防裁剪
            if edge_numbers:
                if kp not in (0, height):
                    draw_hseg(x0, x0 + cell, y, es)                  # 左侧行列号条（两端帽不画）
                draw_hseg(x0 + cell, x0 + cell + grid_w, y, ps)      # 图案
                if kp not in (0, height):
                    draw_hseg(x0 + cell + grid_w, x0 + span_w, y, es)  # 右侧行列号条（两端帽不画）
            else:
                draw_hseg(x0, x0 + span_w, y, ps)

    # 行列号数字（上/下列号、左/右行号）
    if edge_numbers and cell >= EDGE_NUMBER_MIN_CELL:
        font = _font(cell, EDGE_NUMBER_FONT_RATIO)
        for x in range(width):
            cx = ox + x * cell + cell / 2
            draw.text((cx, oy - cell / 2), str(x + 1 + col_offset), fill="#000000", font=font, anchor="mm")
            draw.text((cx, oy + grid_h + cell / 2), str(x + 1 + col_offset), fill="#000000", font=font, anchor="mm")
        for y in range(height):
            cy = oy + y * cell + cell / 2
            draw.text((ox - cell / 2, cy), str(y + 1 + row_offset), fill="#000000", font=font, anchor="mm")
            draw.text((ox + grid_w + cell / 2, cy), str(y + 1 + row_offset), fill="#000000", font=font, anchor="mm")

    # 格子内色号
    if show_codes and codes and cell >= CODE_MIN_CELL:
        font = _font(cell, CODE_FONT_RATIO)
        contrast_by_idx = {
            idx: _contrast_text(rgb) for idx, rgb in palette_rgb.items()
        }
        for y in range(height):
            for x in range(width):
                idx = grid[y * width + x]
                if idx < 0:
                    continue
                code = codes[y * width + x]
                if not code:
                    continue
                x0 = ox + x * cell + cell / 2
                y0 = oy + y * cell + cell / 2
                text = contrast_by_idx.get(idx, "#111111")
                tw, th = draw.textbbox((0, 0), code, font=font)[2:]
                draw.text((x0 - tw / 2, y0 - th / 2), code, fill=text, font=font)

    # 底部署名：图案与图例之间、右侧对齐（右缘与图例一致）
    if show_attribution:
        attr_font = _font(cell, ATTRIBUTION_FONT_RATIO)
        max_x = outer_pad + grid_w - int(cell * LEGEND_PAD_RATIO)
        draw.text(
            (max_x, oy + grid_h + edge + attr_h // 2),
            ATTRIBUTION_TEXT,
            fill=ATTRIBUTION_TEXT_COLOR,
            font=attr_font,
            anchor="rm",
        )

    # 色号图例（按豆数量从多到少排序，约 2 倍字号）
    if legend and show_legend:
        font = legend_font
        assert font is not None
        pad = int(cell * LEGEND_PAD_RATIO)
        entry_w = cell * LEGEND_ENTRY_W
        sw = legend_sw
        row_h = legend_row_h
        # 图例横向与外部白边对齐（与前端预览一致，不受行列号条影响）
        max_x = outer_pad + grid_w - pad
        x = outer_pad + pad
        y = oy + grid_h + edge + attr_h + int(cell * LEGEND_TOP_OFFSET_RATIO)
        for e in legend:
            if x + entry_w > max_x and x > outer_pad + pad:
                x = outer_pad + pad
                y += row_h
            draw.rectangle(
                [x, y, x + sw - 1, y + sw - 1],
                fill=e.get("hex", "#FFFFFF"),
                outline=LEGEND_SWATCH_BORDER,
            )
            text = f"{e.get('code', '')} × {e.get('count', 0)}"
            draw.text(
                (x + sw + LEGEND_TEXT_GAP, y + _legend_text_top(sw, font, text)),
                text,
                fill=LEGEND_TEXT_COLOR,
                font=font,
            )
            x += entry_w

        # 总豆量：优先写在最后一行的最右侧，放不下则新起一行
        total_text = f"总豆量：{sum(e.get('count', 0) for e in legend)}"
        _left, _top, right, _bottom = font.getbbox(total_text)
        total_w = right - _left
        row_y = y if x + total_w <= max_x else y + row_h
        draw.text(
            (max_x - total_w, row_y + _legend_text_top(sw, font, total_text)),
            total_text,
            fill=LEGEND_TEXT_COLOR,
            font=font,
        )

    return img
