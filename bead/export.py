"""Render the bead grid as a raster image (JPG/PNG)."""

import math

from PIL import Image, ImageDraw, ImageFont

MARGIN_CELLS = 5
LEGEND_ENTRY_W = 7.0


def _legend_rows(count, grid_w, cell):
    if not count:
        return 0
    pad = cell * 0.9
    per_row = max(1, int((grid_w - 2 * pad) // (cell * LEGEND_ENTRY_W)))
    return max(1, math.ceil(count / per_row))


def _font(cell, scale):
    size = max(8, int(cell * scale))
    for name in ("arial.ttf", "segoeui.ttf", "msyh.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _contrast_text(rgb):
    r, g, b = rgb
    return "#111111" if (r * 299 + g * 587 + b * 114) / 1000 >= 150 else "#FFFFFF"


def _draw_empty(draw, x0, y0, cell):
    draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill="#ECECEC")
    lw = max(1, cell // 16)
    draw.line([(x0, y0), (x0 + cell - 1, y0 + cell - 1)], fill="#C8C8C8", width=lw)
    draw.line([(x0 + cell - 1, y0), (x0, y0 + cell - 1)], fill="#C8C8C8", width=lw)


def render_pattern(
    width,
    height,
    grid,
    palette_map,
    cell=20,
    grid_lines=True,
    outer_pad=0,
    outline=False,
    outline_width=None,
    hatch=True,
    legend=None,
    codes=None,
    show_codes=True,
):
    legend = sorted(legend or [], key=lambda e: (-e.get("count", 0), e.get("code", "")))
    grid_w = (width + 2 * MARGIN_CELLS) * cell
    grid_h = (height + 2 * MARGIN_CELLS) * cell
    rows = _legend_rows(len(legend), grid_w, cell)
    legend_h = rows * int(cell * 2.0 + 8) + int(cell * 1.2) if rows else 0
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
                    _draw_empty(draw, x0, y0, cell)
                else:
                    draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill="#FFFFFF")
            else:
                _draw_empty(draw, x0, y0, cell)

    # 网格线（含边距区，每 5 格加粗）
    if grid_lines:
        thin = max(1, round(cell * 0.04))
        thick = max(2, round(cell * 0.10))
        for k in range(width + 2 * MARGIN_CELLS + 1):
            lw = thick if k % 5 == 0 else thin
            x = outer_pad + k * cell
            draw.line([(x, outer_pad), (x, outer_pad + grid_h)], fill="#9A9A9A", width=lw)
        for k in range(height + 2 * MARGIN_CELLS + 1):
            lw = thick if k % 5 == 0 else thin
            y = outer_pad + k * cell
            draw.line([(outer_pad, y), (outer_pad + grid_w, y)], fill="#9A9A9A", width=lw)

    # 描边：仅围绕图案区内的实色格子
    if outline:
        ow = outline_width or max(2, round(cell * 0.15))
        ox = outer_pad + MARGIN_CELLS * cell
        oy = outer_pad + MARGIN_CELLS * cell
        for y in range(height):
            for x in range(width):
                idx = grid[y * width + x]
                if idx < 0:
                    continue
                x0, y0 = ox + x * cell, oy + y * cell
                left = x == 0 or grid[y * width + x - 1] < 0
                right = x == width - 1 or grid[y * width + x + 1] < 0
                top = y == 0 or grid[(y - 1) * width + x] < 0
                bottom = y == height - 1 or grid[(y + 1) * width + x] < 0
                if left:
                    draw.rectangle([x0, y0, x0 + ow - 1, y0 + cell - 1], fill="#111111")
                if right:
                    draw.rectangle([x0 + cell - ow, y0, x0 + cell - 1, y0 + cell - 1], fill="#111111")
                if top:
                    draw.rectangle([x0, y0, x0 + cell - 1, y0 + ow - 1], fill="#111111")
                if bottom:
                    draw.rectangle([x0, y0 + cell - ow, x0 + cell - 1, y0 + cell - 1], fill="#111111")

    # 格子内色号
    if show_codes and codes and cell >= 8:
        font = _font(cell, 0.5)
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
    if legend:
        font = _font(cell, 0.9)
        pad = int(cell * 0.9)
        entry_w = cell * LEGEND_ENTRY_W
        per_row = max(1, int((grid_w - 2 * pad) // entry_w))
        sw = max(8, int(cell * 1.1))
        row_h = max(sw + 10, font.size + 20)
        max_x = outer_pad + grid_w - pad
        x = outer_pad + pad
        y = outer_pad + grid_h + int(cell * 0.6)
        for e in legend:
            if x + entry_w > max_x and x > outer_pad + pad:
                x = outer_pad + pad
                y += row_h
            draw.rectangle([x, y, x + sw - 1, y + sw - 1], fill=e.get("hex", "#FFFFFF"), outline="#999999")
            draw.text((x + sw + 8, y + (sw - font.size) // 2 + 2), f"{e.get('code', '')}x{e.get('count', 0)}", fill="#333333", font=font)
            x += entry_w

    return img
