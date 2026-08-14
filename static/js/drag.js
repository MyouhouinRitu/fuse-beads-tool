// 画布拖拽交互：右键平移 / 左键选择、涂色、裁剪的鼠标事件与状态机。
// 只依赖视图 / 裁剪 / 快捷选色等下层模块，不反向依赖主入口。

import { axisConstrainedEnd, lineCells, paintStamp, strokeLine } from './brush.js';
import { applyPickerColor } from './color-list.js';
import { DRAG_THRESHOLD_PX, TOOLS, ZOOM_WHEEL_FACTOR } from './constants.js';
import {
  handleCropMouseDown,
  updateCropCursor,
  updateCropEdgeDrag,
  updateCropPreview,
} from './crop.js';
import { rememberCropMouse, updateCropMagnifier } from './crop-magnifier.js';
import { els } from './els.js';
import { renderHistoryUI } from './history-ui.js';
import { interactionState } from './interaction.js';
import { recordGridChanges } from './mutations.js';
import { closeQuickPicker } from './quick-picker.js';
import { scheduleCanvasRender } from './render-queue.js';
import { selectClick, selectRect, selectWand, toggleSelectionCells } from './selection.js';
import { App, dragState, setProjectDirty } from './state.js';
import { blurActive, hideCropMagnifier } from './utils.js';
import {
  applyOriginalTransform,
  applyTransform,
  eventToCell,
  mirrorBeadToOrig,
  zoomAtCore,
  zoomAtOriginal,
} from './view.js';

function cellFromEvent(e) {
  if (!App.project) return null;
  const rect = els.canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  const { x, y } = eventToCell(e);
  // 四周 1 格为行列号条，不属于图案
  if (x < 0 || y < 0 || x >= App.project.width || y >= App.project.height) return null;
  return { x, y };
}

// 涂一个格子；opts.silent 用于批量填充时暂缓逐格重绘/自动保存（调用方统一提交）
// ---------- 鼠标拖拽 ----------

// 统一的拖拽初始状态（右键平移 / 左键选择、涂色、裁剪共用）
// orig：是否拖拽「对比原图」；panning：是否平移视图；downCell：左键按下的格
function beginDrag(e, { orig = false, panning = false, downCell = null } = {}) {
  dragState.active = true;
  dragState.orig = orig;
  dragState.moved = false;
  dragState.panning = panning;
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.panStart = { ...App.pan };
  dragState.origPanStart = orig ? { ...App.origPan } : null;
  dragState.downCell = downCell; // 右键平移时 downCell 为 null，不参与选择/取色
  dragState.selectionAnchor = null;
  dragState.shift = false;
  dragState.ctrl = false;
  dragState.straightStart = null;
  dragState.toggleLast = null;
}

// 一次交互结束后统一复位拖拽状态
function resetDragState() {
  interactionState.dragPreview = null;
  dragState.active = false;
  dragState.cropEdge = null;
  dragState.orig = false;
  dragState.moved = false;
  dragState.panning = false;
  dragState.selectionAnchor = null;
  dragState.downCell = null;
  dragState.shift = false;
  dragState.ctrl = false;
  dragState.straightStart = null;
  dragState.toggleLast = null;
  interactionState.painting = false;
  interactionState.lastCell = null;
  els.canvas.style.cursor = '';
  els.canvasOriginal.style.cursor = '';
}

// hover 边框定位：只在工作区图案上更新，拖拽平移或指向对比原图时隐藏
function updateHoverCell(e) {
  if (!App.project) return;
  if (e.target?.closest?.('#compare-original')) {
    if (interactionState.hoverCell != null) {
      interactionState.hoverCell = null;
      scheduleCanvasRender();
    }
    return;
  }
  if (dragState.active && dragState.moved && dragState.panning) {
    if (interactionState.hoverCell != null) {
      interactionState.hoverCell = null;
      scheduleCanvasRender();
    }
    return;
  }
  const cell = cellFromEvent(e);
  const prev = interactionState.hoverCell;
  const same = prev != null && cell != null && prev.x === cell.x && prev.y === cell.y;
  if (same || (prev == null && cell == null)) return;
  interactionState.hoverCell = cell;
  scheduleCanvasRender();
}

// 拖拽移动：对比原图平移 / 工作区平移 / 选择矩形预览 / 画笔橡皮连续涂色
function updateDragMove(e) {
  if (dragState.orig) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragState.moved = true;
    if (dragState.moved) {
      if (App.settings.syncPan) {
        App.pan = { x: dragState.panStart.x + dx, y: dragState.panStart.y + dy };
        App.origPan = { x: dragState.origPanStart.x + dx, y: dragState.origPanStart.y + dy };
      } else {
        App.origPan = { x: dragState.origPanStart.x + dx, y: dragState.origPanStart.y + dy };
      }
      setProjectDirty(true);
      applyOriginalTransform();
      if (App.settings.syncPan) applyTransform();
      els.canvasOriginal.style.cursor = 'grabbing';
    }
    return;
  }
  if (!dragState.active || !App.project) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragState.moved = true;
  if (dragState.moved && dragState.panning) {
    App.pan = { x: dragState.panStart.x + dx, y: dragState.panStart.y + dy };
    setProjectDirty(true);
    if (App.settings.syncPan && App.originalImage) {
      mirrorBeadToOrig();
      applyOriginalTransform();
    }
    els.canvas.style.cursor = 'grabbing';
    applyTransform();
    return;
  }
  if (dragState.cropEdge) {
    // 裁剪模式：拖拽移动选中的边
    updateCropEdgeDrag(e);
    return;
  }
  if (App.tool === TOOLS.SELECT && dragState.ctrl && dragState.moved && dragState.selectionAnchor) {
    // Ctrl 拖拽：反选鼠标经过的格子
    const cell = cellFromEvent(e);
    if (!cell) return;
    const from = dragState.toggleLast || dragState.selectionAnchor;
    const cells = lineCells(from, cell);
    if (dragState.toggleLast) cells.shift(); // 上一段终点已反选过，避免重复反选
    toggleSelectionCells(cells.map((c) => c.y * App.project.width + c.x));
    dragState.toggleLast = cell;
    scheduleCanvasRender();
    return;
  }
  if (
    App.tool === TOOLS.SELECT &&
    dragState.moved &&
    dragState.selectionAnchor &&
    !dragState.ctrl &&
    !App.settings.sameColorSelect
  ) {
    // 矩形拖选实时预览（裁剪到图案边界）
    const cell = cellFromEvent(e);
    if (!cell) return;
    const a = dragState.selectionAnchor;
    interactionState.dragPreview = {
      x0: Math.min(a.x, cell.x),
      y0: Math.min(a.y, cell.y),
      x1: Math.max(a.x, cell.x),
      y1: Math.max(a.y, cell.y),
    };
    scheduleCanvasRender();
    return;
  }
  if (!interactionState.painting) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (dragState.straightStart && e.shiftKey) {
    strokeLine(dragState.straightStart, axisConstrainedEnd(dragState.straightStart, cell));
  } else if (interactionState.lastCell) {
    strokeLine(interactionState.lastCell, cell);
  }
  interactionState.lastCell = cell;
}

// 统一的 mousemove 入口：先更新 hover，再处理拖拽与裁剪联动
export function onWindowMouseMove(e) {
  if (App.tool === TOOLS.CROP) rememberCropMouse(e);
  updateHoverCell(e);
  updateDragMove(e);
  updateCropCursor(e);
  updateCropPreview(e);
  updateCropMagnifier(e);
}

export function onWindowMouseUp() {
  if (dragState.active && !dragState.moved) {
    if (App.tool === TOOLS.SELECT && dragState.downCell) {
      // 选择模式：单击选中（同色选区勾选时选连通块）
      selectClick(dragState.downCell, dragState.shift, dragState.ctrl);
    } else if (App.tool === TOOLS.WAND && dragState.downCell) {
      selectWand(dragState.downCell, dragState.shift);
    } else if (App.tool === TOOLS.PICKER && dragState.downCell) {
      applyPickerColor(dragState.downCell);
    }
  } else if (
    dragState.active &&
    dragState.moved &&
    App.tool === TOOLS.SELECT &&
    dragState.selectionAnchor &&
    interactionState.dragPreview &&
    !dragState.ctrl &&
    !App.settings.sameColorSelect
  ) {
    // 选择模式：左键拖拽 = 矩形选区（Shift 追加并集）
    selectRect(interactionState.dragPreview, dragState.shift);
  }
  if (interactionState.strokeBuffer) {
    if (interactionState.strokeBuffer.length) {
      recordGridChanges(interactionState.strokeBuffer);
      renderHistoryUI();
    }
    interactionState.strokeBuffer = null;
  }
  if (dragState.cropEdge && dragState.moved) {
    // 拖拽结束：默认取消选中该边（单击移动到格线则保持选中）
    interactionState.cropActiveEdge = null;
    interactionState.cropPreview = null;
    scheduleCanvasRender();
  }
  resetDragState();
}

export function onCanvasScrollMouseDown(e) {
  if (!App.project) return;
  const inOrig = e.target?.closest?.('#compare-original');
  if (e.button === 2) {
    // 右键：工作区内任意位置拖拽平移（对比原图由自己的右键处理）
    e.preventDefault();
    if (inOrig) return;
    blurActive();
    if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
    beginDrag(e, { panning: true });
    els.canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0 || inOrig) return;
  blurActive();
  const cell = cellFromEvent(e);
  e.preventDefault();
  if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
  beginDrag(e, { downCell: cell });
  if (App.tool === TOOLS.CROP) {
    // 裁剪模式：选中/拖拽边，或按平行格线移动已选中的边
    handleCropMouseDown(e);
    return;
  }
  if (App.tool === TOOLS.SELECT || App.tool === TOOLS.WAND) {
    // 选择模式：左键单击/拖拽选矩形（同色选区勾选时仅单击）；魔棒：单击后按容差选相似色
    if (cell) {
      dragState.selectionAnchor = cell;
      dragState.shift = !!e.shiftKey;
      dragState.ctrl = !!(e.ctrlKey || e.metaKey);
      if (
        App.tool === TOOLS.SELECT &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !App.settings.sameColorSelect &&
        (App.selection.size || interactionState.dragPreview)
      ) {
        // 非 Shift 新选区开始时立即清空旧选区（Shift 追加并集则保留；同色选区拖拽无效不清空）
        App.selection = new Set();
        interactionState.dragPreview = null;
        scheduleCanvasRender();
      }
    }
    return;
  }
  if (App.tool === TOOLS.BRUSH || App.tool === TOOLS.ERASER) {
    // 画笔/橡皮：从图案格开始连续涂色
    if (cell) {
      interactionState.painting = true;
      interactionState.lastCell = cell;
      dragState.straightStart = cell;
      // 一次按下到放开的全部像素修改记为一 step
      interactionState.strokeBuffer = [];
      paintStamp(cell);
    }
    return;
  }
  // 取色模式：单击在 mouseup 时取色
}

export function onCompareMouseDown(e) {
  if (!App.project || !App.originalImage || !App.settings.compare) return;
  if (e.button !== 2) return; // 对比原图同样改为右键拖拽
  e.preventDefault();
  blurActive();
  beginDrag(e, { orig: true });
  els.canvasOriginal.style.cursor = 'grabbing';
}

export function onCanvasScrollMouseLeave() {
  if (interactionState.hoverCell != null) {
    interactionState.hoverCell = null;
    scheduleCanvasRender();
  }
  hideCropMagnifier();
}

export function onCanvasWheel(e) {
  if (!App.project) return;
  if (e.target?.closest?.('#compare-original')) return;
  if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
  e.preventDefault();
  zoomAtCore(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR);
  setProjectDirty(true);
}

export function onCompareWheel(e) {
  if (!App.project || !App.originalImage || !App.settings.compare) return;
  e.preventDefault();
  e.stopPropagation();
  zoomAtOriginal(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR);
  setProjectDirty(true);
}
