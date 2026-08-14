import { isLightColor } from './colors.js';
import {
  CELL,
  CODE_FONT_MIN,
  CODE_FONT_RATIO,
  CROP_EDGE_ACTIVE_COLOR,
  CROP_EDGE_COLOR,
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
  HIGHLIGHT_FRAME_DARK,
  HIGHLIGHT_FRAME_LIGHT,
  HIGHLIGHT_MIN_SCREEN_STROKE,
  HIGHLIGHT_STROKE_RATIO,
  HIGHLIGHT_WASH_DARK,
  HIGHLIGHT_WASH_LIGHT,
  HOVER_BRUSH_STROKE_RATIO,
  HOVER_DASH_MIN,
  HOVER_DASH_RATIO,
  HOVER_MIN_SCREEN_CELL,
  HOVER_STROKE_RATIO,
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
  RAISED_BEVEL_DARK_ALPHA,
  RAISED_BEVEL_LIGHT_ALPHA,
  RAISED_GLOSS_ALPHA,
  RAISED_SHADOW_ALPHA,
  SELECTION_MIN_SCREEN_DASH,
  SELECTION_MIN_SCREEN_STROKE,
  TOOLS,
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

function hex6(c) {
  return (
    ((c >>> 16) & 255).toString(16).padStart(2, '0') +
    ((c >>> 8) & 255).toString(16).padStart(2, '0') +
    (c & 255).toString(16).padStart(2, '0')
  );
}

// 把打包成整数的 RGB（0xRRGGBB）拆成 [r, g, b]
function rgbFromPacked(v) {
  return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

// 自适应描边线宽：按格子的常用宽度与屏幕像素下限取较大者，
// 并限制不超过半格，避免格子太小时描边几何失效
function adaptiveStrokeWidth(cell, zoom, ratio, minScreenStroke) {
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
function drawGridLines(
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
  const _solidGroups = new Map();
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

function drawCodes(
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
) {
  if (cell * (zoom || 1) < GRID_FINE_MIN_SCREEN_CELL) return;
  const font = Math.max(CODE_FONT_MIN, Math.round(cell * CODE_FONT_RATIO));
  ctx.font = `${font}px Consolas, "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx0 = viewport ? Math.max(0, viewport.x0) : 0;
  const cx1 = viewport ? Math.min(width - 1, viewport.x1) : width - 1;
  const cy0 = viewport ? Math.max(0, viewport.y0) : 0;
  const cy1 = viewport ? Math.min(height - 1, viewport.y1) : height - 1;
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const p = y * width + x;
      if (displayIdx[p] < 0) continue;
      const code = codes[p];
      if (!code) continue;
      const x0 = originX + x * cell + cell / 2;
      const y0 = originY + y * cell + cell / 2;
      const v = displayRgb[p];
      const c = v ? rgbFromPacked(v) : CODE_FALLBACK_RGB;
      ctx.fillStyle = textColor(c[0], c[1], c[2]);
      ctx.fillText(code, x0, y0);
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
  const _perRow = Math.max(1, Math.floor((gridW - 2 * pad) / entryW));
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

// 收集连通块外边界边（画布坐标 + 所属格索引），供选区虚线 / 色号高亮描边复用
function collectComponentEdges(comp, width, height, originX, originY, cell) {
  const set = new Set(comp);
  const edges = [];
  for (const p of comp) {
    const x = p % width;
    const y = (p / width) | 0;
    const x0 = originX + x * cell;
    const y0 = originY + y * cell;
    const push = (ex0, ey0, ex1, ey1) => edges.push({ x0: ex0, y0: ey0, x1: ex1, y1: ey1, p });
    if (y === 0 || !set.has(p - width)) push(x0, y0, x0 + cell, y0);
    if (y === height - 1 || !set.has(p + width)) push(x0, y0 + cell, x0 + cell, y0 + cell);
    if (x === 0 || !set.has(p - 1)) push(x0, y0, x0, y0 + cell);
    if (x === width - 1 || !set.has(p + 1)) push(x0 + cell, y0, x0 + cell, y0 + cell);
  }
  return edges;
}

// 把一组边画成一条路径并 stroke（选区虚线双色各调一次）
function strokeEdges(ctx, edges) {
  ctx.beginPath();
  for (const e of edges) {
    ctx.moveTo(e.x0, e.y0);
    ctx.lineTo(e.x1, e.y1);
  }
  ctx.stroke();
}

// 选区显示：与鼠标悬停一致的黑白虚线，连通区域（四方向）合并为整块外轮廓
function drawSelection(ctx, selected, width, height, originX, originY, cell, zoom) {
  if (!selected?.size) return;
  // 线宽与虚线段加屏幕像素下限（参考色号高亮逻辑），缩小图片时选区仍清晰可读
  const z = zoom || 1;
  const hlw = adaptiveStrokeWidth(cell, z, HOVER_STROKE_RATIO, SELECTION_MIN_SCREEN_STROKE);
  const dash = Math.max(
    HOVER_DASH_MIN,
    Math.round(cell * HOVER_DASH_RATIO),
    Math.ceil(SELECTION_MIN_SCREEN_DASH / z),
  );
  const components = findConnectedComponents(width, height, (p) => selected.has(p));
  const edgeSets = components.map((comp) =>
    collectComponentEdges(comp, width, height, originX, originY, cell),
  );
  ctx.save();
  ctx.lineWidth = hlw;
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = '#000000';
  for (const edges of edgeSets) strokeEdges(ctx, edges);
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = '#FFFFFF';
  for (const edges of edgeSets) strokeEdges(ctx, edges);
  ctx.restore();
}

// 色号高亮连通块外轮廓：按所在格亮度逐边着色，只画与外界相邻的边
function drawHighlightOutline(
  ctx,
  comp,
  width,
  height,
  _displayIdx,
  displayRgb,
  originX,
  originY,
  cell,
  hlw,
) {
  const edges = collectComponentEdges(comp, width, height, originX, originY, cell);
  ctx.save();
  ctx.lineWidth = hlw;
  ctx.lineJoin = 'miter';
  for (const e of edges) {
    const rgb = rgbFromPacked(displayRgb[e.p]);
    ctx.strokeStyle = isLightColor(rgb)
      ? `rgba(0, 0, 0, ${HIGHLIGHT_FRAME_LIGHT})`
      : `rgba(255, 255, 255, ${HIGHLIGHT_FRAME_DARK})`;
    ctx.beginPath();
    ctx.moveTo(e.x0, e.y0);
    ctx.lineTo(e.x1, e.y1);
    ctx.stroke();
  }
  ctx.restore();
}

// 右下角投影（L 形细线），用于 3D 凸起 / 画笔悬停
function drawDropShadow(ctx, bx0, by0, bw, bh) {
  ctx.strokeStyle = `rgba(0, 0, 0, ${RAISED_SHADOW_ALPHA})`;
  ctx.beginPath();
  ctx.moveTo(bx0 + bw + 0.5, by0 + 1.5);
  ctx.lineTo(bx0 + bw + 0.5, by0 + bh + 0.5);
  ctx.lineTo(bx0 + 1.5, by0 + bh + 0.5);
  ctx.stroke();
}

// 3D 凸起矩形：右下投影 + 上左高光斜面 + 下右暗斜面 + 左上高光点（取色 / 画笔共用）
function drawRaisedRect(ctx, bx0, by0, bw, bh, hlw, gloss) {
  ctx.save();
  ctx.lineWidth = hlw;
  // 投影（落在矩形右下外侧）
  drawDropShadow(ctx, bx0, by0, bw, bh);
  // 高光斜面：上 / 左
  ctx.strokeStyle = `rgba(255, 255, 255, ${RAISED_BEVEL_LIGHT_ALPHA})`;
  ctx.beginPath();
  ctx.moveTo(bx0 + 0.5, by0 + 0.5);
  ctx.lineTo(bx0 + bw - 0.5, by0 + 0.5);
  ctx.moveTo(bx0 + 0.5, by0 + 0.5);
  ctx.lineTo(bx0 + 0.5, by0 + bh - 0.5);
  ctx.stroke();
  // 暗斜面：下 / 右
  ctx.strokeStyle = `rgba(0, 0, 0, ${RAISED_BEVEL_DARK_ALPHA})`;
  ctx.beginPath();
  ctx.moveTo(bx0 + 0.5, by0 + bh - 0.5);
  ctx.lineTo(bx0 + bw - 0.5, by0 + bh - 0.5);
  ctx.moveTo(bx0 + bw - 0.5, by0 + 0.5);
  ctx.lineTo(bx0 + bw - 0.5, by0 + bh - 0.5);
  ctx.stroke();
  // 左上角高光点（矩形足够大时才画）
  if (gloss) {
    ctx.fillStyle = `rgba(255, 255, 255, ${RAISED_GLOSS_ALPHA})`;
    ctx.beginPath();
    ctx.ellipse(bx0 + 5, by0 + 5, 2, 1.5, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 鼠标指向像素的 hover 边框：按工具模式区分样式
// - select ：黑白相间虚线
// - brush ：每格颜色边框 + 黑色外框 + 阴影，按画笔尺寸显示矩形区域
// - picker：3D 凸起（把格子“吸起来”）
// - eraser：亮度自适应边框 + 对角 X，按尺寸显示矩形区域
function drawHover(ctx, state) {
  const {
    hover,
    tool,
    brushRgb,
    brushSize,
    width,
    height,
    displayIdx,
    displayRgb,
    originX,
    originY,
    cell,
    zoom,
  } = state;
  if (!hover || !tool || cell * zoom < HOVER_MIN_SCREEN_CELL) return;
  const p = hover.y * width + hover.x;
  if (p < 0 || p >= width * height) return;
  // 取色只作用于非空位（橡皮按矩形区域判断，见 eraser 分支）
  if (tool === TOOLS.PICKER && displayIdx[p] < 0) return;
  if (tool === TOOLS.BRUSH && !brushRgb) return;
  const size = brushSize || 1;

  const x0 = originX + hover.x * cell;
  const y0 = originY + hover.y * cell;
  // 画布线宽只随格尺寸等比变化，屏幕上的粗细由 CSS 缩放呈现，
  // 这样缩放时边框会跟着格子一起变粗/变细，直到低于隐藏阈值
  const hlw = Math.max(1, Math.round(cell * HOVER_STROKE_RATIO));
  const inset = hlw / 2;

  if (tool === TOOLS.SELECT || tool === TOOLS.WAND) {
    // 选择模式 / 魔棒：双色错位虚线，黑先画，白偏移半个虚线周期后叠加，形成相间效果
    const dash = Math.max(HOVER_DASH_MIN, Math.round(cell * HOVER_DASH_RATIO));
    ctx.save();
    ctx.lineWidth = hlw;
    ctx.setLineDash([dash, dash]);
    ctx.strokeStyle = '#000000';
    ctx.lineDashOffset = 0;
    ctx.strokeRect(x0 + inset, y0 + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineDashOffset = dash;
    ctx.strokeRect(x0 + inset, y0 + inset, cell - inset * 2, cell - inset * 2);
    ctx.restore();
    return;
  }

  if (tool === TOOLS.PICKER) {
    // 3D 凸起效果：像把格子“吸起来”
    drawRaisedRect(ctx, x0, y0, cell, cell, hlw, cell >= 14);
    return;
  }

  if (tool === TOOLS.BRUSH) {
    // 内部每一格边缘涂上画笔颜色，大方形外圈加黑色细实线，右下保留阴影；
    // 按画笔尺寸显示整个矩形（边长 2n-1，不裁剪，保持形状一致）
    const r = size - 1;
    const bx0 = originX + (hover.x - r) * cell;
    const by0 = originY + (hover.y - r) * cell;
    const bw = (2 * r + 1) * cell;
    const bh = (2 * r + 1) * cell;
    const brushHlw = Math.max(1, Math.round(cell * HOVER_BRUSH_STROKE_RATIO));
    ctx.save();
    // 只渲染在图案区域内，不覆盖四周行列号条
    ctx.beginPath();
    ctx.rect(originX, originY, width * cell, height * cell);
    ctx.clip();
    // 右下阴影
    ctx.lineWidth = hlw;
    drawDropShadow(ctx, bx0, by0, bw, bh);
    // 每一格边缘涂上画笔颜色
    ctx.lineWidth = brushHlw;
    ctx.strokeStyle = `rgb(${brushRgb[0]}, ${brushRgb[1]}, ${brushRgb[2]})`;
    for (let gy = 0; gy < 2 * r + 1; gy++) {
      for (let gx = 0; gx < 2 * r + 1; gx++) {
        const cx0 = bx0 + gx * cell;
        const cy0 = by0 + gy * cell;
        ctx.strokeRect(cx0 + brushHlw / 2, cy0 + brushHlw / 2, cell - brushHlw, cell - brushHlw);
      }
    }
    // 大方形外边框：黑色细实线（画在颜色边框之上）
    ctx.lineWidth = hlw;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(bx0 + hlw / 2, by0 + hlw / 2, bw - hlw, bh - hlw);
    ctx.restore();
    return;
  }

  // eraser：亮度自适应边框 + 对角 X；按橡皮尺寸显示整个矩形（不裁剪，X 不随边缘/角落形变）
  const r = size - 1;
  const bx0 = originX + (hover.x - r) * cell;
  const by0 = originY + (hover.y - r) * cell;
  const bw = (2 * r + 1) * cell;
  const bh = (2 * r + 1) * cell;
  // 图案范围内至少一个非空位才显示（空位擦了没意义），描边颜色取第一个非空位格子的亮度
  let ref = -1;
  for (
    let yy = Math.max(0, hover.y - r);
    yy <= Math.min(height - 1, hover.y + r) && ref < 0;
    yy++
  ) {
    for (let xx = Math.max(0, hover.x - r); xx <= Math.min(width - 1, hover.x + r); xx++) {
      const pp = yy * width + xx;
      if (displayIdx[pp] >= 0) {
        ref = displayRgb[pp];
        break;
      }
    }
  }
  if (ref < 0) return;
  const rgb = rgbFromPacked(ref);
  const frame = isLightColor(rgb)
    ? `rgba(0, 0, 0, ${HIGHLIGHT_FRAME_LIGHT})`
    : `rgba(255, 255, 255, ${HIGHLIGHT_FRAME_DARK})`;
  ctx.save();
  // 只渲染在图案区域内，不覆盖四周行列号条
  ctx.beginPath();
  ctx.rect(originX, originY, width * cell, height * cell);
  ctx.clip();
  ctx.lineWidth = hlw;
  ctx.strokeStyle = frame;
  ctx.strokeRect(bx0 + inset, by0 + inset, bw - inset * 2, bh - inset * 2);
  ctx.beginPath();
  ctx.moveTo(bx0 + hlw, by0 + hlw);
  ctx.lineTo(bx0 + bw - hlw, by0 + bh - hlw);
  ctx.moveTo(bx0 + bw - hlw, by0 + hlw);
  ctx.lineTo(bx0 + hlw, by0 + bh - hlw);
  ctx.stroke();
  ctx.restore();
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
  const cx0 = viewport ? Math.max(0, viewport.x0) : 0;
  const cx1 = viewport ? Math.min(width - 1, viewport.x1) : width - 1;
  const cy0 = viewport ? Math.max(0, viewport.y0) : 0;
  const cy1 = viewport ? Math.min(height - 1, viewport.y1) : height - 1;
  for (let y = cy0; y <= cy1; y++) {
    const y0 = oy + y * cell;
    for (let x = cx0; x <= cx1; x++) {
      const x0 = ox + x * cell;
      const p = y * width + x;
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
  }

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

// 裁剪模式覆盖层：矩形外部 40% 黑色蒙版 + 纯色边框（选中/拖拽边蓝色，其余红色）+ 预览红虚线
function drawCropOverlay(ctx, crop, activeEdge, cell, ox, oy, zoom, preview, width, height) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const rx0 = ox + crop.x0 * cell;
  const ry0 = oy + crop.y0 * cell;
  const rx1 = ox + (crop.x1 + 1) * cell;
  const ry1 = oy + (crop.y1 + 1) * cell;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  // 蒙版分 8 块绘制、互不重合：上/下带横跨图案区（不含画布四角）；
  // 左/右带分三段——裁剪框上下沿之间整条盖满，之外只盖行列号条。
  // 这样四个斜向区域不会重复压暗，四角保持透明避免与压暗后的工作区背景叠成两层
  ctx.fillRect(cell, 0, W - 2 * cell, ry0); // 上
  ctx.fillRect(cell, ry1, W - 2 * cell, H - ry1); // 下
  ctx.fillRect(0, ry0, rx0, ry1 - ry0); // 左中（裁剪框上下沿之间）
  ctx.fillRect(rx1, ry0, W - rx1, ry1 - ry0); // 右中
  ctx.fillRect(0, cell, cell, Math.max(0, ry0 - cell)); // 左上行列号条段
  ctx.fillRect(W - cell, cell, cell, Math.max(0, ry0 - cell)); // 右上行列号条段
  ctx.fillRect(0, ry1, cell, Math.max(0, H - cell - ry1)); // 左下行列号条段
  ctx.fillRect(W - cell, ry1, cell, Math.max(0, H - cell - ry1)); // 右下行列号条段
  ctx.lineWidth = Math.max(2, Math.round(2 / (zoom || 1)));
  const edges = [
    ['left', rx0, ry0, rx0, ry1],
    ['right', rx1, ry0, rx1, ry1],
    ['top', rx0, ry0, rx1, ry0],
    ['bottom', rx0, ry1, rx1, ry1],
  ];
  for (const [name, x0, y0, x1, y1] of edges) {
    ctx.strokeStyle = name === activeEdge ? CROP_EDGE_ACTIVE_COLOR : CROP_EDGE_COLOR;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // 预览虚线：选中边后将移动到的平行格线（跨整个图案）
  if (preview) {
    ctx.strokeStyle = CROP_EDGE_COLOR;
    ctx.setLineDash([6 / (zoom || 1), 5 / (zoom || 1)]);
    ctx.lineWidth = Math.max(1.5, Math.round(1.5 / (zoom || 1)));
    ctx.beginPath();
    if (preview.horizontal) {
      ctx.moveTo(ox + preview.pos * cell, oy);
      ctx.lineTo(ox + preview.pos * cell, oy + height * cell);
    } else {
      ctx.moveTo(ox, oy + preview.pos * cell);
      ctx.lineTo(ox + width * cell, oy + preview.pos * cell);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// 覆盖层：选区虚线 / 色号高亮 / 裁剪蒙版与边框 / hover 边框 / 九宫格目标格浮起（叠加在底图之上）
export function drawPatternOverlay(ctx, width, height, displayIdx, displayRgb, opts) {
  const cell = opts.cell || CELL;
  const outerPad = opts.outerPad ?? OUTER_PAD;
  const edge = opts.edgeNumbers ? cell : 0;
  const metrics = canvasMetrics(width, height, cell, 0, outerPad, edge);
  const ox = metrics.originX;
  const oy = metrics.originY;

  drawSelection(ctx, opts.selected, width, height, ox, oy, cell, opts.zoom || 1);

  // 颜色清单高亮：半透明覆盖层 + 亮度自适应描边（描边带屏幕像素下限）
  if (opts.highlightColor != null && opts.highlightBlink !== false) {
    const zoom = opts.zoom || 1;
    const hlw = adaptiveStrokeWidth(
      cell,
      zoom,
      HIGHLIGHT_STROKE_RATIO,
      HIGHLIGHT_MIN_SCREEN_STROKE,
    );
    // 按四方向连通性分组：相连的同色像素作为一个整块
    const components = findConnectedComponents(
      width,
      height,
      (p) => displayIdx[p] === opts.highlightColor,
    );
    for (const comp of components) {
      // 半透明覆盖层（逐格）：暗色格子提亮、亮色格子压暗，任何颜色都有反差
      for (const p of comp) {
        const x = p % width;
        const y = (p / width) | 0;
        const light = isLightColor(rgbFromPacked(displayRgb[p]));
        const x0 = ox + x * cell;
        const y0 = oy + y * cell;
        ctx.fillStyle = light
          ? `rgba(0, 0, 0, ${HIGHLIGHT_WASH_LIGHT})`
          : `rgba(255, 255, 255, ${HIGHLIGHT_WASH_DARK})`;
        ctx.fillRect(x0, y0, cell, cell);
      }
    }
    // 外轮廓：整块只描一次边界，内部不再逐格描边
    for (const comp of components) {
      drawHighlightOutline(ctx, comp, width, height, displayIdx, displayRgb, ox, oy, cell, hlw);
    }
  }

  // 裁剪模式：蒙版 + 边框（高亮之上、hover 之下）
  if (opts.crop) {
    drawCropOverlay(
      ctx,
      opts.crop,
      opts.cropActiveEdge || null,
      cell,
      ox,
      oy,
      opts.zoom || 1,
      opts.cropPreview || null,
      width,
      height,
    );
  }

  // 鼠标指向像素的 hover 边框画在最上层（高亮之上），保证任意模式下都可见
  const toolState = opts.toolState || {};
  drawHover(ctx, {
    hover: toolState.hover,
    tool: toolState.tool,
    brushRgb: toolState.brushRgb,
    brushSize: toolState.brushSize || 1,
    width,
    height,
    displayIdx,
    displayRgb,
    originX: ox,
    originY: oy,
    cell,
    zoom: opts.zoom || 1,
  });

  // 九宫格改色目标格：浮起效果提示当前要改的格子
  if (toolState.pickerCell) {
    const px = ox + toolState.pickerCell.x * cell;
    const py = oy + toolState.pickerCell.y * cell;
    drawRaisedRect(
      ctx,
      px,
      py,
      cell,
      cell,
      Math.max(1, Math.round(cell * HOVER_STROKE_RATIO)),
      cell >= 14,
    );
  }
}

export function drawPattern(ctx, width, height, displayIdx, displayRgb, opts) {
  drawPatternBase(ctx, width, height, displayIdx, displayRgb, opts);
  drawPatternOverlay(ctx, width, height, displayIdx, displayRgb, opts);
}

export function clearCanvas(ctx) {
  ctx.canvas.width = 0;
  ctx.canvas.height = 0;
}
