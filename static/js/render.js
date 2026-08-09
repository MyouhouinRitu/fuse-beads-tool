import {
  CELL,
  GRID_MARGIN_CELLS,
  OUTER_PAD,
  LUMINANCE_THRESHOLD,
  HIGHLIGHT_STROKE_RATIO,
  HIGHLIGHT_MIN_SCREEN_STROKE,
  HIGHLIGHT_WASH_DARK,
  HIGHLIGHT_WASH_LIGHT,
  HIGHLIGHT_FRAME_DARK,
  HIGHLIGHT_FRAME_LIGHT,
  SELECTION_COLOR,
  SELECTION_STROKE_MIN,
  SELECTION_STROKE_RATIO,
} from './constants.js';
import { isLightColor } from './colors.js';

// 图例每项预估宽度（以格为单位），用于分行的保守估算
const LEGEND_ENTRY_W = 7.0;
const LEGEND_PAD_RATIO = 0.9;        // 图例左右留白（格）
const LEGEND_ROW_HEIGHT_CELLS = 2.0; // 图例每行高度（格）
const LEGEND_ROW_GAP = 8;            // 图例行间距（像素）
const LEGEND_BOTTOM_GAP_RATIO = 1.2; // 图例下方留白（格）
const GRID_LINE_THIN_RATIO = 0.04;   // 细网格线宽（格）
const GRID_LINE_THICK_RATIO = 0.10;  // 每 5 格加粗线宽（格）
const LEGEND_FONT_MIN = 12;
const LEGEND_FONT_RATIO = 0.9;       // 图例字体大小（格）
const LEGEND_SWATCH_MIN = 8;
const LEGEND_SWATCH_RATIO = 1.1;     // 图例色块大小（格）
const LEGEND_TOP_OFFSET_RATIO = 0.6; // 图例起始纵偏移（格）
const LEGEND_ROW_EXTRA_H = 10;       // 图例行高在色块外追加的高度
const LEGEND_ROW_FONT_EXTRA = 20;    // 图例行高在字体外追加的高度
const LEGEND_TEXT_GAP = 8;           // 色块与文字间距
const LEGEND_TEXT_DESCENT = 3;       // 文字基线偏移
const LEGEND_SWATCH_BORDER = '#999999';
const LEGEND_TEXT_COLOR = '#333333';
const CODE_MIN_CELL = 8;             // 格尺寸小于该值时不在格内显示色号
const CODE_FONT_MIN = 8;
const CODE_FONT_RATIO = 0.5;         // 格内色号字号（格）
const CODE_FALLBACK_RGB = [17, 17, 17]; // 空色时的文字对比底色

function legendRows(count, gridW, cell) {
  if (!count) return 0;
  const pad = cell * LEGEND_PAD_RATIO;
  const perRow = Math.max(1, Math.floor((gridW - 2 * pad) / (cell * LEGEND_ENTRY_W)));
  return Math.max(1, Math.ceil(count / perRow));
}

export function canvasMetrics(width, height, cell = CELL, legendCount = 0, outerPad = OUTER_PAD) {
  const gridW = (width + 2 * GRID_MARGIN_CELLS) * cell;
  const gridH = (height + 2 * GRID_MARGIN_CELLS) * cell;
  const rows = legendRows(legendCount, gridW, cell);
  const legendH = rows
    ? rows * (cell * LEGEND_ROW_HEIGHT_CELLS + LEGEND_ROW_GAP) + cell * LEGEND_BOTTOM_GAP_RATIO
    : 0;
  return {
    w: gridW + 2 * outerPad,
    h: gridH + 2 * outerPad + legendH,
    gridW,
    gridH,
    originX: outerPad,
    originY: outerPad,
    legendRows: rows,
  };
}

function hex6(c) {
  return ((c >>> 16) & 255).toString(16).padStart(2, '0')
    + ((c >>> 8) & 255).toString(16).padStart(2, '0')
    + (c & 255).toString(16).padStart(2, '0');
}

function textColor(r, g, b) {
  return isLightColor([r, g, b]) ? '#111111' : '#FFFFFF';
}

// 透明格（外侧边距与橡皮擦除的空位使用同一底色与斜线）
const EMPTY_STYLES = {
  default: { bg: '#ECECEC', line: '#C8C8C8' },
  black: { bg: '#000000', line: '#C8C8C8' },
  white: { bg: '#FFFFFF', line: '#C8C8C8' },
};

function drawEmptyCell(ctx, x0, y0, cell, emptyStyle) {
  const s = EMPTY_STYLES[emptyStyle] || EMPTY_STYLES.default;
  ctx.fillStyle = s.bg;
  ctx.fillRect(x0, y0, cell, cell);
  ctx.strokeStyle = s.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 + 0.5);
  ctx.lineTo(x0 + cell - 1, y0 + cell - 1);
  ctx.moveTo(x0 + cell - 1, y0 + 0.5);
  ctx.lineTo(x0 + 0.5, y0 + cell - 1);
  ctx.stroke();
}

function drawGridLines(ctx, originX, originY, gridW, gridH, cell) {
  const thin = Math.max(1, Math.round(cell * GRID_LINE_THIN_RATIO));
  const thick = Math.max(2, Math.round(cell * GRID_LINE_THICK_RATIO));
  const cols = Math.round(gridW / cell);
  const rows = Math.round(gridH / cell);
  for (let k = 0; k <= cols; k++) {
    const lw = k % 5 === 0 ? thick : thin;
    const x = originX + k * cell;
    ctx.beginPath();
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + gridH);
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  for (let k = 0; k <= rows; k++) {
    const lw = k % 5 === 0 ? thick : thin;
    const y = originY + k * cell;
    ctx.beginPath();
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + gridW, y);
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function drawCodes(ctx, width, height, displayIdx, displayRgb, codes, originX, originY, cell) {
  if (cell < CODE_MIN_CELL) return;
  const font = Math.max(CODE_FONT_MIN, Math.round(cell * CODE_FONT_RATIO));
  ctx.font = `${font}px Consolas, "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (displayIdx[p] < 0) continue;
      const code = codes[p];
      if (!code) continue;
      const x0 = originX + (x + GRID_MARGIN_CELLS) * cell + cell / 2;
      const y0 = originY + (y + GRID_MARGIN_CELLS) * cell + cell / 2;
      const v = displayRgb[p];
      const c = v ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : CODE_FALLBACK_RGB;
      ctx.fillStyle = textColor(c[0], c[1], c[2]);
      ctx.fillText(code, x0, y0);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawLegend(ctx, legend, cell, gridW, baseY, outerPad = OUTER_PAD) {
  if (!legend || !legend.length) return;
  const pad = cell * LEGEND_PAD_RATIO;
  const font = Math.max(LEGEND_FONT_MIN, Math.round(cell * LEGEND_FONT_RATIO));
  const sw = Math.max(LEGEND_SWATCH_MIN, Math.round(cell * LEGEND_SWATCH_RATIO));
  const entryW = cell * LEGEND_ENTRY_W;
  const perRow = Math.max(1, Math.floor((gridW - 2 * pad) / entryW));
  const rowH = Math.max(sw + LEGEND_ROW_EXTRA_H, font + LEGEND_ROW_FONT_EXTRA);
  const maxX = outerPad + gridW - pad;
  ctx.font = `${font}px Consolas, "Microsoft YaHei", monospace`;
  let x = outerPad + pad;
  let y = baseY + cell * LEGEND_TOP_OFFSET_RATIO;
  for (const e of legend) {
    if (x + entryW > maxX && x > outerPad + pad) {
      x = outerPad + pad;
      y += rowH;
    }
    ctx.fillStyle = e.hex;
    ctx.fillRect(x, y, sw, sw);
    ctx.strokeStyle = LEGEND_SWATCH_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, sw - 1);
    ctx.fillStyle = LEGEND_TEXT_COLOR;
    ctx.fillText(`${e.code}×${e.count}`, x + sw + LEGEND_TEXT_GAP, y + sw - LEGEND_TEXT_DESCENT);
    x += entryW;
  }
}

function drawSelection(ctx, sel, originX, originY, cell) {
  if (!sel) return;
  const x0 = originX + (sel.x + GRID_MARGIN_CELLS) * cell;
  const y0 = originY + (sel.y + GRID_MARGIN_CELLS) * cell;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = Math.max(SELECTION_STROKE_MIN, Math.round(cell * SELECTION_STROKE_RATIO));
  const inset = ctx.lineWidth / 2;
  ctx.strokeRect(x0 + inset, y0 + inset, cell - inset * 2, cell - inset * 2);
}

export function drawPattern(ctx, width, height, displayIdx, displayRgb, opts) {
  const cell = opts.cell || CELL;
  const outerPad = opts.outerPad ?? OUTER_PAD;
  const gridLines = opts.gridLines !== false;
  const hatch = opts.hatch !== false;
  const emptyStyle = opts.emptyStyle || 'default';
  const legend = opts.legend || [];
  const metrics = canvasMetrics(width, height, cell, legend.length, outerPad);
  ctx.canvas.width = metrics.w;
  ctx.canvas.height = metrics.h;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, metrics.w, metrics.h);

  const ox = metrics.originX;
  const oy = metrics.originY;

  // 单元格：外圈 5 格为透明边距，内部为图案
  const totalCols = width + 2 * GRID_MARGIN_CELLS;
  const totalRows = height + 2 * GRID_MARGIN_CELLS;
  for (let gy = 0; gy < totalRows; gy++) {
    const y0 = oy + gy * cell;
    for (let gx = 0; gx < totalCols; gx++) {
      const x0 = ox + gx * cell;
      const px = gx - GRID_MARGIN_CELLS;
      const py = gy - GRID_MARGIN_CELLS;
      if (px >= 0 && py >= 0 && px < width && py < height) {
        const p = py * width + px;
        const v = displayIdx[p];
        if (v >= 0) {
          ctx.fillStyle = '#' + hex6(displayRgb[p]);
          ctx.fillRect(x0, y0, cell, cell);
        } else if (hatch) {
          drawEmptyCell(ctx, x0, y0, cell, emptyStyle);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x0, y0, cell, cell);
        }
      } else {
        // 外侧透明格与橡皮清空后的空位底色一致
        drawEmptyCell(ctx, x0, y0, cell, emptyStyle);
      }
    }
  }

  if (gridLines) {
    ctx.strokeStyle = '#9A9A9A';
    drawGridLines(ctx, ox, oy, metrics.gridW, metrics.gridH, cell);
  }

  if (opts.showCodes && opts.codes) {
    drawCodes(ctx, width, height, displayIdx, displayRgb, opts.codes, ox, oy, cell);
  }

  drawSelection(ctx, opts.selected, ox, oy, cell);

  // 颜色清单高亮：半透明覆盖层 + 亮度自适应描边（描边带屏幕像素下限）
  if (opts.highlightColor != null && opts.highlightBlink !== false) {
    const zoom = opts.zoom || 1;
    // 屏幕线宽 = 画布线宽 × zoom；取「按格子的常规宽度」与「屏幕像素下限」的较大者，
    // 并限制不超过半格，避免格子太小时描边几何失效
    const hlw = Math.max(
      Math.round(cell * HIGHLIGHT_STROKE_RATIO),
      Math.min(
        Math.ceil(HIGHLIGHT_MIN_SCREEN_STROKE / zoom),
        Math.max(1, Math.floor(cell / 2))
      )
    );
    const inset = hlw / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const v = displayIdx[p];
        if (v < 0 || v !== opts.highlightColor) continue;
        const c = displayRgb[p];
        const r = (c >>> 16) & 255;
        const g = (c >>> 8) & 255;
        const b = c & 255;
        const light = isLightColor([r, g, b]);
        const x0 = ox + (x + GRID_MARGIN_CELLS) * cell;
        const y0 = oy + (y + GRID_MARGIN_CELLS) * cell;
        // 半透明覆盖层：暗色格子提亮、亮色格子压暗，任何颜色（含灰色）都有反差
        ctx.fillStyle = light
          ? `rgba(0, 0, 0, ${HIGHLIGHT_WASH_LIGHT})`
          : `rgba(255, 255, 255, ${HIGHLIGHT_WASH_DARK})`;
        ctx.fillRect(x0, y0, cell, cell);
        // 亮度自适应描边：亮格子用深框、暗格子用浅框
        ctx.strokeStyle = light
          ? `rgba(0, 0, 0, ${HIGHLIGHT_FRAME_LIGHT})`
          : `rgba(255, 255, 255, ${HIGHLIGHT_FRAME_DARK})`;
        ctx.lineWidth = hlw;
        ctx.strokeRect(x0 + inset, y0 + inset, cell - inset * 2, cell - inset * 2);
      }
    }
  }

  if (legend.length && opts.showLegend !== false) {
    drawLegend(ctx, legend, cell, metrics.gridW, oy + metrics.gridH, outerPad);
  }
}

export function clearCanvas(ctx) {
  ctx.canvas.width = 0;
  ctx.canvas.height = 0;
}
