// 裁剪工具：矩形编辑、自动裁剪、应用裁剪（结构性撤销）、低缩放放大镜。

import { scheduleAutosave } from './autosave.js';
import { clearProjectEditingState } from './canvas.js';
import * as C from './colors.js';
import { CANVAS_EDGE_CELLS, CROP_EDGE_HIT_PX, TOOLS } from './constants.js';
import { els } from './els.js';
import { createTransaction, recordStructuralStep } from './history.js';
import { renderHistoryUI } from './history-ui.js';
import { interactionState } from './interaction.js';
import { renderFullNow, scheduleCanvasRender } from './render-queue.js';
import { App, dragState, setDirty } from './state.js';
import { setTool } from './tool-state.js';
import { clampInt, hideCropMagnifier, toast } from './utils.js';
import { canvasScale, eventToCanvasPos, fitViewportToCanvas } from './view.js';

// 裁剪等结构性操作的统一记录入口：旧增量步骤因坐标失效会被清空
export function recordCropStep(before, after) {
  return recordStructuralStep(App.undoStack, App.redoStack, before, after, 'crop');
}

// 事件坐标 → 画布内连续格坐标（horizontal=true 取横向 x，否则取纵向 y）
function cropPosFromEvent(e, horizontal, rect) {
  const p = eventToCanvasPos(e, rect);
  return (horizontal ? p.x : p.y) / App.screenCell - CANVAS_EDGE_CELLS;
}

// 命中检测：鼠标是否靠近某条边（屏幕像素阈值内）
function cropEdgeAt(e, rect) {
  if (!App.project || !interactionState.crop) return null;
  const scale = canvasScale(rect);
  const { x: px, y: py } = eventToCanvasPos(e, rect);
  const cell = App.screenCell;
  const ox = CANVAS_EDGE_CELLS * cell;
  const c = interactionState.crop;
  const rx0 = ox + c.x0 * cell;
  const ry0 = ox + c.y0 * cell;
  const rx1 = ox + (c.x1 + 1) * cell;
  const ry1 = ox + (c.y1 + 1) * cell;
  const t = CROP_EDGE_HIT_PX / scale;
  const cands = [];
  if (py >= ry0 - t && py <= ry1 + t) {
    cands.push(['left', Math.abs(px - rx0)], ['right', Math.abs(px - rx1)]);
  }
  if (px >= rx0 - t && px <= rx1 + t) {
    cands.push(['top', Math.abs(py - ry0)], ['bottom', Math.abs(py - ry1)]);
  }
  let best = null;
  let bestD = t;
  for (const [edge, d] of cands) {
    if (d <= bestD) {
      best = edge;
      bestD = d;
    }
  }
  return best;
}

// 移动一条边到指定格线位置（自动裁剪到图片边界，且保证最小 1 格）
export function moveCropEdgeTo(edge, pos) {
  if (!App.project || !interactionState.crop) return;
  const c = interactionState.crop;
  const w = App.project.width;
  const h = App.project.height;
  const v = Math.round(pos);
  if (edge === 'left') c.x0 = clampInt(v, 0, c.x1);
  else if (edge === 'right') c.x1 = clampInt(v - 1, c.x0, w - 1);
  else if (edge === 'top') c.y0 = clampInt(v, 0, c.y1);
  else if (edge === 'bottom') c.y1 = clampInt(v - 1, c.y0, h - 1);
  scheduleCanvasRender();
}

// 已选中一条边时，把点击位置换算成与之平行的格线索引
function cropLineFromEvent(e, rect) {
  if (!interactionState.cropActiveEdge) return null;
  const horizontal =
    interactionState.cropActiveEdge === 'left' || interactionState.cropActiveEdge === 'right';
  return Math.round(cropPosFromEvent(e, horizontal, rect));
}

// 是否在图案 + 行列号条区域内（此范围内可选中/拖拽红边；再往外才算「图片之外」）
function isInCropArea(e, rect) {
  if (!App.project) return false;
  const { x: px, y: py } = eventToCanvasPos(e, rect);
  const cell = App.screenCell;
  const totalW = (App.project.width + 2 * CANVAS_EDGE_CELLS) * cell;
  const totalH = (App.project.height + 2 * CANVAS_EDGE_CELLS) * cell;
  return px >= -2 && py >= -2 && px <= totalW + 2 && py <= totalH + 2;
}

export function handleCropMouseDown(e, rect) {
  if (!App.project || !interactionState.crop) return;
  if (!isInCropArea(e, rect)) {
    // 图片之外：取消当前边选择，不修改位置
    if (interactionState.cropActiveEdge != null) {
      interactionState.cropActiveEdge = null;
      interactionState.cropPreview = null;
      scheduleCanvasRender();
    }
    return;
  }
  // 1) 点中某条边：选中并进入拖拽
  const edge = cropEdgeAt(e, rect);
  if (edge) {
    interactionState.cropActiveEdge = edge;
    dragState.cropEdge = edge; // 进入拖拽状态：mousemove 时移动该边
    interactionState.cropPreview = null;
    scheduleCanvasRender();
    return;
  }
  // 2) 已选中边：点击平行格线 → 移动该边
  if (interactionState.cropActiveEdge) {
    const line = cropLineFromEvent(e, rect);
    if (line != null) moveCropEdgeTo(interactionState.cropActiveEdge, line);
    return;
  }
  // 3) 未选中边且点击空白：不做操作
}

// 拖拽移动选中的边
export function updateCropEdgeDrag(e, rect) {
  const edge = dragState.cropEdge;
  if (!edge || !interactionState.crop) return;
  const horizontal = edge === 'left' || edge === 'right';
  moveCropEdgeTo(edge, cropPosFromEvent(e, horizontal, rect));
}

// 裁剪模式鼠标：边命中或已选中边时显示调整光标（上下/左右双箭头）
export function updateCropCursor(e, rect) {
  if (App.tool !== TOOLS.CROP || !App.project || !interactionState.crop) {
    els.canvas.style.cursor = '';
    return;
  }
  if (dragState.cropEdge) {
    els.canvas.style.cursor =
      dragState.cropEdge === 'left' || dragState.cropEdge === 'right' ? 'ew-resize' : 'ns-resize';
    return;
  }
  const edge = cropEdgeAt(e, rect) || interactionState.cropActiveEdge;
  els.canvas.style.cursor = edge
    ? edge === 'left' || edge === 'right'
      ? 'ew-resize'
      : 'ns-resize'
    : '';
}

// 裁剪预览：选中边且鼠标在图案内时，记录该边将移动到的平行格线（红虚线预览）
export function updateCropPreview(e, rect) {
  const active =
    App.tool === TOOLS.CROP &&
    App.project &&
    interactionState.crop &&
    interactionState.cropActiveEdge &&
    !dragState.cropEdge &&
    isInCropArea(e, rect);
  if (!active) return; // 图片之外：保留当前预览位置，不更新也不清除
  const horizontal =
    interactionState.cropActiveEdge === 'left' || interactionState.cropActiveEdge === 'right';
  const pos = Math.round(cropPosFromEvent(e, horizontal, rect));
  const maxPos = horizontal ? App.project.width : App.project.height;
  const clamped = clampInt(pos, 0, maxPos);
  if (
    !interactionState.cropPreview ||
    interactionState.cropPreview.horizontal !== horizontal ||
    interactionState.cropPreview.pos !== clamped
  ) {
    interactionState.cropPreview = { horizontal, pos: clamped };
    scheduleCanvasRender();
  }
}

// 自动裁剪：外框收缩到非空格的包围盒（再缩一行/一列就会出现空格）
export function autoCrop() {
  if (!App.project || App.tool !== TOOLS.CROP || !interactionState.crop) return;
  const { grid, width, height } = App.project;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x] >= 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    toast('图案全为空位，无法自动裁剪');
    return;
  }
  interactionState.crop = { x0: minX, y0: minY, x1: maxX, y1: maxY };
  interactionState.cropActiveEdge = null;
  hideCropMagnifier();
  scheduleCanvasRender();
}

// 应用裁剪：记录结构性撤销步骤 + 裁剪前事务快照，然后切换尺寸
export function applyCrop() {
  if (!App.project || App.tool !== TOOLS.CROP || !interactionState.crop) return;
  const { x0, y0, x1, y1 } = interactionState.crop;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x1 >= App.project.width || y1 >= App.project.height)
    return;
  if (w === App.project.width && h === App.project.height) {
    toast('未做任何裁剪');
    setTool(TOOLS.SELECT);
    return;
  }
  const before = {
    width: App.project.width,
    height: App.project.height,
    grid: App.project.grid.slice(),
    baseGrid: App.baseGrid.slice(),
  };
  const newGrid = new Int16Array(w * h);
  const newBase = new Int16Array(w * h);
  const srcW = App.project.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sp = (y0 + y) * srcW + (x0 + x);
      newGrid[y * w + x] = App.project.grid[sp];
      newBase[y * w + x] = App.baseGrid[sp];
    }
  }
  const after = { width: w, height: h, grid: newGrid, baseGrid: newBase };
  // 事务历史：保存裁剪前的快照，随时可切回
  const snapshot = {
    grid: Array.from(before.grid),
    width: before.width,
    height: before.height,
    paletteName: App.configName,
    palette: App.appliedPalette.map((c) => ({ ...c })),
    maxColors: App.maxColors,
  };
  const item = createTransaction(App.history, snapshot);
  item.label = `裁剪前${before.width}×${before.height}`;
  // 单步撤销：结构性步骤（旧增量步骤因坐标失效被清空）
  recordCropStep(before, after);
  // 应用
  App.project = { width: w, height: h, grid: newGrid };
  App.baseGrid = newBase;
  App.sliderN = null;
  App.editedSinceSlider = false;
  App.maxColors = Math.max(2, C.countUsedColors(newGrid, w, h));
  clearProjectEditingState();
  setTool(TOOLS.SELECT);
  setDirty(true);
  renderHistoryUI();
  renderFullNow();
  fitViewportToCanvas();
  scheduleAutosave();
  toast(`已裁剪为 ${w} × ${h}`);
}
