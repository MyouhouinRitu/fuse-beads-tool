import {
  CELL,
  GRID_MARGIN_CELLS,
  OUTER_PAD,
  HIGHLIGHT_STROKE_RATIO,
  HIGHLIGHT_MIN_SCREEN_STROKE,
  HIGHLIGHT_WASH_DARK,
  HIGHLIGHT_WASH_LIGHT,
  HIGHLIGHT_FRAME_DARK,
  HIGHLIGHT_FRAME_LIGHT,
  HOVER_MIN_SCREEN_CELL,
  HOVER_STROKE_RATIO,
  HOVER_BRUSH_STROKE_RATIO,
  HOVER_DASH_RATIO,
  HOVER_DASH_MIN,
  SELECTION_MIN_SCREEN_STROKE,
  SELECTION_MIN_SCREEN_DASH,
  RAISED_SHADOW_ALPHA,
  RAISED_BEVEL_LIGHT_ALPHA,
  RAISED_BEVEL_DARK_ALPHA,
  RAISED_GLOSS_ALPHA,
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

// 自适应描边线宽：按格子的常用宽度与屏幕像素下限取较大者，
// 并限制不超过半格，避免格子太小时描边几何失效
function adaptiveStrokeWidth(cell, zoom, ratio, minScreenStroke) {
  return Math.max(
    Math.round(cell * ratio),
    Math.min(
      Math.ceil(minScreenStroke / zoom),
      Math.max(1, Math.floor(cell / 2))
    )
  );
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
      if (x > 0 && !visited[q - 1] && isMember(q - 1)) { visited[q - 1] = 1; stack.push(q - 1); }
      if (x < width - 1 && !visited[q + 1] && isMember(q + 1)) { visited[q + 1] = 1; stack.push(q + 1); }
      if (q >= width && !visited[q - width] && isMember(q - width)) { visited[q - width] = 1; stack.push(q - width); }
      if (q < n - width && !visited[q + width] && isMember(q + width)) { visited[q + width] = 1; stack.push(q + width); }
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
    const x0 = originX + (x + GRID_MARGIN_CELLS) * cell;
    const y0 = originY + (y + GRID_MARGIN_CELLS) * cell;
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
  if (!selected || !selected.size) return;
  // 线宽与虚线段加屏幕像素下限（参考色号高亮逻辑），缩小图片时选区仍清晰可读
  const z = zoom || 1;
  const hlw = adaptiveStrokeWidth(cell, z, HOVER_STROKE_RATIO, SELECTION_MIN_SCREEN_STROKE);
  const dash = Math.max(
    HOVER_DASH_MIN,
    Math.round(cell * HOVER_DASH_RATIO),
    Math.ceil(SELECTION_MIN_SCREEN_DASH / z)
  );
  const components = findConnectedComponents(width, height, (p) => selected.has(p));
  const edgeSets = components.map((comp) => collectComponentEdges(comp, width, height, originX, originY, cell));
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
function drawHighlightOutline(ctx, comp, width, height, displayIdx, displayRgb, originX, originY, cell, hlw) {
  const edges = collectComponentEdges(comp, width, height, originX, originY, cell);
  ctx.save();
  ctx.lineWidth = hlw;
  ctx.lineJoin = 'miter';
  for (const e of edges) {
    const v = displayRgb[e.p];
    const rgb = [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
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
    hover, tool, brushRgb, brushSize,
    width, height, displayIdx, displayRgb,
    originX, originY, cell, zoom,
  } = state;
  if (!hover || !tool || cell * zoom < HOVER_MIN_SCREEN_CELL) return;
  const p = hover.y * width + hover.x;
  if (p < 0 || p >= width * height) return;
  // 取色只作用于非空位（橡皮按矩形区域判断，见 eraser 分支）
  if (tool === 'picker' && displayIdx[p] < 0) return;
  if (tool === 'brush' && !brushRgb) return;
  const size = brushSize || 1;

  const x0 = originX + (hover.x + GRID_MARGIN_CELLS) * cell;
  const y0 = originY + (hover.y + GRID_MARGIN_CELLS) * cell;
  // 画布线宽只随格尺寸等比变化，屏幕上的粗细由 CSS 缩放呈现，
  // 这样缩放时边框会跟着格子一起变粗/变细，直到低于隐藏阈值
  const hlw = Math.max(1, Math.round(cell * HOVER_STROKE_RATIO));
  const inset = hlw / 2;

  if (tool === 'select') {
    // 双色错位虚线：黑先画，白偏移半个虚线周期后叠加，形成相间效果
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

  if (tool === 'picker') {
    // 3D 凸起效果：像把格子“吸起来”
    drawRaisedRect(ctx, x0, y0, cell, cell, hlw, cell >= 14);
    return;
  }

  if (tool === 'brush') {
    // 内部每一格边缘涂上画笔颜色，大方形外圈加黑色细实线，右下保留阴影；
    // 按画笔尺寸显示整个矩形（边长 2n-1，不裁剪，保持形状一致）
    const r = size - 1;
    const bx0 = originX + (hover.x - r + GRID_MARGIN_CELLS) * cell;
    const by0 = originY + (hover.y - r + GRID_MARGIN_CELLS) * cell;
    const bw = (2 * r + 1) * cell;
    const bh = (2 * r + 1) * cell;
    const brushHlw = Math.max(1, Math.round(cell * HOVER_BRUSH_STROKE_RATIO));
    ctx.save();
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
  const bx0 = originX + (hover.x - r + GRID_MARGIN_CELLS) * cell;
  const by0 = originY + (hover.y - r + GRID_MARGIN_CELLS) * cell;
  const bw = (2 * r + 1) * cell;
  const bh = (2 * r + 1) * cell;
  // 图案范围内至少一个非空位才显示（空位擦了没意义），描边颜色取第一个非空位格子的亮度
  let ref = -1;
  for (let yy = Math.max(0, hover.y - r); yy <= Math.min(height - 1, hover.y + r) && ref < 0; yy++) {
    for (let xx = Math.max(0, hover.x - r); xx <= Math.min(width - 1, hover.x + r); xx++) {
      const pp = yy * width + xx;
      if (displayIdx[pp] >= 0) { ref = displayRgb[pp]; break; }
    }
  }
  if (ref < 0) return;
  const rgb = [(ref >>> 16) & 255, (ref >>> 8) & 255, ref & 255];
  const frame = isLightColor(rgb)
    ? `rgba(0, 0, 0, ${HIGHLIGHT_FRAME_LIGHT})`
    : `rgba(255, 255, 255, ${HIGHLIGHT_FRAME_DARK})`;
  ctx.save();
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

  drawSelection(ctx, opts.selected, width, height, ox, oy, cell, opts.zoom || 1);

  // 颜色清单高亮：半透明覆盖层 + 亮度自适应描边（描边带屏幕像素下限）
  if (opts.highlightColor != null && opts.highlightBlink !== false) {
    const zoom = opts.zoom || 1;
    const hlw = adaptiveStrokeWidth(cell, zoom, HIGHLIGHT_STROKE_RATIO, HIGHLIGHT_MIN_SCREEN_STROKE);
    // 按四方向连通性分组：相连的同色像素作为一个整块
    const components = findConnectedComponents(width, height, (p) => displayIdx[p] === opts.highlightColor);
    for (const comp of components) {
      // 半透明覆盖层（逐格）：暗色格子提亮、亮色格子压暗，任何颜色都有反差
      for (const p of comp) {
        const x = p % width;
        const y = (p / width) | 0;
        const c = displayRgb[p];
        const r = (c >>> 16) & 255;
        const g = (c >>> 8) & 255;
        const b = c & 255;
        const light = isLightColor([r, g, b]);
        const x0 = ox + (x + GRID_MARGIN_CELLS) * cell;
        const y0 = oy + (y + GRID_MARGIN_CELLS) * cell;
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

  // 鼠标指向像素的 hover 边框画在最上层（高亮之上），保证任意模式下都可见
  const toolState = opts.toolState || {};
  drawHover(
    ctx,
    {
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
    }
  );

  // 九宫格改色目标格：浮起效果提示当前要改的格子
  if (toolState.pickerCell) {
    const px = ox + (toolState.pickerCell.x + GRID_MARGIN_CELLS) * cell;
    const py = oy + (toolState.pickerCell.y + GRID_MARGIN_CELLS) * cell;
    drawRaisedRect(ctx, px, py, cell, cell, Math.max(1, Math.round(cell * HOVER_STROKE_RATIO)), cell >= 14);
  }

  if (legend.length && opts.showLegend !== false) {
    drawLegend(ctx, legend, cell, metrics.gridW, oy + metrics.gridH, outerPad);
  }
}

export function clearCanvas(ctx) {
  ctx.canvas.width = 0;
  ctx.canvas.height = 0;
}
