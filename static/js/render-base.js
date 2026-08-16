import { hex6, isLightColor, rgbFromPacked } from './colors.js';
import {
  CELL,
  CODE_FONT_MIN,
  CODE_FONT_RATIO,
  EDGE_NUMBER_BG,
  EDGE_NUMBER_FONT_RATIO,
  EDGE_NUMBER_MIN_CELL,
  EMPTY_STYLES,
  GRID_BOUNDARY_COLOR,
  GRID_DASH_RATIO,
  GRID_FINE_MIN_SCREEN_CELL,
  GRID_LINE_COLOR,
  GRID_LINE_THICK_RATIO,
  GRID_LINE_THIN_RATIO,
  GRID_THICK_MIN_SCREEN_CELL,
  LEGEND_BOTTOM_GAP_RATIO,
  LEGEND_ENTRY_W,
  LEGEND_FONT_MIN,
  LEGEND_FONT_RATIO,
  LEGEND_PAD_RATIO,
  LEGEND_ROW_EXTRA_H,
  LEGEND_ROW_FONT_EXTRA,
  LEGEND_SWATCH_BORDER,
  LEGEND_SWATCH_MIN,
  LEGEND_SWATCH_RATIO,
  LEGEND_TEXT_COLOR,
  LEGEND_TEXT_DESCENT,
  LEGEND_TEXT_GAP,
  LEGEND_TOP_OFFSET_RATIO,
  OUTER_PAD,
} from './constants.js';

const CODE_FALLBACK_RGB = [17, 17, 17]; // 空色时的文字对比底色

function legendRows(count, gridW, cell) {
  if (!count) return 0;
  const pad = cell * LEGEND_PAD_RATIO;
  const perRow = Math.max(1, Math.floor((gridW - 2 * pad) / (cell * LEGEND_ENTRY_W)));
  return Math.max(1, Math.ceil(count / perRow));
}

export function canvasMetrics(
  width,
  height,
  cell = CELL,
  legendCount = 0,
  outerPad = OUTER_PAD,
  edge = 0,
) {
  // edge：四周行列号条的像素宽度（工作区为 1 格，导出为 0）
  const gridW = width * cell;
  const gridH = height * cell;
  const rows = legendRows(legendCount, gridW, cell);
  const font = Math.max(LEGEND_FONT_MIN, Math.round(cell * LEGEND_FONT_RATIO));
  const sw = Math.max(LEGEND_SWATCH_MIN, Math.round(cell * LEGEND_SWATCH_RATIO));
  const rowH = Math.max(sw + LEGEND_ROW_EXTRA_H, font + LEGEND_ROW_FONT_EXTRA);
  const legendH = rows ? rows * rowH + cell * LEGEND_BOTTOM_GAP_RATIO : 0;
  return {
    w: gridW + 2 * edge + 2 * outerPad,
    h: gridH + 2 * edge + 2 * outerPad + legendH,
    gridW,
    gridH,
    originX: outerPad + edge,
    originY: outerPad + edge,
    edge,
    legendRows: rows,
  };
}

// 自适应描边线宽：按格子的常用宽度与屏幕像素下限取较大者，
// 并限制不超过半格，避免格子太小时描边几何失效
export function adaptiveStrokeWidth(cell, zoom, ratio, minScreenStroke) {
  return Math.max(
    Math.round(cell * ratio),
    Math.min(Math.ceil(minScreenStroke / zoom), Math.max(1, Math.floor(cell / 2))),
  );
}

function textColor(r, g, b) {
  return isLightColor([r, g, b]) ? '#111111' : '#FFFFFF';
}

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

// 网格线规范：
// - 图案边缘粗黑实线；格内细灰线；每 5 格粗灰虚线；每 10 格粗灰实线
// - 行列号条内：通常细灰线、每 5 格粗灰实线（不用虚线）；外圈不画线
export function drawGridLines(
  ctx,
  originX,
  originY,
  width,
  height,
  cell,
  edgeCells = 0,
  zoom = 1,
  viewport = null,
) {
  const screenCell = cell * (zoom || 1);
  const thin = Math.max(1, Math.round(cell * GRID_LINE_THIN_RATIO));
  const thick = Math.max(2, Math.round(cell * GRID_LINE_THICK_RATIO));
  const dash = Math.max(3, Math.round(cell * GRID_DASH_RATIO));
  const x0 = originX - edgeCells * cell;
  const y0 = originY - edgeCells * cell;
  const spanW = (width + 2 * edgeCells) * cell;
  const spanH = (height + 2 * edgeCells) * cell;
  const patternStyle = (kp, total) => {
    if (kp === 0 || kp === total) return { lw: thick, color: GRID_BOUNDARY_COLOR, dashed: false };
    if (screenCell < GRID_THICK_MIN_SCREEN_CELL) return null;
    if (kp % 10 === 0) return { lw: thick, color: GRID_LINE_COLOR, dashed: false };
    if (kp % 5 === 0) return { lw: thick, color: GRID_LINE_COLOR, dashed: true };
    if (screenCell < GRID_FINE_MIN_SCREEN_CELL) return null;
    return { lw: thin, color: GRID_LINE_COLOR, dashed: false };
  };
  const edgeStyle = (kp, total) => {
    if (kp === 0 || kp === total) return { lw: thick, color: GRID_BOUNDARY_COLOR, dashed: false };
    if (screenCell < GRID_THICK_MIN_SCREEN_CELL) return null;
    if (kp % 5 === 0) return { lw: thick, color: GRID_LINE_COLOR, dashed: false };
    if (screenCell < GRID_FINE_MIN_SCREEN_CELL) return null;
    return { lw: thin, color: GRID_LINE_COLOR, dashed: false };
  };
  // 相同样式的实线合并成一条路径批量绘制；虚线逐段绘制，保证每段虚线段相位一致
  const strokeSeg = (map, x1, y1, x2, y2, s) => {
    if (s.dashed) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lw;
      ctx.setLineDash([dash, dash]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      return;
    }
    const key = `${s.lw}|${s.color}`;
    let g = map.get(key);
    if (!g) {
      g = { lw: s.lw, color: s.color, segs: [] };
      map.set(key, g);
    }
    g.segs.push(x1, y1, x2, y2);
  };
  const flushGroups = (map) => {
    for (const g of map.values()) {
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.lw;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < g.segs.length; i += 4) {
        ctx.moveTo(g.segs[i], g.segs[i + 1]);
        ctx.lineTo(g.segs[i + 2], g.segs[i + 3]);
      }
      ctx.stroke();
    }
  };
  const vGroups = new Map();
  const hGroups = new Map();
  // 视口渲染时只画窗口内的线（窗口外由 canvas 裁剪，收紧循环避免大图逐帧全画）
  const vkMin = viewport ? Math.max(0, viewport.x0 - 1 + edgeCells) : 0;
  const vkMax = viewport
    ? Math.min(width + 2 * edgeCells, viewport.x1 + 1 + edgeCells)
    : width + 2 * edgeCells;
  ctx.save();
  for (let k = vkMin; k <= vkMax; k++) {
    const kp = k - edgeCells;
    if (edgeCells && (kp === -1 || kp === width + 1)) continue; // 行列号外圈不画线
    const s = patternStyle(kp, width);
    const se = edgeStyle(kp, width);
    if (!s && !se) continue;
    let x = x0 + k * cell;
    if (!edgeCells && (k === 0 || k === width)) x += (k === 0 ? s.lw : -s.lw) / 2; // 无行列号时边缘防裁剪
    if (edgeCells) {
      if (kp !== 0 && kp !== width && se) strokeSeg(vGroups, x, y0, x, y0 + cell, se); // 顶部行列号条（两端帽不画）
      if (s) strokeSeg(vGroups, x, y0 + cell, x, y0 + cell + height * cell, s); // 图案
      if (kp !== 0 && kp !== width && se)
        strokeSeg(vGroups, x, y0 + cell + height * cell, x, y0 + spanH, se); // 底部行列号条（两端帽不画）
    } else if (s) {
      strokeSeg(vGroups, x, y0, x, y0 + spanH, s);
    }
  }
  flushGroups(vGroups); // 竖直实线先画，水平线后画压在上方（与旧实现逐段绘制顺序一致）
  const hkMin = viewport ? Math.max(0, viewport.y0 - 1 + edgeCells) : 0;
  const hkMax = viewport
    ? Math.min(height + 2 * edgeCells, viewport.y1 + 1 + edgeCells)
    : height + 2 * edgeCells;
  for (let k = hkMin; k <= hkMax; k++) {
    const kp = k - edgeCells;
    if (edgeCells && (kp === -1 || kp === height + 1)) continue; // 行列号外圈不画线
    const s = patternStyle(kp, height);
    const se = edgeStyle(kp, height);
    if (!s && !se) continue;
    let y = y0 + k * cell;
    if (!edgeCells && (k === 0 || k === height)) y += (k === 0 ? s.lw : -s.lw) / 2; // 无行列号时边缘防裁剪
    if (edgeCells) {
      if (kp !== 0 && kp !== height && se) strokeSeg(hGroups, x0, y, x0 + cell, y, se); // 左侧行列号条（两端帽不画）
      if (s) strokeSeg(hGroups, x0 + cell, y, x0 + cell + width * cell, y, s); // 图案
      if (kp !== 0 && kp !== height && se)
        strokeSeg(hGroups, x0 + cell + width * cell, y, x0 + spanW, y, se); // 右侧行列号条（两端帽不画）
    } else if (s) {
      strokeSeg(hGroups, x0, y, x0 + spanW, y, s);
    }
  }
  flushGroups(hGroups);
  ctx.restore();
}

// 行列号条底色：上下左右四条（不含四角）
function fillEdgeStrips(ctx, width, height, originX, originY, cell) {
  ctx.fillStyle = EDGE_NUMBER_BG;
  ctx.fillRect(originX, originY - cell, width * cell, cell);
  ctx.fillRect(originX, originY + height * cell, width * cell, cell);
  ctx.fillRect(originX - cell, originY, cell, height * cell);
  ctx.fillRect(originX + width * cell, originY, cell, height * cell);
}

// 边缘行列号数字：浅蓝底与分隔线由 fillEdgeStrips / drawGridLines 绘制，这里只写字
function drawEdgeNumbers(ctx, width, height, originX, originY, cell, viewport = null) {
  if (cell < EDGE_NUMBER_MIN_CELL) return;
  const font = Math.max(8, Math.round(cell * EDGE_NUMBER_FONT_RATIO));
  ctx.font = `${font}px Consolas, "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  const nx0 = viewport ? Math.max(0, viewport.x0) : 0;
  const nx1 = viewport ? Math.min(width - 1, viewport.x1) : width - 1;
  const ny0 = viewport ? Math.max(0, viewport.y0) : 0;
  const ny1 = viewport ? Math.min(height - 1, viewport.y1) : height - 1;
  // 上 / 下列号（左到右递增）、左 / 右行号（上到下递增），与图案格对齐
  for (let x = nx0; x <= nx1; x++) {
    const cx = originX + x * cell + cell / 2;
    ctx.fillText(String(x + 1), cx, originY - cell / 2);
    ctx.fillText(String(x + 1), cx, originY + height * cell + cell / 2);
  }
  for (let y = ny0; y <= ny1; y++) {
    const cy = originY + y * cell + cell / 2;
    ctx.fillText(String(y + 1), originX - cell / 2, cy);
    ctx.fillText(String(y + 1), originX + width * cell + cell / 2, cy);
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

export function drawCodes(
  ctx,
  width,
  height,
  displayIdx,
  displayRgb,
  codes,
  originX,
  originY,
  cell,
  zoom = 1,
  viewport = null,
  cells = null,
) {
  if (cell * (zoom || 1) < GRID_FINE_MIN_SCREEN_CELL) return;
  const font = Math.max(CODE_FONT_MIN, Math.round(cell * CODE_FONT_RATIO));
  ctx.font = `${font}px Consolas, "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const draw = (x, y) => {
    const p = y * width + x;
    if (displayIdx[p] < 0) return;
    const code = codes[p];
    if (!code) return;
    const x0 = originX + x * cell + cell / 2;
    const y0 = originY + y * cell + cell / 2;
    const v = displayRgb[p];
    const c = v ? rgbFromPacked(v) : CODE_FALLBACK_RGB;
    ctx.fillStyle = textColor(c[0], c[1], c[2]);
    ctx.fillText(code, x0, y0);
  };
  if (cells) {
    for (const p of cells) {
      const x = p % width;
      const y = (p / width) | 0;
      if (viewport && (x < viewport.x0 || x > viewport.x1 || y < viewport.y0 || y > viewport.y1)) {
        continue;
      }
      draw(x, y);
    }
  } else {
    const cx0 = viewport ? Math.max(0, viewport.x0) : 0;
    const cx1 = viewport ? Math.min(width - 1, viewport.x1) : width - 1;
    const cy0 = viewport ? Math.max(0, viewport.y0) : 0;
    const cy1 = viewport ? Math.min(height - 1, viewport.y1) : height - 1;
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        draw(x, y);
      }
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawLegend(ctx, legend, cell, gridW, baseY, outerPad = OUTER_PAD) {
  if (!legend?.length) return;
  const pad = cell * LEGEND_PAD_RATIO;
  const font = Math.max(LEGEND_FONT_MIN, Math.round(cell * LEGEND_FONT_RATIO));
  const sw = Math.max(LEGEND_SWATCH_MIN, Math.round(cell * LEGEND_SWATCH_RATIO));
  const entryW = cell * LEGEND_ENTRY_W;
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
    ctx.fillText(`${e.code} × ${e.count}`, x + sw + LEGEND_TEXT_GAP, y + sw - LEGEND_TEXT_DESCENT);
    x += entryW;
  }
}

// 四方向（上下左右）连通分组：isMember(index) 判定索引是否属于目标集合
export function findConnectedComponents(width, height, isMember) {
  const n = width * height;
  const visited = new Uint8Array(n);
  const components = [];
  for (let p = 0; p < n; p++) {
    if (visited[p] || !isMember(p)) continue;
    visited[p] = 1;
    const comp = [];
    const stack = [p];
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const x = q % width;
      if (x > 0 && !visited[q - 1] && isMember(q - 1)) {
        visited[q - 1] = 1;
        stack.push(q - 1);
      }
      if (x < width - 1 && !visited[q + 1] && isMember(q + 1)) {
        visited[q + 1] = 1;
        stack.push(q + 1);
      }
      if (q >= width && !visited[q - width] && isMember(q - width)) {
        visited[q - width] = 1;
        stack.push(q - width);
      }
      if (q < n - width && !visited[q + width] && isMember(q + width)) {
        visited[q + width] = 1;
        stack.push(q + width);
      }
    }
    components.push(comp);
  }
  return components;
}

function drawCellAt(ctx, width, displayIdx, displayRgb, ox, oy, cell, hatch, emptyStyle, p) {
  const x = p % width;
  const y = (p / width) | 0;
  const x0 = ox + x * cell;
  const y0 = oy + y * cell;
  const v = displayIdx[p];
  if (v >= 0) {
    ctx.fillStyle = `#${hex6(displayRgb[p])}`;
    ctx.fillRect(x0, y0, cell, cell);
  } else if (hatch) {
    drawEmptyCell(ctx, x0, y0, cell, emptyStyle);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y0, cell, cell);
  }
}

// 只画指定格（cells：格索引集合）或整幅图案（cells 为 null）。
// 笔划中的增量重绘与全量渲染共用同一实现，保证格子外观完全一致。
export function drawPatternCells(
  ctx,
  width,
  height,
  displayIdx,
  displayRgb,
  ox,
  oy,
  cell,
  { hatch = true, emptyStyle = 'default', viewport = null } = {},
  cells = null,
) {
  if (cells) {
    for (const p of cells) {
      const x = p % width;
      const y = (p / width) | 0;
      if (viewport && (x < viewport.x0 || x > viewport.x1 || y < viewport.y0 || y > viewport.y1)) {
        continue;
      }
      drawCellAt(ctx, width, displayIdx, displayRgb, ox, oy, cell, hatch, emptyStyle, p);
    }
    return;
  }
  const cx0 = viewport ? Math.max(0, viewport.x0) : 0;
  const cx1 = viewport ? Math.min(width - 1, viewport.x1) : width - 1;
  const cy0 = viewport ? Math.max(0, viewport.y0) : 0;
  const cy1 = viewport ? Math.min(height - 1, viewport.y1) : height - 1;
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      drawCellAt(
        ctx,
        width,
        displayIdx,
        displayRgb,
        ox,
        oy,
        cell,
        hatch,
        emptyStyle,
        y * width + x,
      );
    }
  }
}

// 底图：单元格 + 行列号条 + 网格线 + 行列号数字 + 格内色号 + 图例（不含选区 / 高亮 / hover）
export function drawPatternBase(ctx, width, height, displayIdx, displayRgb, opts) {
  const cell = opts.cell || CELL;
  const outerPad = opts.outerPad ?? OUTER_PAD;
  const gridLines = opts.gridLines !== false;
  const hatch = opts.hatch !== false;
  const emptyStyle = opts.emptyStyle || 'default';
  const legend = opts.legend || [];
  const edge = opts.edgeNumbers ? cell : 0; // 工作区带四周 1 格行列号条，导出不带
  // 视口渲染（放大镜等）：只画窗口范围；坐标为扩展坐标（图案格 0..w-1，行列号条 -1 / w），
  // 窗口原点对齐画布原点；不传则渲染整幅图案
  const viewport = opts.viewport || null;
  let vw, vh, ox, oy;
  let metrics = null;
  if (viewport) {
    vw = (viewport.x1 - viewport.x0 + 1) * cell;
    vh = (viewport.y1 - viewport.y0 + 1) * cell;
    ox = -viewport.x0 * cell;
    oy = -viewport.y0 * cell;
  } else {
    metrics = canvasMetrics(width, height, cell, legend.length, outerPad, edge);
    vw = metrics.w;
    vh = metrics.h;
    ox = metrics.originX;
    oy = metrics.originY;
  }
  ctx.canvas.width = vw;
  ctx.canvas.height = vh;
  if (opts.background) {
    // 导出预览等需要不透明底的场景：整幅铺底色（工作区不传，保持四角透明）
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, vw, vh);
  }

  // 单元格：只画图案本身（外侧无透明边距）；视口模式只画窗口内的图案格
  drawPatternCells(ctx, width, height, displayIdx, displayRgb, ox, oy, cell, {
    hatch,
    emptyStyle,
    viewport,
  });

  // 行列号条底色铺在网格线之下
  if (opts.edgeNumbers) {
    fillEdgeStrips(ctx, width, height, ox, oy, cell);
  }

  if (gridLines) {
    drawGridLines(
      ctx,
      ox,
      oy,
      width,
      height,
      cell,
      opts.edgeNumbers ? 1 : 0,
      opts.zoom || 1,
      viewport,
    );
  }

  if (opts.edgeNumbers) {
    drawEdgeNumbers(ctx, width, height, ox, oy, cell, viewport);
  }

  if (opts.showCodes && opts.codes) {
    drawCodes(
      ctx,
      width,
      height,
      displayIdx,
      displayRgb,
      opts.codes,
      ox,
      oy,
      cell,
      opts.zoom || 1,
      viewport,
    );
  }

  if (legend.length && opts.showLegend !== false && !viewport) {
    // 图例放在图案与底部行列号条之下
    drawLegend(ctx, legend, cell, metrics.gridW, oy + metrics.gridH + metrics.edge, outerPad);
  }
}
