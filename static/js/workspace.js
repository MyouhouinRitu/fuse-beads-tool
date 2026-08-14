// 画布工作区交互：画笔/橡皮/取色、选区体系、鼠标拖拽、同步拖拽、九宫格联动。
// 只依赖视图/裁剪/快捷选色等下层模块，不反向依赖主入口。

import {
  DRAG_THRESHOLD_PX,
  TOOLS,
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
  ZOOM_WHEEL_FACTOR,
} from './constants.js';
import * as C from './colors.js';
import { els } from './els.js';
import { recordStep } from './history.js';
import { renderHistoryUI } from './history-ui.js';
import { findConnectedComponents } from './render.js';
import { App, dragState, setDirty, setProjectDirty } from './state.js';
import { blurActive, clampInt, codeOf, countBadge, hideCropMagnifier, rectCells, titleOf, toast } from './utils.js';
import { scheduleAutosave } from './autosave.js';
import { scheduleCanvasRender, scheduleRender } from './render-queue.js';
import { setTool } from './tool-state.js';
import {
  applyOriginalTransform,
  applyTransform,
  eventToCell,
  mirrorBeadToOrig,
  zoomAtCore,
  zoomAtOriginal,
} from './view.js';
import {
  handleCropMouseDown,
  rememberCropMouse,
  updateCropCursor,
  updateCropEdgeDrag,
  updateCropMagnifier,
  updateCropPreview,
} from './crop.js';
import { closeQuickPicker } from './quick-picker.js';

// ---------- 画笔 ----------

export function updateBrush() {
  if (App.brushColor != null && App.brushColor >= App.appliedPalette.length) {
    App.brushColor = Math.max(0, App.appliedPalette.length - 1);
  }
  if (App.brushColor == null || !App.appliedPalette.length) {
    els.brushSwatch.style.background = '#ffffff';
    els.brushSwatch.style.border = '2px dashed #b9bec7';
    els.brushLabel.textContent = '未选择颜色（点击左侧颜色进入画笔模式）';
    return;
  }
  const c = App.appliedPalette[App.brushColor];
  if (!c) {
    els.brushSwatch.style.background = '#cccccc';
    els.brushSwatch.style.border = '';
    els.brushLabel.textContent = '未选择颜色';
    return;
  }
  els.brushSwatch.style.background = c.hex;
  els.brushSwatch.style.border = '';
  els.brushLabel.textContent = titleOf(c);
}

// 已应用调色板中最暗的颜色索引（按感知亮度），画笔未选色时用作默认颜色
function darkestPaletteIndex() {
  if (!App.appliedPalette.length) return null;
  let best = 0;
  let bestLum = Infinity;
  App.appliedPalette.forEach((c, i) => {
    if (!c || !c.hex) return;
    const [r, g, b] = C.hexToRgb(c.hex);
    const lum = C.luminance([r, g, b]);
    if (lum < bestLum) {
      bestLum = lum;
      best = i;
    }
  });
  return best;
}

// 画笔未选色时取调色板最暗色；调色板为空时提示并返回 false
export function ensureBrushColor() {
  if (App.brushColor != null) return true;
  const dark = darkestPaletteIndex();
  if (dark == null) {
    toast('调色板为空，请先导入颜色配置');
    return false;
  }
  App.brushColor = dark;
  updateBrush();
  renderColorList();
  return true;
}

// 快捷键/按钮共用：切换到指定工具（画笔未选色时先取最暗色）
export function switchToolShortcut(tool) {
  if (tool === TOOLS.BRUSH && !ensureBrushColor()) return;
  setTool(tool);
}

// 右侧「全部颜色」列表（可点击选择画笔颜色；选择模式有选区时点击为整块填充）
// 事件委托：容器上只绑定一个 click，避免整表重建时反复创建监听器
export function bindColorList() {
  els.colorList.addEventListener('click', (e) => {
    const item = e.target.closest('.color-item');
    if (!item) return;
    const i = Number(item.dataset.index);
    if (!Number.isInteger(i)) return;
    App.brushColor = i;
    updateBrush();
    if ((App.tool === TOOLS.SELECT || App.tool === TOOLS.WAND) && App.selection.size > 0) {
      // 选择 / 魔棒模式且有选区：将选区填充为该颜色，保持当前模式，整块记一步撤销
      fillSelectionWithBrush();
    } else {
      // 无选区：切换为画笔模式
      setTool(TOOLS.BRUSH);
    }
    renderColorList();
  });
}

export function renderColorList(counts) {
  if (!counts && App.project) {
    counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  }
  const list = els.colorList;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  App.appliedPalette.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'color-item' + (App.brushColor === i ? ' selected' : '');
    item.dataset.index = String(i);
    item.title = titleOf(c);
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    const codeLabel = document.createElement('span');
    codeLabel.className = 'ci-code';
    codeLabel.textContent = codeOf(c);
    const rgb = C.hexToRgb(c.hex);
    codeLabel.style.color = C.isLightColor(rgb) ? '#111111' : '#FFFFFF';
    sw.appendChild(codeLabel);
    const count = document.createElement('span');
    count.className = 'ci-count';
    count.textContent = counts && counts[i] ? countBadge(counts[i]) : '';
    item.append(sw, count);
    frag.appendChild(item);
  });
  list.appendChild(frag);
  updateBrush();
}

// ---------- 画布编辑 ----------

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
export function paintCell(x, y, { silent = false } = {}) {
  const { grid, width } = App.project;
  const p = y * width + x;
  const v = App.tool === TOOLS.ERASER ? -1 : (App.brushColor != null ? App.brushColor : -2);
  if (v === -2) return; // 未选择颜色
  if (grid[p] === v) return null;
  const from = grid[p];
  grid[p] = v;
  setDirty(true);
  App.editedSinceSlider = true;
  if (App.strokeBuffer) App.strokeBuffer.push({ x, y, from, to: v });
  if (!silent) {
    scheduleRender();
    scheduleAutosave();
  }
  return { x, y, from, to: v };
}

// 按画笔/橡皮尺寸涂一个矩形（边长 = 2×brushSize−1，以目标格为中心，裁剪到图案边界）
export function paintStamp(cell) {
  if (!cell) return;
  const r = App.settings.brushSize - 1;
  const { width, height } = App.project;
  const x0 = Math.max(0, cell.x - r);
  const y0 = Math.max(0, cell.y - r);
  const x1 = Math.min(width - 1, cell.x + r);
  const y1 = Math.min(height - 1, cell.y + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      paintCell(x, y);
    }
  }
}

// ---------- 区域选择 ----------

export function clearSelection() {
  if (!App.selection.size && !App.dragPreview) return;
  App.selection = new Set();
  App.dragPreview = null;
  scheduleCanvasRender();
}

// 同色连通块：返回包含 (x,y) 的四方向同色像素组（复用 render.js 的连通分组）；空位视为只有自身一格
function connectedColorCells(x, y) {
  const { grid, width, height } = App.project;
  const p0 = y * width + x;
  const v = grid[p0];
  if (v < 0) return new Set([p0]);
  const components = findConnectedComponents(width, height, (p) => grid[p] === v);
  for (const comp of components) {
    if (comp.includes(p0)) return new Set(comp);
  }
  return new Set([p0]);
}

// 魔棒：以 (x,y) 的颜色为种子，按容差阈值选取四方向连通的相似色；
// 空位与同色选区一致，只选自身一格。
const WAND_DIST2_AT_MAX = 10000; // 容差 100 对应的 Lab 距离平方上限

function wandDistanceThreshold() {
  const s = clampInt(
    App.settings.wandSensitivity,
    WAND_SENSITIVITY_MIN,
    WAND_SENSITIVITY_MAX,
    WAND_SENSITIVITY_DEFAULT,
  );
  const ratio = (s / WAND_SENSITIVITY_MAX) ** 2;
  return WAND_DIST2_AT_MAX * ratio;
}

function similarColorCells(x, y) {
  const { grid, width, height } = App.project;
  const p0 = y * width + x;
  const seed = grid[p0];
  if (seed < 0) return new Set([p0]);
  const seedColor = App.appliedPalette[seed];
  if (!seedColor) return new Set([p0]);

  const seedRgb = C.hexToRgb(seedColor.hex);
  const dist = App.appliedPalette.map((c) => (
    c ? C.colorDist2(seedRgb, C.hexToRgb(c.hex), App.settings.useLab) : Infinity
  ));
  const threshold = wandDistanceThreshold();
  const visited = new Uint8Array(grid.length);
  const cells = new Set([p0]);
  const stack = [p0];
  visited[p0] = 1;

  while (stack.length) {
    const p = stack.pop();
    const px = p % width;
    const neighbors = [];
    if (px > 0) neighbors.push(p - 1);
    if (px < width - 1) neighbors.push(p + 1);
    if (p >= width) neighbors.push(p - width);
    if (p < grid.length - width) neighbors.push(p + width);
    for (const q of neighbors) {
      if (visited[q]) continue;
      visited[q] = 1;
      const v = grid[q];
      if (v >= 0 && dist[v] <= threshold) {
        cells.add(q);
        stack.push(q);
      }
    }
  }
  return cells;
}

function addToSelection(cells) {
  const next = new Set(App.selection);
  for (const p of cells) next.add(p);
  App.selection = next;
}

function replaceSelection(cells) {
  App.selection = new Set(cells);
}

// 单击选择：同色选区勾选时选连通块，否则选单格；Shift 追加并集，非 Shift 替换；Ctrl 反选当前格
function selectClick(cell, shift, ctrl = false) {
  const p = cell.y * App.project.width + cell.x;
  if (ctrl) {
    const next = new Set(App.selection);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    App.selection = next;
    scheduleCanvasRender();
    return;
  }
  let cells;
  if (App.settings.sameColorSelect) {
    cells = connectedColorCells(cell.x, cell.y);
  } else {
    cells = new Set([p]);
  }
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  scheduleCanvasRender();
}

function toggleSelectionCells(cells) {
  const next = new Set(App.selection);
  for (const p of cells) {
    if (next.has(p)) next.delete(p);
    else next.add(p);
  }
  App.selection = next;
}

// 魔棒单击：按当前容差选择四向连通的相似色；Shift 追加并集，非 Shift 替换
function selectWand(cell, shift) {
  const cells = similarColorCells(cell.x, cell.y);
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  App.dragPreview = null;
  scheduleCanvasRender();
}

function selectRect(rect, shift) {
  const cells = rectCells(rect);
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  scheduleCanvasRender();
}

// 用当前画笔颜色填充整个选区，整块记一步撤销（不改变选择与模式）
function fillSelectionWithBrush() {
  if (!App.project || !App.selection.size) return;
  App.strokeBuffer = [];
  const { width } = App.project;
  for (const p of App.selection) {
    const x = p % width;
    const y = (p / width) | 0;
    paintCell(x, y, { silent: true });
  }
  if (App.strokeBuffer.length) recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
  App.strokeBuffer = null;
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
}

// Delete 键：把选中格清为空位，整块记一步撤销（不改变选择与模式）
export function clearSelectionToEmpty() {
  if (!App.project || !App.selection.size) return;
  const { grid, width } = App.project;
  const changes = [];
  for (const p of App.selection) {
    if (grid[p] < 0) continue; // 已是空位
    changes.push({ x: p % width, y: (p / width) | 0, from: grid[p], to: -1 });
    grid[p] = -1;
  }
  if (!changes.length) return;
  recordStep(App.undoStack, App.redoStack, changes);
  setDirty(true);
  App.editedSinceSlider = true;
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
  toast(`已清除 ${changes.length} 格为空位`);
}

// 取色工具：把目标格的颜色设为画笔色；有选区时立即填充选区，否则切回画笔模式
function applyPickerColor(cell) {
  const v = App.project.grid[cell.y * App.project.width + cell.x];
  if (v < 0) {
    toast('该位置是空位，无法取色');
    return;
  }
  App.brushColor = v;
  updateBrush();
  renderColorList();
  if (App.selection.size > 0) {
    // 有选区：取色后立即把选区填充为该颜色，再回选择模式（选区保留）
    fillSelectionWithBrush();
    setTool(TOOLS.SELECT);
  } else {
    // 无选区：取色后切换为画笔模式
    setTool(TOOLS.BRUSH);
  }
}

function lineCells(a, b) {
  const cells = [];
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return cells;
}

function strokeLine(a, b) {
  for (const c of lineCells(a, b)) paintStamp(c);
}

function axisConstrainedEnd(start, current) {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  if (dx >= dy) return { x: current.x, y: start.y };
  return { x: start.x, y: current.y };
}

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
  App.dragPreview = null;
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
  App.painting = false;
  App.lastCell = null;
  els.canvas.style.cursor = '';
  els.canvasOriginal.style.cursor = '';
}

// hover 边框定位：只在工作区图案上更新，拖拽平移或指向对比原图时隐藏
function updateHoverCell(e) {
  if (!App.project) return;
  if (e.target && e.target.closest && e.target.closest('#compare-original')) {
    if (App.hoverCell != null) {
      App.hoverCell = null;
      scheduleCanvasRender();
    }
    return;
  }
  if (dragState.active && dragState.moved && dragState.panning) {
    if (App.hoverCell != null) {
      App.hoverCell = null;
      scheduleCanvasRender();
    }
    return;
  }
  const cell = cellFromEvent(e);
  const prev = App.hoverCell;
  const same = prev != null && cell != null && prev.x === cell.x && prev.y === cell.y;
  if (same || (prev == null && cell == null)) return;
  App.hoverCell = cell;
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
    toggleSelectionCells(lineCells(from, cell).map((c) => c.y * App.project.width + c.x));
    dragState.toggleLast = cell;
    scheduleCanvasRender();
    return;
  }
  if (App.tool === TOOLS.SELECT && dragState.moved && dragState.selectionAnchor
    && !dragState.ctrl && !App.settings.sameColorSelect) {
    // 矩形拖选实时预览（裁剪到图案边界）
    const cell = cellFromEvent(e);
    if (!cell) return;
    const a = dragState.selectionAnchor;
    App.dragPreview = {
      x0: Math.min(a.x, cell.x), y0: Math.min(a.y, cell.y),
      x1: Math.max(a.x, cell.x), y1: Math.max(a.y, cell.y),
    };
    scheduleCanvasRender();
    return;
  }
  if (!App.painting) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (dragState.straightStart && e.shiftKey) {
    strokeLine(dragState.straightStart, axisConstrainedEnd(dragState.straightStart, cell));
  } else if (App.lastCell) {
    strokeLine(App.lastCell, cell);
  }
  App.lastCell = cell;
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
  } else if (dragState.active && dragState.moved && App.tool === TOOLS.SELECT
    && dragState.selectionAnchor && App.dragPreview && !dragState.ctrl && !App.settings.sameColorSelect) {
    // 选择模式：左键拖拽 = 矩形选区（Shift 追加并集）
    selectRect(App.dragPreview, dragState.shift);
  }
  if (App.strokeBuffer) {
    if (App.strokeBuffer.length) recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
    App.strokeBuffer = null;
    renderHistoryUI();
  }
  if (dragState.cropEdge && dragState.moved) {
    // 拖拽结束：默认取消选中该边（单击移动到格线则保持选中）
    App.cropActiveEdge = null;
    App.cropPreview = null;
    scheduleCanvasRender();
  }
  resetDragState();
}

export function onCanvasScrollMouseDown(e) {
  if (!App.project) return;
  const inOrig = e.target && e.target.closest && e.target.closest('#compare-original');
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
      if (dragState.ctrl) dragState.toggleLast = cell;
      if (App.tool === TOOLS.SELECT && !e.shiftKey && !e.ctrlKey && !e.metaKey
        && !App.settings.sameColorSelect
        && (App.selection.size || App.dragPreview)) {
        // 非 Shift 新选区开始时立即清空旧选区（Shift 追加并集则保留；同色选区拖拽无效不清空）
        App.selection = new Set();
        App.dragPreview = null;
        scheduleCanvasRender();
      }
    }
    return;
  }
  if (App.tool === TOOLS.BRUSH || App.tool === TOOLS.ERASER) {
    // 画笔/橡皮：从图案格开始连续涂色
    if (cell) {
      App.painting = true;
      App.lastCell = cell;
      dragState.straightStart = cell;
      // 一次按下到放开的全部像素修改记为一 step
      App.strokeBuffer = [];
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
  if (App.hoverCell != null) {
    App.hoverCell = null;
    scheduleCanvasRender();
  }
  hideCropMagnifier();
}

export function onCanvasWheel(e) {
  if (!App.project) return;
  if (e.target && e.target.closest && e.target.closest('#compare-original')) return;
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
