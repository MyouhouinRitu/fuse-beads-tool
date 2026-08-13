// 裁剪工具：矩形编辑、自动裁剪、应用裁剪（结构性撤销）、低缩放放大镜。

import {
  CANVAS_EDGE_CELLS,
  CROP_EDGE_ACTIVE_COLOR,
  CROP_EDGE_COLOR,
  CROP_EDGE_HIT_PX,
  CROP_MAGNIFIER_GAP,
  CROP_MAGNIFIER_MIN_CELL,
  CROP_MAGNIFIER_MIN_SCREEN_CELL,
  CROP_MAGNIFIER_OUTSIDE,
  CROP_MAGNIFIER_SCALE,
  CROP_MAGNIFIER_SIZE,
  CROP_MAGNIFIER_WINDOW_MARGIN,
  TOOLS,
} from './constants.js';
import * as C from './colors.js';
import { els } from './els.js';
import { createTransaction, recordStructuralStep } from './history.js';
import { App, dragState, setDirty } from './state.js';
import { clampInt, hideCropMagnifier, toast } from './utils.js';
import { buildDisplayData, clearProjectEditingState } from './canvas.js';
import { drawPatternBase } from './render.js';
import { renderHistoryUI } from './history-ui.js';
import { setTool } from './tool-state.js';
import { canvasScale, eventToCanvasPos, fitViewportToCanvas } from './view.js';
import { renderAllNow, scheduleCanvasRender } from './render-queue.js';
import { scheduleAutosave } from './autosave.js';

let cropLastMouse = null; // 裁剪模式最近一次鼠标位置（缩放后重绘放大镜用）

// 裁剪等结构性操作的统一记录入口：旧增量步骤因坐标失效会被清空
export function recordCropStep(before, after) {
  return recordStructuralStep(App.undoStack, App.redoStack, before, after, 'crop');
}

// 事件坐标 → 画布内连续格坐标（horizontal=true 取横向 x，否则取纵向 y）
function cropPosFromEvent(e, horizontal) {
  const p = eventToCanvasPos(e);
  return (horizontal ? p.x : p.y) / App.screenCell - CANVAS_EDGE_CELLS;
}

// 命中检测：鼠标是否靠近某条边（屏幕像素阈值内）
function cropEdgeAt(e) {
  if (!App.project || !App.crop) return null;
  const scale = canvasScale();
  const { x: px, y: py } = eventToCanvasPos(e);
  const cell = App.screenCell;
  const ox = CANVAS_EDGE_CELLS * cell;
  const c = App.crop;
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
    if (d <= bestD) { best = edge; bestD = d; }
  }
  return best;
}

// 移动一条边到指定格线位置（自动裁剪到图片边界，且保证最小 1 格）
export function moveCropEdgeTo(edge, pos) {
  if (!App.project || !App.crop) return;
  const c = App.crop;
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
function cropLineFromEvent(e) {
  if (!App.cropActiveEdge) return null;
  const horizontal = App.cropActiveEdge === 'left' || App.cropActiveEdge === 'right';
  return Math.round(cropPosFromEvent(e, horizontal));
}

// 是否在图案 + 行列号条区域内（此范围内可选中/拖拽红边；再往外才算「图片之外」）
function isInCropArea(e) {
  if (!App.project) return false;
  const { x: px, y: py } = eventToCanvasPos(e);
  const cell = App.screenCell;
  const totalW = (App.project.width + 2 * CANVAS_EDGE_CELLS) * cell;
  const totalH = (App.project.height + 2 * CANVAS_EDGE_CELLS) * cell;
  return px >= -2 && py >= -2 && px <= totalW + 2 && py <= totalH + 2;
}

export function handleCropMouseDown(e) {
  if (!App.project || !App.crop) return;
  if (!isInCropArea(e)) {
    // 图片之外：取消当前边选择，不修改位置
    if (App.cropActiveEdge != null) {
      App.cropActiveEdge = null;
      App.cropPreview = null;
      scheduleCanvasRender();
    }
    return;
  }
  // 1) 点中某条边：选中并进入拖拽
  const edge = cropEdgeAt(e);
  if (edge) {
    App.cropActiveEdge = edge;
    dragState.cropEdge = edge; // 进入拖拽状态：mousemove 时移动该边
    App.cropPreview = null;
    scheduleCanvasRender();
    return;
  }
  // 2) 已选中边：点击平行格线 → 移动该边
  if (App.cropActiveEdge) {
    const line = cropLineFromEvent(e);
    if (line != null) moveCropEdgeTo(App.cropActiveEdge, line);
    return;
  }
  // 3) 未选中边且点击空白：不做操作
}

// 拖拽移动选中的边
export function updateCropEdgeDrag(e) {
  const edge = dragState.cropEdge;
  if (!edge || !App.crop) return;
  const horizontal = edge === 'left' || edge === 'right';
  moveCropEdgeTo(edge, cropPosFromEvent(e, horizontal));
}

// 裁剪模式鼠标：边命中或已选中边时显示调整光标（上下/左右双箭头）
export function updateCropCursor(e) {
  if (App.tool !== TOOLS.CROP || !App.project || !App.crop) {
    els.canvas.style.cursor = '';
    return;
  }
  if (dragState.cropEdge) {
    els.canvas.style.cursor = dragState.cropEdge === 'left' || dragState.cropEdge === 'right' ? 'ew-resize' : 'ns-resize';
    return;
  }
  const edge = cropEdgeAt(e) || App.cropActiveEdge;
  els.canvas.style.cursor = edge ? (edge === 'left' || edge === 'right' ? 'ew-resize' : 'ns-resize') : '';
}

// 裁剪预览：选中边且鼠标在图案内时，记录该边将移动到的平行格线（红虚线预览）
export function updateCropPreview(e) {
  const active = App.tool === TOOLS.CROP && App.project && App.crop
    && App.cropActiveEdge && !dragState.cropEdge && isInCropArea(e);
  if (!active) return; // 图片之外：保留当前预览位置，不更新也不清除
  const horizontal = App.cropActiveEdge === 'left' || App.cropActiveEdge === 'right';
  const pos = Math.round(cropPosFromEvent(e, horizontal));
  const maxPos = horizontal ? App.project.width : App.project.height;
  const clamped = clampInt(pos, 0, maxPos);
  if (!App.cropPreview || App.cropPreview.horizontal !== horizontal || App.cropPreview.pos !== clamped) {
    App.cropPreview = { horizontal, pos: clamped };
    scheduleCanvasRender();
  }
}

// 自动裁剪：外框收缩到非空格的包围盒（再缩一行/一列就会出现空格）
export function autoCrop() {
  if (!App.project || App.tool !== TOOLS.CROP || !App.crop) return;
  const { grid, width, height } = App.project;
  let minX = width, minY = height, maxX = -1, maxY = -1;
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
  if (maxX < 0) { toast('图案全为空位，无法自动裁剪'); return; }
  App.crop = { x0: minX, y0: minY, x1: maxX, y1: maxY };
  App.cropActiveEdge = null;
  hideCropMagnifier();
  scheduleCanvasRender();
}

// 应用裁剪：记录结构性撤销步骤 + 裁剪前事务快照，然后切换尺寸
export function applyCrop() {
  if (!App.project || App.tool !== TOOLS.CROP || !App.crop) return;
  const { x0, y0, x1, y1 } = App.crop;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x1 >= App.project.width || y1 >= App.project.height) return;
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
  renderHistoryUI();
  renderAllNow();
  fitViewportToCanvas();
  setDirty(true);
  scheduleAutosave();
  toast(`已裁剪为 ${w} × ${h}`);
}

// 放大镜：低缩放下显示鼠标悬停位置 11×11 的放大视图。
// 窗口内容复用底图渲染器（与工作区同一套网格/空位/行列号规范），只叠加裁剪框。
function drawCropMagnifier() {
  const canvas = els.cropMagnifierCanvas;
  const n = CROP_MAGNIFIER_SIZE;
  // 放大后每格尺寸 = 当前屏幕格宽 × 倍率（至少 16px，保证可见）
  const cell = Math.max(CROP_MAGNIFIER_MIN_CELL, Math.round(App.screenCell * App.zoom * CROP_MAGNIFIER_SCALE));
  const { width, height } = App.project;
  const hx = App.hoverCell.x;
  const hy = App.hoverCell.y;
  const dark = document.documentElement.dataset.theme === 'dark';
  const outsideColor = dark ? CROP_MAGNIFIER_OUTSIDE.dark : CROP_MAGNIFIER_OUTSIDE.light;
  // 始终以鼠标悬停格为中心（不夹紧到图案边界），边缘处可看到行列号条与外部区域
  const off = Math.floor((n - 1) / 2);
  const x0 = hx - off;
  const y0 = hy - off;
  // 窗口内容先画到离屏画布（含行列号条，不含色号），图案外区域保持透明；
  // 底图渲染器只画窗口内的格子，避免大图逐帧全量重绘
  const display = buildDisplayData();
  const offCanvas = document.createElement('canvas');
  const octx = offCanvas.getContext('2d');
  drawPatternBase(octx, width, height, display.idx, display.rgb, {
    cell,
    outerPad: 0,
    gridLines: true,
    hatch: true,
    emptyStyle: App.settings.emptyStyle,
    edgeNumbers: true,
    showCodes: false,
    viewport: { x0, y0, x1: x0 + n - 1, y1: y0 + n - 1 },
  });
  canvas.width = n * cell;
  canvas.height = n * cell;
  const ctx2 = canvas.getContext('2d');
  // 图案之外（含四角）：夜间用 UI 灰色，日间用浅灰
  ctx2.fillStyle = outsideColor;
  ctx2.fillRect(0, 0, canvas.width, canvas.height);
  ctx2.drawImage(offCanvas, 0, 0);
  // 裁剪元素：红实线 / 选中边蓝实线 / 预览红虚线（放大镜内同样显示，不画中心格方框）
  if (App.crop) {
    const cx0 = (App.crop.x0 - x0) * cell;
    const cy0 = (App.crop.y0 - y0) * cell;
    const cx1 = (App.crop.x1 + 1 - x0) * cell;
    const cy1 = (App.crop.y1 + 1 - y0) * cell;
    ctx2.lineWidth = 2;
    const edges = [
      ['left', cx0, cy0, cx0, cy1],
      ['right', cx1, cy0, cx1, cy1],
      ['top', cx0, cy0, cx1, cy0],
      ['bottom', cx0, cy1, cx1, cy1],
    ];
    for (const [name, ex0, ey0, ex1, ey1] of edges) {
      ctx2.strokeStyle = name === App.cropActiveEdge ? CROP_EDGE_ACTIVE_COLOR : CROP_EDGE_COLOR;
      ctx2.beginPath();
      ctx2.moveTo(ex0, ey0);
      ctx2.lineTo(ex1, ey1);
      ctx2.stroke();
    }
    if (App.cropPreview && !dragState.cropEdge) {
      ctx2.strokeStyle = CROP_EDGE_COLOR;
      ctx2.setLineDash([6, 5]);
      const p = (App.cropPreview.pos - (App.cropPreview.horizontal ? x0 : y0)) * cell;
      ctx2.beginPath();
      if (App.cropPreview.horizontal) {
        ctx2.moveTo(p, 0);
        ctx2.lineTo(p, n * cell);
      } else {
        ctx2.moveTo(0, p);
        ctx2.lineTo(n * cell, p);
      }
      ctx2.stroke();
      ctx2.setLineDash([]);
    }
  }
}

function positionCropMagnifier(e) {
  const el = els.cropMagnifier;
  const w = el.offsetWidth || 300;
  const h = el.offsetHeight || 300;
  const pad = CROP_MAGNIFIER_GAP;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  if (left + w > (window.innerWidth || 0) - CROP_MAGNIFIER_WINDOW_MARGIN) left = e.clientX - w - pad;
  if (top + h > (window.innerHeight || 0) - CROP_MAGNIFIER_WINDOW_MARGIN) top = e.clientY - h - pad;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

export function updateCropMagnifier(e) {
  const el = els.cropMagnifier;
  if (App.tool !== TOOLS.CROP || !App.project || !App.hoverCell
    || App.screenCell * App.zoom >= CROP_MAGNIFIER_MIN_SCREEN_CELL) {
    hideCropMagnifier();
    return;
  }
  drawCropMagnifier();
  positionCropMagnifier(e);
  el.classList.remove('hidden');
}

// 缩放/主题变化后重新评估放大镜是否显示并重绘
export function refreshCropMagnifier() {
  if (cropLastMouse) updateCropMagnifier(cropLastMouse);
  else hideCropMagnifier();
}

export function rememberCropMouse(e) {
  cropLastMouse = { clientX: e.clientX, clientY: e.clientY };
}
