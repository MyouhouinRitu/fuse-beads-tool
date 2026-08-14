// 覆盖层：选区虚线 / 色号高亮 / 裁剪蒙版与边框 / hover 边框 / 九宫格目标格，以及导出入口。

import { isLightColor, rgbFromPacked } from './colors.js';
import {
  CELL,
  CROP_EDGE_ACTIVE_COLOR,
  CROP_EDGE_COLOR,
  HIGHLIGHT_FRAME_DARK,
  HIGHLIGHT_FRAME_LIGHT,
  HIGHLIGHT_MIN_SCREEN_STROKE,
  HIGHLIGHT_STROKE_RATIO,
  HIGHLIGHT_WASH_DARK,
  HIGHLIGHT_WASH_LIGHT,
  HOVER_DASH_MIN,
  HOVER_DASH_RATIO,
  HOVER_STROKE_RATIO,
  OUTER_PAD,
  SELECTION_MIN_SCREEN_DASH,
  SELECTION_MIN_SCREEN_STROKE,
} from './constants.js';
import {
  adaptiveStrokeWidth,
  canvasMetrics,
  drawPatternBase,
  findConnectedComponents,
} from './render-base.js';
import { drawHover, drawRaisedRect } from './render-hover.js';

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
// 裁剪模式覆盖层：矩形外部 40% 黑色蒙版 + 纯色边框（选中/拖拽边蓝色，其余红色）+ 预览红虚线
// 裁剪框四边：红实线 / 选中边蓝实线（工作区覆盖层与裁剪放大镜共用）
export function strokeCropEdges(ctx, crop, activeEdge, cell, ox, oy, lineWidth) {
  const rx0 = ox + crop.x0 * cell;
  const ry0 = oy + crop.y0 * cell;
  const rx1 = ox + (crop.x1 + 1) * cell;
  const ry1 = oy + (crop.y1 + 1) * cell;
  ctx.lineWidth = lineWidth;
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
}

// 裁剪预览虚线：选中边后将移动到的平行格线（工作区覆盖层与裁剪放大镜共用）
export function strokeCropPreview(ctx, preview, cell, ox, oy, spanW, spanH, { lineWidth, dash }) {
  ctx.strokeStyle = CROP_EDGE_COLOR;
  ctx.setLineDash(dash);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  if (preview.horizontal) {
    ctx.moveTo(ox + preview.pos * cell, oy);
    ctx.lineTo(ox + preview.pos * cell, oy + spanH);
  } else {
    ctx.moveTo(ox, oy + preview.pos * cell);
    ctx.lineTo(ox + spanW, oy + preview.pos * cell);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

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
  strokeCropEdges(ctx, crop, activeEdge, cell, ox, oy, Math.max(2, Math.round(2 / (zoom || 1))));
  // 预览虚线：选中边后将移动到的平行格线（跨整个图案）
  if (preview) {
    strokeCropPreview(ctx, preview, cell, ox, oy, width * cell, height * cell, {
      lineWidth: Math.max(1.5, Math.round(1.5 / (zoom || 1))),
      dash: [6 / (zoom || 1), 5 / (zoom || 1)],
    });
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
