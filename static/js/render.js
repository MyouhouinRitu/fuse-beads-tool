export const CELL = 26;
const OUTER_PAD = 20; // 图片外侧纯白边距（像素）
const MARGIN_CELLS = 5;      // 四周灰色 X 边距格数

// 图例每项预估宽度（以格为单位），用于分行的保守估算
const LEGEND_ENTRY_W = 7.0;

function legendRows(count, gridW, cell) {
  if (!count) return 0;
  const pad = cell * 0.9;
  const perRow = Math.max(1, Math.floor((gridW - 2 * pad) / (cell * LEGEND_ENTRY_W)));
  return Math.max(1, Math.ceil(count / perRow));
}

export function canvasMetrics(width, height, cell = CELL, legendCount = 0, outerPad = OUTER_PAD) {
  const gridW = (width + 2 * MARGIN_CELLS) * cell;
  const gridH = (height + 2 * MARGIN_CELLS) * cell;
  const rows = legendRows(legendCount, gridW, cell);
  const legendH = rows ? rows * (cell * 2.0 + 8) + cell * 1.2 : 0;
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
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#111111' : '#FFFFFF';
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
  const thin = Math.max(1, Math.round(cell * 0.04));
  const thick = Math.max(2, Math.round(cell * 0.10));
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
  if (cell < 8) return;
  const font = Math.max(8, Math.round(cell * 0.5));
  ctx.font = `${font}px Consolas, "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (displayIdx[p] < 0) continue;
      const code = codes[p];
      if (!code) continue;
      const x0 = originX + (x + MARGIN_CELLS) * cell + cell / 2;
      const y0 = originY + (y + MARGIN_CELLS) * cell + cell / 2;
      const v = displayRgb[p];
      const c = v ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [17, 17, 17];
      ctx.fillStyle = textColor(c[0], c[1], c[2]);
      ctx.fillText(code, x0, y0);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawLegend(ctx, legend, cell, gridW, baseY, outerPad = OUTER_PAD) {
  if (!legend || !legend.length) return;
  const pad = cell * 0.9;
  const font = Math.max(12, Math.round(cell * 0.9)); // 约 2 倍字号
  const sw = Math.max(8, Math.round(cell * 1.1));
  const gap = Math.max(5, Math.round(cell * 0.4));
  const entryW = cell * LEGEND_ENTRY_W;
  const perRow = Math.max(1, Math.floor((gridW - 2 * pad) / entryW));
  const rowH = Math.max(sw + 10, font + 20);
  const maxX = outerPad + gridW - pad;
  ctx.font = `${font}px Consolas, "Microsoft YaHei", monospace`;
  let x = outerPad + pad;
  let y = baseY + cell * 0.6;
  for (const e of legend) {
    if (x + entryW > maxX && x > outerPad + pad) {
      x = outerPad + pad;
      y += rowH;
    }
    ctx.fillStyle = e.hex;
    ctx.fillRect(x, y, sw, sw);
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, sw - 1);
    ctx.fillStyle = '#333333';
    ctx.fillText(`${e.code}×${e.count}`, x + sw + 8, y + sw - 3);
    x += entryW;
  }
}

function drawSelection(ctx, sel, originX, originY, cell) {
  if (!sel) return;
  const x0 = originX + (sel.x + MARGIN_CELLS) * cell;
  const y0 = originY + (sel.y + MARGIN_CELLS) * cell;
  ctx.strokeStyle = '#1976D2';
  ctx.lineWidth = Math.max(3, Math.round(cell * 0.15));
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
  const totalCols = width + 2 * MARGIN_CELLS;
  const totalRows = height + 2 * MARGIN_CELLS;
  for (let gy = 0; gy < totalRows; gy++) {
    const y0 = oy + gy * cell;
    for (let gx = 0; gx < totalCols; gx++) {
      const x0 = ox + gx * cell;
      const px = gx - MARGIN_CELLS;
      const py = gy - MARGIN_CELLS;
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

  // 颜色清单高亮：给指定色号的像素画反色框；闪烁时按相位隐现
  if (opts.highlightColor != null && opts.highlightBlink !== false) {
    const hlw = Math.max(2, Math.round(cell * 0.14));
    const inset = hlw / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const v = displayIdx[p];
        if (v < 0 || v !== opts.highlightColor) continue;
        const c = displayRgb[p];
        const inv = c
          ? [255 - ((c >> 16) & 255), 255 - ((c >> 8) & 255), 255 - (c & 255)]
          : [255, 255, 255];
        ctx.strokeStyle = `rgb(${inv[0]}, ${inv[1]}, ${inv[2]})`;
        ctx.lineWidth = hlw;
        const x0 = ox + (x + MARGIN_CELLS) * cell;
        const y0 = oy + (y + MARGIN_CELLS) * cell;
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
