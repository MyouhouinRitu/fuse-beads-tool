// 工作区画布管线：显示数据构建、底图/overlay 渲染、缩放联动、合并与滑块应用。

import * as C from './colors.js';
import {
  CELL,
  GRID_FINE_MIN_SCREEN_CELL,
  GRID_THICK_MIN_SCREEN_CELL,
  HIGHLIGHT_BLINK_MS,
  SCREEN_CELL_MAX_AREA,
  SCREEN_CELL_MAX_DIM,
  SCREEN_CELL_MIN,
  TOOLS,
} from './constants.js';
import { els } from './els.js';
import { interactionState } from './interaction.js';
import * as mirror from './mirror.js';
import { gridRevision } from './mutations.js';
import { closeQuickPicker } from './quick-picker.js';
import {
  canvasMetrics,
  clearCanvas,
  drawCodes,
  drawGridLines,
  drawPatternBase,
  drawPatternCells,
  drawPatternOverlay,
} from './render.js';
import { scheduleCanvasRender } from './render-queue.js';
import { App, dragState, setDirty } from './state.js';
import { codeOf, rectCells } from './utils.js';
import { applyTransform } from './view.js';

const ctx = els.canvas.getContext('2d');

// 工作区底图离屏缓存：单元格/行列号/网格线等静态内容只在内容变化时重绘，
// hover/选区/高亮等覆盖层单独叠加，避免移动鼠标时反复重建底图
const baseCanvas = document.createElement('canvas');
const baseCtx = baseCanvas.getContext('2d');

let lastDisplay = null; // 底图对应的显示数据，覆盖层复用避免每帧重建
let baseDetailKey = null; // 底图细节层级（细线/色号、粗线是否隐藏），跨阈值时重建底图
let screenCellCache = { key: null, value: null };
let renderSelectionCache = { sel: null, drag: null, value: null };
let displayCache = { grid: null, paletteKey: null, revision: -1, value: null };

export function clearWorkspace() {
  clearCanvas(ctx);
}

export function chooseScreenCell(width, height) {
  const key = `${width}x${height}`;
  if (screenCellCache.key === key) return screenCellCache.value;
  let cell = CELL;
  const ok = (c) => {
    // 工作区含四周 1 格行列号条，且无外部白边
    const { w, h } = canvasMetrics(width, height, c, 0, 0, c);
    return w <= SCREEN_CELL_MAX_DIM && h <= SCREEN_CELL_MAX_DIM && w * h <= SCREEN_CELL_MAX_AREA;
  };
  while (cell > SCREEN_CELL_MIN && !ok(cell)) {
    cell = Math.max(SCREEN_CELL_MIN, Math.floor(cell / 2));
  }
  screenCellCache = { key, value: cell };
  return cell;
}

export function buildDisplayData() {
  const { grid, width, height } = App.project;
  const n = width * height;
  const idx = new Int16Array(n);
  const rgb = new Uint32Array(n);
  // 调色板 RGB 预计算：避免每个格子都重新解析 hex 字符串
  const paletteRgb = App.appliedPalette.map((c) => (c ? C.hexToRgb(c.hex) : null));
  for (let p = 0; p < n; p++) {
    const v = grid[p];
    if (v < 0) {
      idx[p] = -1;
      continue;
    }
    idx[p] = v;
    const c = paletteRgb[v] || [255, 255, 255];
    rgb[p] = C.packRgb(c);
  }
  return { idx, rgb };
}

// 显示数据缓存：网格引用 + 修订号 + 调色板引用都未变时复用，
// 避免裁剪放大镜逐帧 mousemove / 设置变化重建底图时反复全量扫描
export function getDisplayData() {
  const { grid } = App.project;
  const palette = App.appliedPalette;
  const paletteKey = palette.map((c) => (c ? c.hex : '')).join(',');
  if (
    displayCache.grid === grid &&
    displayCache.paletteKey === paletteKey &&
    displayCache.revision === gridRevision
  ) {
    return displayCache.value;
  }
  const value = buildDisplayData();
  displayCache = { grid, paletteKey, revision: gridRevision, value };
  return value;
}

export function buildLegend(counts) {
  const legend = [];
  App.appliedPalette.forEach((c, i) => {
    if (counts[i]) {
      legend.push({ hex: c.hex, code: codeOf(c), count: counts[i] });
    }
  });
  return sortLegend(legend);
}

// 图例 / 导出共用排序：按豆数从多到少，数量相同按色号
export function sortLegend(entries) {
  return entries
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export function buildCodes() {
  const { grid } = App.project;
  const codes = new Array(App.project.width * App.project.height).fill('');
  for (let p = 0; p < grid.length; p++) {
    const v = grid[p];
    if (v >= 0) codes[p] = codeOf(App.appliedPalette[v]);
  }
  return codes;
}

// 渲染底图到离屏画布（单元格/行列号/网格线/色号），内容变化时才调用
function renderBaseLayer() {
  const project = App.project;
  if (!project) return;
  const display = buildDisplayData();
  lastDisplay = display;
  App.screenCell = chooseScreenCell(project.width, project.height);
  drawPatternBase(baseCtx, project.width, project.height, display.idx, display.rgb, {
    cell: App.screenCell,
    outerPad: 0, // 工作区不再保留纯白边距，图例只在导出时显示
    gridLines: true,
    hatch: true,
    emptyStyle: App.settings.emptyStyle,
    edgeNumbers: true, // 工作区始终显示四周行列号条
    showCodes: App.settings.showCodes,
    codes: buildCodes(),
    zoom: App.zoom,
  });
  baseDetailKey = baseDetailFlags();
}

// 底图细节层级：细线/色号（阈值 8）与粗虚线/实线（阈值 4）是否隐藏
function baseDetailFlags() {
  const s = App.screenCell * App.zoom;
  return (s < GRID_FINE_MIN_SCREEN_CELL ? 1 : 0) | (s < GRID_THICK_MIN_SCREEN_CELL ? 2 : 0);
}

// 缩放跨越细节阈值时重建底图（细线/色号、粗虚线/实线随缩放隐藏）
export function syncBaseLayerDetail() {
  const key = baseDetailFlags();
  if (baseDetailKey !== null && baseDetailKey !== key) {
    renderBaseLayer();
    renderCanvas();
  }
  baseDetailKey = key;
}

// 笔划中的增量重绘：只更新脏格对应的显示数据与底图局部，再调度一次 overlay 合成。
// 笔划结束时由 recordGridChanges 触发全量刷新，保证计数 / 颜色清单 / 撤销 UI 同步。
export function repaintBaseCells(changes) {
  const project = App.project;
  if (!project || !changes?.length || !lastDisplay) return;
  const { width, height } = project;
  const n = width * height;
  const display = lastDisplay;
  const paletteRgb = App.appliedPalette.map((c) => (c ? C.hexToRgb(c.hex) : null));
  const cells = new Set();
  for (const ch of changes) {
    if (!ch || !Number.isInteger(ch.x) || !Number.isInteger(ch.y)) continue;
    const p = ch.y * width + ch.x;
    if (p < 0 || p >= n) continue;
    const v = ch.to;
    display.idx[p] = v;
    display.rgb[p] = v < 0 ? 0 : C.packRgb(paletteRgb[v] || [255, 255, 255]);
    cells.add(p);
  }
  if (!cells.size) return;
  const cell = App.screenCell;
  const metrics = canvasMetrics(width, height, cell, 0, 0, cell);
  drawPatternCells(
    baseCtx,
    width,
    height,
    display.idx,
    display.rgb,
    metrics.originX,
    metrics.originY,
    cell,
    {
      hatch: true,
      emptyStyle: App.settings.emptyStyle,
    },
    cells,
  );
  // 网格线跨整幅底图，逐格重绘会盖掉线，这里统一重画一次（O(宽+高)，成本可忽略）
  drawGridLines(baseCtx, metrics.originX, metrics.originY, width, height, cell, 1, App.zoom, null);
  if (App.settings.showCodes) {
    const codes = [];
    for (const p of cells) {
      const v = display.idx[p];
      if (v >= 0) codes[p] = codeOf(App.appliedPalette[v]);
    }
    drawCodes(
      baseCtx,
      width,
      height,
      display.idx,
      display.rgb,
      codes,
      metrics.originX,
      metrics.originY,
      cell,
      App.zoom,
      null,
      cells,
    );
  }
  scheduleCanvasRender();
}

// 选区 + 拖选预览的合并集合（带缓存：引用不变时复用上次结果）
function buildRenderSelection() {
  if (
    renderSelectionCache.sel === App.selection &&
    renderSelectionCache.drag === interactionState.dragPreview &&
    renderSelectionCache.size === App.selection.size
  ) {
    return renderSelectionCache.value;
  }
  const value = new Set(App.selection);
  if (interactionState.dragPreview) {
    for (const p of rectCells(interactionState.dragPreview)) value.add(p);
  }
  renderSelectionCache = {
    sel: App.selection,
    drag: interactionState.dragPreview,
    size: App.selection.size,
    value,
  };
  return value;
}

// 把底图 + 覆盖层（选区/高亮/hover/九宫格目标格）合成到主画布
function drawPickerPreview(ctx, originX, originY, cell) {
  // 九宫格悬停预览只临时改 grid，不重建底图显示数据；
  // 这里在覆盖层之下直接补画候选色，避免整幅底图重建，移出/取消时恢复绘制底图原色
  const pc = interactionState.pickerCell;
  const k = interactionState.pickerPreviewIndex;
  const cand = k == null ? null : interactionState.pickerCandidates?.[k];
  if (!pc || !cand) return;
  const c = App.appliedPalette[cand.i];
  if (!c) return;
  ctx.fillStyle = c.hex;
  ctx.fillRect(originX + pc.x * cell, originY + pc.y * cell, cell, cell);
}

export function renderCanvas() {
  const project = App.project;
  if (!project) return;
  if (!lastDisplay) renderBaseLayer();
  const display = lastDisplay;
  const selected = buildRenderSelection();
  const metrics = canvasMetrics(
    project.width,
    project.height,
    App.screenCell,
    0,
    0,
    App.screenCell,
  );
  // 尺寸未变时不重设画布，直接覆盖绘制（底图覆盖整块画布）
  if (ctx.canvas.width !== metrics.w) ctx.canvas.width = metrics.w;
  if (ctx.canvas.height !== metrics.h) ctx.canvas.height = metrics.h;
  ctx.clearRect(0, 0, metrics.w, metrics.h); // 清掉上一帧残留（如裁剪蒙版留在四角的像素）
  ctx.drawImage(baseCanvas, 0, 0);
  drawPickerPreview(ctx, metrics.originX, metrics.originY, App.screenCell);
  drawPatternOverlay(ctx, project.width, project.height, display.idx, display.rgb, {
    cell: App.screenCell,
    outerPad: 0,
    edgeNumbers: true,
    zoom: App.zoom,
    selected,
    highlightColor: interactionState.highlightColor,
    highlightBlink: interactionState.highlightBlink,
    crop: interactionState.crop,
    cropActiveEdge: interactionState.cropActiveEdge,
    cropPreview: dragState.cropEdge ? null : interactionState.cropPreview,
    toolState: {
      hover: App.tool === TOOLS.CROP ? null : interactionState.hoverCell,
      tool: App.tool,
      brushSize: App.settings.brushSize,
      pickerCell: interactionState.pickerCell
        ? { x: interactionState.pickerCell.x, y: interactionState.pickerCell.y }
        : null,
      brushRgb:
        App.brushColor != null && App.appliedPalette[App.brushColor]
          ? C.hexToRgb(App.appliedPalette[App.brushColor].hex)
          : null,
    },
  });
  applyTransform();
}

export function rebuildCanvas() {
  const project = App.project;
  if (!project) return;
  renderBaseLayer();
  renderCanvas();
}

// 颜色清单高亮闪烁：高亮时按周期隐现，反色不明显也能看清选中色号
export function syncHighlightBlink() {
  const active = interactionState.highlightColor != null && App.project;
  if (!active) {
    clearInterval(App.highlightTimer);
    App.highlightTimer = null;
    interactionState.highlightBlink = true;
    return;
  }
  // 定时器已在运行时直接复用，避免鼠标移动触发的重绘反复重置闪烁相位
  if (App.highlightTimer) return;
  App.highlightTimer = setInterval(() => {
    interactionState.highlightBlink = !interactionState.highlightBlink;
    renderCanvas();
  }, HIGHLIGHT_BLINK_MS);
}

// 从基副本按颜色数量 N 生成工作副本（合并成保留色）
export function mergeGrid(source, palette, useLab, n) {
  const counts = C.computeUsedCounts(source, App.project.width, App.project.height);
  const merge = C.buildMergeMap(counts, palette, useLab, n);
  const out = new Int16Array(source.length);
  for (let p = 0; p < source.length; p++) {
    const v = source[p];
    out[p] = v < 0 ? -1 : (merge.rep.get(v) ?? v);
  }
  return out;
}

// 清空与网格坐标相关的编辑状态（保留撤销栈；结构性撤销/重做时使用）
export function clearProjectEditingState() {
  App.selection = new Set();
  interactionState.dragPreview = null;
  interactionState.highlightColor = null;
  interactionState.strokeBuffer = null;
  closeQuickPicker();
}

// 项目内容重建后统一重置编辑状态：选区/拖选预览/色号高亮/九宫格与单步记录，并视为无未保存修改
export function resetProjectEditingState() {
  clearProjectEditingState();
  mirror.resetMirror(); // 项目整体重建后丢弃未应用的镜像预览
  App.undoStack = [];
  App.redoStack = [];
  setDirty(false);
}
