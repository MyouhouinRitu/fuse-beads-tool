// 视图层：画布/原图的位移缩放变换、同步拖拽的坐标换算、适应窗口缩放。
// 不依赖画布渲染管线，缩放结束后的联动（重绘、放大镜、镜像）由 main.js 注册钩子。

import { CANVAS_EDGE_CELLS, CELL, FIT_ZOOM_CAP, ZOOM_MAX, ZOOM_MIN } from './constants.js';
import { els } from './els.js';
import { App } from './state.js';
import { fitToViewport, zoomAroundPoint } from './utils.js';

let afterZoomHook = null;

// 缩放结束后的联动钩子（由 main.js 注册：重绘 overlay、裁剪放大镜、对比镜像）
export function setAfterZoomHook(fn) {
  afterZoomHook = fn;
}

function runAfterZoom() {
  if (afterZoomHook) afterZoomHook();
}

// 「对比原图」当前是否真正生效：偏好开启且项目与原图都就绪
export function compareActive() {
  return !!(App.settings.compare && App.project && App.originalImage);
}

export function applyTransform() {
  els.canvas.style.transform = `translate(${App.pan.x}px, ${App.pan.y}px) scale(${App.zoom})`;
  els.zoomLabel.textContent = `${Math.round(App.zoom * 100)}%`;
}

export function applyOriginalTransform() {
  const cv = els.canvasOriginal;
  if (!cv) return;
  cv.style.transform = `translate(${App.origPan.x}px, ${App.origPan.y}px) scale(${App.origZoom})`;
}

// ---------- 坐标换算（事件 → 画布 → 格） ----------

// 画布当前显示缩放（CSS transform 缩放后画布元素宽度 / 位图宽度）
export function canvasScale(rect) {
  const r = rect || els.canvas.getBoundingClientRect();
  return r.width / els.canvas.width;
}

// 事件坐标 → 画布内像素坐标（考虑 CSS transform 缩放）
export function eventToCanvasPos(e, rect) {
  const r = rect || els.canvas.getBoundingClientRect();
  const scale = r.width / els.canvas.width;
  return {
    x: (e.clientX - r.left) / scale,
    y: (e.clientY - r.top) / scale,
  };
}

// 画布像素坐标 → 格坐标（含四周 1 格行列号偏移；可能落在图案外）
export function canvasPosToCell(px, py) {
  const cell = App.screenCell;
  return {
    x: Math.floor(px / cell) - CANVAS_EDGE_CELLS,
    y: Math.floor(py / cell) - CANVAS_EDGE_CELLS,
  };
}

// 事件坐标 → 格坐标（含行列号偏移；可能落在图案外）
export function eventToCell(e, rect) {
  const p = eventToCanvasPos(e, rect);
  return canvasPosToCell(p.x, p.y);
}

// 格中心 → 屏幕坐标（用于定位九宫格弹窗等浮层）
export function cellCenterToScreen(cell) {
  const scale = canvasScale();
  const sc = App.screenCell;
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: rect.left + (cell.x + CANVAS_EDGE_CELLS + 0.5) * sc * scale,
    y: rect.top + (cell.y + CANVAS_EDGE_CELLS + 0.5) * sc * scale,
    scale,
  };
}

// ---------- 同步拖拽的坐标换算 ----------
// 拼豆图每个像素格在画布上占 screenCell 像素，图案外侧有 1 格行列号条；
// 拼豆网格是原图压缩后的结果，因此整张网格 → 整张原图：
//   拼豆格 (x,y) 对应原图中被压缩为该格的图像块 (x*sw, y*sh)
// 原图 zoom = 拼豆 zoom × screenCell × (网格宽 / 原图显示宽)
//   原图 pan  = 拼豆 pan + 1 格行列号条 × screenCell × 拼豆 zoom
export function beadCellPx() {
  return App.screenCell || CELL;
}

export function origZoomRatio() {
  const gridW = App.project ? App.project.width : 0;
  const dispW = els.canvasOriginal ? els.canvasOriginal.width : 0;
  if (!gridW || !dispW) return 1;
  return gridW / dispW;
}

export function origFromBead() {
  const cell = beadCellPx();
  const marginPx = CANVAS_EDGE_CELLS * cell * App.zoom;
  return {
    pan: { x: App.pan.x + marginPx, y: App.pan.y + marginPx },
    zoom: App.zoom * cell * origZoomRatio(),
  };
}

export function beadFromOrig(pan, zoom) {
  const cell = beadCellPx();
  const beadZoom = zoom / (cell * origZoomRatio());
  const marginPx = CANVAS_EDGE_CELLS * cell * beadZoom;
  return {
    pan: { x: pan.x - marginPx, y: pan.y - marginPx },
    zoom: beadZoom,
  };
}

export function mirrorBeadToOrig() {
  const o = origFromBead();
  App.origPan = o.pan;
  App.origZoom = o.zoom;
}

export function mirrorOrigToBead() {
  const b = beadFromOrig(App.origPan, App.origZoom);
  App.pan = b.pan;
  App.zoom = b.zoom;
}

export function fitOriginal() {
  const cv = els.canvasOriginal;
  const pane = els.compareOriginal;
  if (!cv || !pane || !cv.width || !cv.height) return;
  const vw = pane.clientWidth;
  const vh = pane.clientHeight;
  if (!vw || !vh) return;
  const fit = fitToViewport(cv.width, cv.height, vw, vh, FIT_ZOOM_CAP);
  // 原图画布位于带内边距的对比面板内，需扣掉它的静态偏移，否则缩放后偏右下
  const offset = staticOffsetTo(pane, cv);
  App.origZoom = fit.zoom;
  App.origPan = { x: fit.pan.x - offset.x, y: fit.pan.y - offset.y };
  applyOriginalTransform();
}

export function zoomAtOriginal(clientX, clientY, factor) {
  const cv = els.canvasOriginal;
  const rect = cv.getBoundingClientRect();
  if (rect.width === 0 || !App.originalImage) return;
  const oldZ = App.origZoom;
  const minZ = App.settings.syncPan ? beadCellPx() * origZoomRatio() * ZOOM_MIN : ZOOM_MIN;
  const maxZ = App.settings.syncPan ? beadCellPx() * origZoomRatio() * ZOOM_MAX : ZOOM_MAX;
  const newZ = Math.min(maxZ, Math.max(minZ, oldZ * factor));
  const r = zoomAroundPoint(
    rect.left,
    rect.top,
    App.origPan.x,
    App.origPan.y,
    oldZ,
    clientX,
    clientY,
    newZ,
  );
  App.origZoom = r.zoom;
  App.origPan = r.pan;
  if (App.settings.syncPan) {
    mirrorOrigToBead();
  }
  applyTransform();
  applyOriginalTransform();
}

// 把工作区画布缩放到适应视口（对比开启时以拼豆一侧为视口）
export function fitViewportToCanvas() {
  if (!App.project) return;
  const vp = compareActive() ? els.beadPane : els.canvasScroll;
  const vw = vp.clientWidth;
  const vh = vp.clientHeight;
  const cw = els.canvas.width;
  const ch = els.canvas.height;
  if (!cw || !ch) return;
  const fit = fitToViewport(cw, ch, vw, vh, FIT_ZOOM_CAP);
  // 画布位于带内边距的面板内，扣掉静态偏移，避免适应窗口后整体偏右下、顶部留出多余空白
  const offset = staticOffsetTo(vp, els.canvas);
  App.zoom = fit.zoom;
  App.pan = { x: fit.pan.x - offset.x, y: fit.pan.y - offset.y };
  applyTransform();
  runAfterZoom();
}

// 沿 offsetParent 链累加元素相对目标容器的静态布局偏移（不受 transform 影响）
function staticOffsetTo(target, el) {
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== target) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return { x, y };
}

// 围绕鼠标位置缩放工作区（缩放后由钩子触发 overlay 重绘与联动）
export function zoomAtCore(clientX, clientY, factor) {
  if (!App.project) return;
  const rect = els.canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const oldZ = App.zoom;
  const newZ = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldZ * factor));
  const r = zoomAroundPoint(
    rect.left,
    rect.top,
    App.pan.x,
    App.pan.y,
    oldZ,
    clientX,
    clientY,
    newZ,
  );
  App.zoom = r.zoom;
  App.pan = r.pan;
  applyTransform();
  runAfterZoom();
}
