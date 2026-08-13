import * as api from './api.js';
import * as C from './colors.js';
import {
  drawPattern,
  drawPatternBase,
  drawPatternOverlay,
  clearCanvas,
  canvasMetrics,
  findConnectedComponents,
} from './render.js';
import {
  CELL,
  BRUSH_SIZE_MIN,
  BRUSH_SIZE_MAX,
  TOOLS,
  CANVAS_EDGE_CELLS,
  ORIG_MAX_DIM,
  DEFAULT_TARGET_PIXELS,
  TARGET_PIXELS_MAX,
  TARGET_PIXEL_PRESETS,
  SCREEN_CELL_MIN,
  SCREEN_CELL_MAX_DIM,
  SCREEN_CELL_MAX_AREA,
  ZOOM_MIN,
  ZOOM_MAX,
  FIT_ZOOM_CAP,
  VIEWPORT_PADDING,
  ZOOM_WHEEL_FACTOR,
  ZOOM_BUTTON_FACTOR,
  QUICK_PICKER_MAX,
  QUICK_PICKER_COLS,
  QUICK_PICKER_CELL,
  QUICK_PICKER_PAD,
  QUICK_PICKER_HEIGHT,
  QUICK_PICKER_EDGE_MARGIN,
  QUICK_PICKER_OFFSET_CELLS,
  CROP_MAGNIFIER_MIN_SCREEN_CELL,
  CROP_MAGNIFIER_SIZE,
  CROP_MAGNIFIER_SCALE,
  CROP_EDGE_HIT_PX,
  GRID_FINE_MIN_SCREEN_CELL,
  GRID_THICK_MIN_SCREEN_CELL,
  EXPORT_CELL_MIN,
  EXPORT_CELL_MAX,
  EXPORT_CELL_DEFAULT,
  EXPORT_PAD_MAX,
  EXPORT_PREVIEW_CELL,
  EXPORT_PREVIEW_MAX_W,
  EXPORT_PREVIEW_MAX_H,
  TOAST_DURATION_MS,
  HINT_THROTTLE_MS,
  AUTOSAVE_DELAY_MS,
  CONFIG_SAVE_DELAY_MS,
  HIGHLIGHT_BLINK_MS,
  PANEL_ANIMATION_MS,
  PANEL_COLLAPSED_WIDTH,
  PANEL_FULL_WIDTH,
  PANEL_IDS,
  PANEL_STORAGE_KEY,
} from './constants.js';
import {
  createEmptyHistory,
  createTransaction,
  deleteTransaction,
  findTransaction,
  sanitizeHistory,
  recordStep,
  undoStep,
  redoStep,
  applyStepToGrid,
  recordStructuralStep,
  applyStructuralStep,
  MAX_UNDO_STEPS,
} from './history.js';

const $ = (id) => document.getElementById(id);

const els = {
  toast: $('toast'),
  fileInput: $('file-input'),
  btnImport: $('btn-import'),
  targetPixels: $('target-pixels'),
  targetPixelsBtn: $('target-pixels-btn'),
  targetPixelsMenu: $('target-pixels-menu'),
  btnRecompress: $('btn-recompress'),
  chkSharpen: $('chk-sharpen'),
  chkCodes: $('chk-codes'),
  selDistance: $('sel-distance'),
  btnExport: $('btn-export'),
  btnTheme: $('btn-theme'),
  btnSaveStateSide: $('btn-save-state-side'),
  btnClearAll: $('btn-clear-all'),
  btnLogout: $('btn-logout'),
  autosave: $('autosave-indicator'),
  colorSlider: $('color-slider'),
  sliderValue: $('slider-value'),
  emptyStyle: $('empty-style'),
  usedColors: $('used-colors'),
  configSelect: $('config-select'),
  btnNewConfig: $('btn-new-config'),
  btnImportConfig: $('btn-import-config'),
  btnExportConfig: $('btn-export-config'),
  btnRenameConfig: $('btn-rename-config'),
  btnDeleteConfig: $('btn-delete-config'),
  configFileInput: $('config-file-input'),
  colorTable: $('color-table'),
  btnAddColor: $('btn-add-color'),
  toolBrush: $('tool-brush'),
  toolPicker: $('tool-picker'),
  toolEraser: $('tool-eraser'),
  toolCrop: $('tool-crop'),
  modeLabel: $('mode-label'),
  selectionControls: $('selection-controls'),
  sameColorChk: $('same-color-select'),
  selectHighlightBtn: $('select-highlight'),
  cropControls: $('crop-controls'),
  btnAutoCrop: $('btn-auto-crop'),
  btnApplyCrop: $('btn-apply-crop'),
  brushSize: $('brush-size'),
  brushSizeValue: $('brush-size-value'),
  brushSizeWrap: $('brush-size-wrap'),
  brushSwatch: $('brush-swatch'),
  brushLabel: $('brush-label'),
  colorList: $('color-list'),
  canvas: $('canvas'),
  canvasScroll: $('canvas-scroll'),
  cropMagnifier: $('crop-magnifier'),
  cropMagnifierCanvas: $('crop-magnifier-canvas'),
  canvasOriginal: $('canvas-original'),
  compareOriginal: $('compare-original'),
  beadPane: $('bead-pane'),
  emptyHint: $('empty-hint'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  zoomFit: $('zoom-fit'),
  zoomLabel: $('zoom-label'),
  chkCompare: $('chk-compare'),
  chkSyncPan: $('chk-sync-pan'),
  cellInfo: $('cell-info'),
  quickPicker: $('quick-picker'),
  highlightColorList: $('highlight-color-list'),
  treeList: $('tree-list'),
  treeEmpty: $('tree-empty'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
  undoInfo: $('undo-info'),
  btnFixMenu: $('btn-fix-menu'),
  fixMenu: $('fix-menu'),
  fixItemGesture: $('fix-item-gesture'),
  docDialog: $('doc-dialog'),
  docContent: $('doc-content'),
  docClose: $('doc-close'),
  exportDialog: $('export-dialog'),
  dlgCell: $('dlg-cell-size'),
  dlgGrid: $('dlg-grid-lines'),
  dlgPad: $('dlg-pad'),
  dlgEdgeNumbers: $('dlg-edge-numbers'),
  dlgCodes: $('dlg-codes'),
  dlgLegend: $('dlg-legend'),
  dlgEmptyStyle: $('dlg-empty-style'),
  dlgFormat: $('dlg-format'),
  dlgOk: $('dlg-export-ok'),
  dlgCancel: $('dlg-export-cancel'),
  dlgPreview: $('dlg-preview'),
  dlgBusy: $('dlg-busy'),
  dlgStatus: $('dlg-status'),
  dirtyIndicator: $('dirty-indicator'),
  loginMask: $('login-mask'),
  loginToken: $('login-token'),
  btnLogin: $('btn-login'),
  loginError: $('login-error'),
};

const ctx = els.canvas.getContext('2d');

// 工作区底图离屏缓存：单元格 / 行列号 / 网格线等静态内容只在内容变化时重绘，
// hover / 选区 / 高亮等覆盖层单独叠加，避免移动鼠标时反复重建底图
const baseCanvas = document.createElement('canvas');
const baseCtx = baseCanvas.getContext('2d');

const App = {
  configs: [],
  configName: null,
  palette: [],          // 色板配置（可编辑，重新压缩时才应用到画布）
  appliedPalette: [],   // 已应用色板：当前画布与编辑工具显示所用，重新压缩/导入时更新
  project: null,       // { width, height, grid: Int16Array }
  compressed: null,    // { rgba, width, height }
  originalFile: null,
  originalImage: null, // 用于「对比原图」的原图 HTMLImageElement
  originalUrl: null,   // 原图 object URL
  origPan: { x: 0, y: 0 },
  origZoom: 1,
  compareEnabled: false,
  syncPan: false,
  maxColors: 2,
  baseGrid: null,
  sliderN: null,
  editedSinceSlider: false,
  brushColor: null,    // 未选择颜色
  brushSize: 1,        // 画笔 / 橡皮矩形边长的一半（边长 = 2 × brushSize − 1）
  tool: TOOLS.SELECT,  // select（选择）/ brush（画笔）/ eraser（橡皮）/ picker（取色）
  crop: null,          // 裁剪矩形 {x0,y0,x1,y1}（含端点）
  cropActiveEdge: null, // 当前选中/拖拽的边：left/right/top/bottom
  cropPreview: null,   // 裁剪预览虚线 {horizontal, pos}（选中边时将移动到的格线）
  selection: new Set(), // 当前选中的像素格索引集合（p = y*width + x）
  dragSelect: null,     // 矩形拖选中的实时预览范围 {x0,y0,x1,y1}
  sameColorSelect: false, // 同色选区：单击只选四方向相连的同色像素
  hoverCell: null,     // 鼠标当前指向的像素格（用于 hover 边框）
  painting: false,
  lastCell: null,
  pan: { x: 0, y: 0 },
  history: createEmptyHistory(),
  undoStack: [],
  redoStack: [],
  strokeBuffer: null,  // 一次画笔/橡皮按下到放开过程中累积的像素修改
  settings: {
    targetPixels: DEFAULT_TARGET_PIXELS,
    useLab: true,
    sharpen: true,
    showCodes: true,
    emptyStyle: 'default',
    compare: false,
    syncPan: false,
    brushSize: 1,
    sameColorSelect: false,
  },
  dirty: false,
  zoom: 1,
  screenCell: CELL,
  highlightBlink: true,
  highlightTimer: null,
  pickerCandidates: null,
  pickerCell: null,      // 九宫格改色的目标格 {x,y,p,original}（original 为打开时的原始颜色）
  pickerPreviewIndex: null, // 九宫格当前悬停预览的候选序号（null 表示未预览）
  highlightColor: null,
  saveTimer: null,
  configTimer: null,
};

let renderQueued = false;
let canvasRenderQueued = false;
let toastTimer = null;
let cropLastMouse = null; // 裁剪模式最近一次鼠标位置（缩放后重绘放大镜用）
let baseDetailKey = null; // 底图细节层级（细线/色号、粗线是否隐藏），跨阈值时重建底图
let authResolve = null;
let batchingFill = false; // 批量填充时暂缓逐格重绘/自动保存，结束后统一提交
// 渲染选区缓存：selection / dragSelect 引用不变则复用，避免大选区每次重绘都复制
let renderSelectionCache = { sel: null, drag: null, value: null };
const dragState = {
  active: false,
  cropEdge: null,      // 裁剪模式当前拖拽的边
  orig: false,
  moved: false,
  panning: false,
  startX: 0,
  startY: 0,
  panStart: null,
  origPanStart: null,
  downCell: null,
  selectionAnchor: null, // 选择模式矩形拖选的起点格
  shift: false,          // 本次拖拽/单击是否按住 Shift（追加并集）
};

// ---------------- 基础工具 ----------------

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), TOAST_DURATION_MS);
}

let paletteHintShownAt = 0;

// 色板配置修改后不即时生效：弹出一次性提示，3 秒内不重复打扰
function hintPaletteDeferred() {
  const now = Date.now();
  if (now - paletteHintShownAt < HINT_THROTTLE_MS) return;
  paletteHintShownAt = now;
  toast('色板配置修改后需单击「重新压缩」才会应用到画布');
}

let distanceHintShownAt = 0;

// 颜色距离修改后不即时生效：弹出一次性提示，3 秒内不重复打扰
function hintDistanceDeferred() {
  const now = Date.now();
  if (now - distanceHintShownAt < HINT_THROTTLE_MS) return;
  distanceHintShownAt = now;
  toast('颜色距离修改后需单击「重新压缩」才会重新生成图案');
}

function downloadDataUrl(dataUrl, filename) {
  downloadUrl(dataUrl, filename);
}

// 触发浏览器下载（data URL 或普通 URL）
function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 颜色条目通用文案：色号 / 完整标题
function codeOf(c) {
  return (c && (c.code || String(c.index))) || '';
}

function titleOf(c) {
  return `${c.name || ''} ${c.code || ''} ${c.hex}`.trim();
}

// 数量徽标（如 ×12）：与导出图例的「色号 × 数量」格式区分，徽标省略前导空格
function countBadge(count) {
  return count ? `×${count}` : '';
}

// 解析输入数值并夹取到 [min, max]；非法 / 为空时返回 fallback
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 是否存在事务历史或单步撤销/重做记录
function hasPendingRecords() {
  return App.history.items.length > 0 || App.undoStack.length > 0 || App.redoStack.length > 0;
}

// 有事务/撤销记录时弹确认并清空；无记录或用户取消时返回 false
function confirmClearRecords(message) {
  if (!hasPendingRecords()) return true;
  if (!confirm(message)) return false;
  clearHistoryRecords();
  renderHistoryUI();
  return true;
}

// 计算把尺寸适配进视口的缩放与居中位移
function fitToViewport(sizeW, sizeH, vw, vh, cap) {
  const zoom = Math.max(ZOOM_MIN, Math.min((vw - VIEWPORT_PADDING) / sizeW, (vh - VIEWPORT_PADDING) / sizeH, cap));
  return {
    zoom,
    pan: { x: (vw - sizeW * zoom) / 2, y: (vh - sizeH * zoom) / 2 },
  };
}

// 围绕画布上某点缩放：保持该点的内容位置不变，返回新的 zoom 与 pan
function zoomAroundPoint(rectLeft, rectTop, panX, panY, oldZoom, clientX, clientY, newZoom) {
  const stageLeft = rectLeft - panX;
  const stageTop = rectTop - panY;
  const ix = (clientX - rectLeft) / oldZoom;
  const iy = (clientY - rectTop) / oldZoom;
  return {
    zoom: newZoom,
    pan: { x: clientX - stageLeft - ix * newZoom, y: clientY - stageTop - iy * newZoom },
  };
}

// ---------------- 侧边栏折叠 / 展开 ----------------

function readPanelPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function writePanelPrefs(prefs) {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    // localStorage 不可用时（如隐私模式）忽略，仅本次会话生效
  }
}

function setPanelCollapsed(id, collapsed) {
  const panel = document.getElementById(id);
  if (!panel) return;
  let panDelta = 0;
  if (id === 'left-panel' && App.project) {
    // 左侧栏收起/展开会平移整个工作区视口；
    // 反向补偿画布位移，让图案保持在屏幕上的绝对位置不变
    const current = panel.classList.contains('collapsed') ? PANEL_COLLAPSED_WIDTH : PANEL_FULL_WIDTH[id];
    const target = collapsed ? PANEL_COLLAPSED_WIDTH : PANEL_FULL_WIDTH[id];
    panDelta = current - target;
  }
  panel.classList.toggle('collapsed', collapsed);
  if (panDelta) animatePanCompensation(panDelta);
  const prefs = readPanelPrefs();
  prefs[id] = collapsed;
  writePanelPrefs(prefs);
}

// 与侧边栏宽度过渡同步地平移画布，保证画面在屏幕上保持绝对位置
function animatePanCompensation(delta) {
  const panTo = App.pan.x + delta;
  const origTo = App.originalImage ? App.origPan.x + delta : null;
  const panFrom = App.pan.x;
  const origFrom = App.originalImage ? App.origPan.x : null;
  const start = performance.now();
  const dur = PANEL_ANIMATION_MS;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const k = ease(t);
    App.pan.x = panFrom + (panTo - panFrom) * k;
    if (origFrom != null) App.origPan.x = origFrom + (origTo - origFrom) * k;
    applyTransform();
    applyOriginalTransform();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function togglePanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  setPanelCollapsed(id, !panel.classList.contains('collapsed'));
}

function applyPanelPrefs() {
  const prefs = readPanelPrefs();
  for (const id of PANEL_IDS) {
    const panel = document.getElementById(id);
    if (panel && prefs[id]) panel.classList.add('collapsed');
  }
}

function bindPanelToggles() {
  for (const id of PANEL_IDS) {
    const toggle = $(id + '-toggle');
    if (toggle) toggle.addEventListener('click', () => togglePanel(id));
    // 颜色清单 / 事务历史：点击整个标题栏即可收起/展开
    const head = $(id + '-head');
    if (head) head.addEventListener('click', () => togglePanel(id));
    const expand = $(id + '-expand');
    if (expand) expand.addEventListener('click', () => togglePanel(id));
  }
}

// ---------------- 对比原图 / 同步拖拽 ----------------

// ---------- 原图缓存（IndexedDB，刷新后对比功能仍可用） ----------

const ORIGINAL_DB = 'fuse-beads-tool';
const ORIGINAL_STORE = 'originals';
const ORIGINAL_KEY = 'current';

function openOriginalDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(ORIGINAL_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ORIGINAL_STORE)) {
        req.result.createObjectStore(ORIGINAL_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveOriginalCache(blob) {
  try {
    const db = await openOriginalDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ORIGINAL_STORE, 'readwrite');
      tx.objectStore(ORIGINAL_STORE).put(blob, ORIGINAL_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    // 缓存不可用时（隐私模式等）忽略，对比功能仅在本次会话生效
  }
}

async function readOriginalCache() {
  try {
    const db = await openOriginalDB();
    const blob = await new Promise((resolve, reject) => {
      const tx = db.transaction(ORIGINAL_STORE, 'readonly');
      const req = tx.objectStore(ORIGINAL_STORE).get(ORIGINAL_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blob;
  } catch (e) {
    return null;
  }
}

// 从浏览器缓存恢复原图（刷新后对比功能仍可用）
async function restoreOriginalFromCache() {
  const blob = await readOriginalCache();
  if (!blob) return false;
  return loadOriginalImage(blob);
}

function loadOriginalImage(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(false); return; }
    App.originalFile = file; // 缓存恢复时也保留原图句柄，刷新后「重新压缩」仍可用
    if (App.originalUrl) {
      try { URL.revokeObjectURL(App.originalUrl); } catch (e) { /* ignore */ }
    }
    App.originalUrl = null;
    App.originalImage = null;
    if (typeof URL.createObjectURL !== 'function') { resolve(false); return; }
    saveOriginalCache(file); // 缓存原图，刷新后仍可对比
    const url = URL.createObjectURL(file);
    App.originalUrl = url;
    const img = new Image();
    img.onload = () => {
      App.originalImage = img;
      drawOriginalImage();
      if (App.compareEnabled) {
        if (App.syncPan) mirrorBeadToOrig();
        else fitOriginal();
        applyOriginalTransform();
      }
      resolve(true);
    };
    img.onerror = () => {
      App.originalImage = null;
      toast('原图加载失败，无法使用对比功能');
      resolve(false);
    };
    img.src = url;
  });
}

function drawOriginalImage() {
  const cv = els.canvasOriginal;
  const img = App.originalImage;
  if (!img) return;
  const scale = Math.min(1, ORIG_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

function applyOriginalTransform() {
  const cv = els.canvasOriginal;
  if (!cv) return;
  cv.style.transform = `translate(${App.origPan.x}px, ${App.origPan.y}px) scale(${App.origZoom})`;
}

// ---------- 同步拖拽的坐标换算 ----------
// 拼豆图每个像素格在画布上占 screenCell 像素，图案外侧有 1 格行列号条；
// 拼豆网格是原图压缩后的结果，因此整张网格 ↔ 整张原图：
//   拼豆格 (x,y) 对应原图中被压缩为该格的原图像素块 (x*sw, y*sh)
// 原图 zoom = 拼豆 zoom × screenCell × (网格宽 / 原图显示宽)
//   原图 pan  = 拼豆 pan + 1 格行列号条 × screenCell × 拼豆 zoom
function beadCellPx() {
  return App.screenCell || CELL;
}

// 网格宽与原图显示宽的比值（与降采样系数相互抵消，与原图显示分辨率无关）
function origZoomRatio() {
  const gridW = App.project ? App.project.width : 0;
  const dispW = els.canvasOriginal ? els.canvasOriginal.width : 0;
  if (!gridW || !dispW) return 1;
  return gridW / dispW;
}

function origFromBead() {
  const cell = beadCellPx();
  const marginPx = CANVAS_EDGE_CELLS * cell * App.zoom;
  return {
    pan: { x: App.pan.x + marginPx, y: App.pan.y + marginPx },
    zoom: App.zoom * cell * origZoomRatio(),
  };
}

function beadFromOrig(pan, zoom) {
  const cell = beadCellPx();
  const beadZoom = zoom / (cell * origZoomRatio());
  const marginPx = CANVAS_EDGE_CELLS * cell * beadZoom;
  return {
    pan: { x: pan.x - marginPx, y: pan.y - marginPx },
    zoom: beadZoom,
  };
}

function mirrorBeadToOrig() {
  const o = origFromBead();
  App.origPan = o.pan;
  App.origZoom = o.zoom;
}

function mirrorOrigToBead() {
  const b = beadFromOrig(App.origPan, App.origZoom);
  App.pan = b.pan;
  App.zoom = b.zoom;
}

function fitOriginal() {
  const cv = els.canvasOriginal;
  const pane = els.compareOriginal;
  if (!cv || !pane || !cv.width || !cv.height) return;
  const vw = pane.clientWidth;
  const vh = pane.clientHeight;
  if (!vw || !vh) return;
  const fit = fitToViewport(cv.width, cv.height, vw, vh, FIT_ZOOM_CAP);
  App.origZoom = fit.zoom;
  App.origPan = fit.pan;
  applyOriginalTransform();
}

function zoomAtOriginal(clientX, clientY, factor) {
  const cv = els.canvasOriginal;
  const rect = cv.getBoundingClientRect();
  if (rect.width === 0 || !App.originalImage) return;
  const oldZ = App.origZoom;
  const minZ = App.syncPan ? beadCellPx() * origZoomRatio() * ZOOM_MIN : ZOOM_MIN;
  const maxZ = App.syncPan ? beadCellPx() * origZoomRatio() * ZOOM_MAX : ZOOM_MAX;
  const newZ = Math.min(maxZ, Math.max(minZ, oldZ * factor));
  const r = zoomAroundPoint(rect.left, rect.top, App.origPan.x, App.origPan.y, oldZ, clientX, clientY, newZ);
  App.origZoom = r.zoom;
  App.origPan = r.pan;
  if (App.syncPan) {
    mirrorOrigToBead();
  }
  applyTransform();
  applyOriginalTransform();
}

function setCompareEnabled(on, { silent = false } = {}) {
  if (on && !App.project) {
    App.compareEnabled = false;
    App.settings.compare = false;
    els.chkCompare.checked = false;
    if (!silent) toast('请先导入图片');
    return false;
  }
  if (on && !App.originalImage) {
    App.compareEnabled = false;
    App.settings.compare = false;
    els.chkCompare.checked = false;
    if (!silent) toast('原图尚未加载，请先导入图片再使用对比');
    return false;
  }
  App.compareEnabled = on;
  App.settings.compare = on;
  els.chkCompare.checked = on;
  if (!on && App.syncPan) {
    // 取消对比原图时，同步拖拽一并取消
    App.syncPan = false;
    App.settings.syncPan = false;
    els.chkSyncPan.checked = false;
  }
  els.canvasScroll.classList.toggle('compare-on', on);
  if (on) {
    drawOriginalImage();
    if (App.syncPan) mirrorBeadToOrig();
    else fitOriginal();
    applyOriginalTransform();
  }
  scheduleAutosave();
  return true;
}

function setSyncPan(on) {
  if (on && !App.compareEnabled) {
    const ok = setCompareEnabled(true);
    if (!ok) {
      els.chkSyncPan.checked = false;
      App.syncPan = false;
      App.settings.syncPan = false;
      return;
    }
  }
  App.syncPan = on;
  App.settings.syncPan = on;
  els.chkSyncPan.checked = on;
  if (on && App.originalImage) {
    // 同步拖拽：以拼豆图当前坐标/缩放为准，换算成原图的坐标与缩放
    mirrorBeadToOrig();
    applyOriginalTransform();
  }
  scheduleAutosave();
}

// ---------------- Token 认证 ----------------

function showLoginError(msg) {
  els.loginError.textContent = msg;
  els.loginError.classList.remove('hidden');
}

async function tryLogin() {
  const token = els.loginToken.value.trim();
  if (!token) {
    showLoginError('请输入 Token');
    return;
  }
  try {
    await api.login(token);
  } catch (e) {
    showLoginError(e.message || 'Token 不正确');
    return;
  }
  els.loginError.classList.add('hidden');
  els.loginToken.value = '';
  els.loginMask.classList.add('hidden');
  els.btnLogout.classList.remove('hidden');
  const resolve = authResolve;
  authResolve = null;
  if (resolve) resolve();
}

async function ensureAuth() {
  let status = { authenticated: true, requiresAuth: false };
  try {
    status = await api.authStatus();
  } catch (e) {
    // 后端不可用时按需展示登录框，由后续请求报错
  }
  if (status.authenticated) {
    els.btnLogout.classList.toggle('hidden', !status.requiresAuth);
    return;
  }
  return new Promise((resolve) => {
    authResolve = resolve;
    els.loginMask.classList.remove('hidden');
    els.loginToken.focus();
  });
}

// ---------------- 渲染 ----------------

let screenCellCache = { key: null, value: null };

function chooseScreenCell(width, height) {
  const key = width + 'x' + height;
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

function buildDisplayData() {
  const { grid, width, height } = App.project;
  const n = width * height;
  const idx = new Int16Array(n);
  const rgb = new Uint32Array(n);
  for (let p = 0; p < n; p++) {
    const v = grid[p];
    if (v < 0) { idx[p] = -1; continue; }
    idx[p] = v;
    const c = App.appliedPalette[v] ? C.hexToRgb(App.appliedPalette[v].hex) : [255, 255, 255];
    rgb[p] = (c[0] << 16) | (c[1] << 8) | c[2];
  }
  return { idx, rgb };
}

function buildLegend(counts) {
  const legend = [];
  App.appliedPalette.forEach((c, i) => {
    if (counts[i]) {
      legend.push({ hex: c.hex, code: codeOf(c), count: counts[i] });
    }
  });
  // 按豆数量从多到少排序，数量相同按编号
  legend.sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return legend;
}

// 从基副本按颜色数量 N 生成工作副本（合并成保留色）
function mergeGrid(source, palette, useLab, n) {
  const counts = C.computeUsedCounts(source, App.project.width, App.project.height);
  const merge = C.buildMergeMap(counts, palette, useLab, n);
  const out = new Int16Array(source.length);
  for (let p = 0; p < source.length; p++) {
    const v = source[p];
    out[p] = v < 0 ? -1 : (merge.rep.get(v) ?? v);
  }
  return out;
}

function applySlider(n) {
  if (!App.project) return;
  const baseUsed = App.baseGrid ? C.countUsedColors(App.baseGrid, App.project.width, App.project.height) : 0;
  const hasHistory = hasPendingRecords();
  if (hasHistory || App.editedSinceSlider) {
    const msg = hasHistory
      ? '调整滑块将清空全部事务历史与撤销记录，并丢弃滑块调整后的编辑，从基副本重新生成图案。是否继续？'
      : '调整滑块将丢弃滑块调整后的编辑，并从基副本重新生成图案。是否继续？';
    if (!confirm(msg)) {
      els.colorSlider.value = String(App.sliderN ?? Math.max(2, baseUsed));
      els.sliderValue.textContent = String(App.sliderN ?? Math.max(2, baseUsed));
      return;
    }
    if (hasHistory) {
      clearHistoryRecords();
      renderHistoryUI();
    }
  }
  App.project.grid = mergeGrid(App.baseGrid, App.appliedPalette, App.settings.useLab, n);
  App.sliderN = n;
  App.editedSinceSlider = false;
  resetProjectEditingState();
  renderAll();
  scheduleAutosave();
}

// 清空全部事务历史与单步撤销/重做记录（导入/重压缩/滑块等重新生成图案时使用）
function clearHistoryRecords() {
  App.history = createEmptyHistory();
  App.undoStack = [];
  App.redoStack = [];
  App.strokeBuffer = null;
}

// 清空与网格坐标相关的编辑状态（保留撤销栈；结构型撤销/重做时使用）
function clearProjectEditingState() {
  App.selection = new Set();
  App.dragSelect = null;
  App.highlightColor = null;
  App.strokeBuffer = null;
  closeQuickPicker();
}

// 项目内容重建后统一重置编辑状态：选区/拖拽预览/色号高亮/九宫格与单步记录，并视为无未保存修改
function resetProjectEditingState() {
  clearProjectEditingState();
  App.undoStack = [];
  App.redoStack = [];
  setDirty(false);
}

function buildCodes() {
  const { grid, width, height } = App.project;
  const codes = new Array(width * height).fill('');
  for (let p = 0; p < grid.length; p++) {
    const v = grid[p];
    if (v >= 0) codes[p] = codeOf(App.appliedPalette[v]);
  }
  return codes;
}

function renderAll() {
  const project = App.project;
  if (!project) {
    clearCanvas(ctx);
    els.emptyHint.style.display = '';
    els.colorSlider.disabled = true;
    els.cellInfo.textContent = '';
    els.usedColors.textContent = '';
    els.sliderValue.textContent = '2';
    syncHighlightBlink();
    updateModeControls();
    if (App.compareEnabled || App.syncPan) {
      App.compareEnabled = false;
      App.syncPan = false;
      els.chkCompare.checked = false;
      els.chkSyncPan.checked = false;
      els.canvasScroll.classList.remove('compare-on');
    }
    return;
  }
  const counts = C.computeUsedCounts(project.grid, project.width, project.height);
  const used = C.countUsedColors(project.grid, project.width, project.height);
  const baseUsed = App.baseGrid ? C.countUsedColors(App.baseGrid, project.width, project.height) : used;
  App.maxColors = App.sliderN ?? baseUsed;
  els.colorSlider.max = String(Math.max(2, baseUsed));
  els.colorSlider.value = String(App.maxColors);
  els.colorSlider.disabled = baseUsed <= 1;
  els.sliderValue.textContent = String(App.maxColors);
  els.usedColors.textContent = `当前使用 ${used} 种颜色`;
  redrawCanvas();
  els.emptyHint.style.display = 'none';

  let empty = 0;
  for (let p = 0; p < project.grid.length; p++) if (project.grid[p] < 0) empty++;
  els.cellInfo.textContent = `${project.width} × ${project.height} · 总量 ${project.grid.length - empty} · 空位 ${empty}`;
  renderBrushColorList(counts);
  renderHighlightColorList(counts);
  syncHighlightBlink();
  updateModeControls();
}

let lastDisplay = null; // 底图对应的显示数据，覆盖层复用避免每帧重建

// 渲染底图到离屏画布（单元格 / 行列号 / 网格线 / 色号），内容变化时才调用
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
function syncBaseLayerDetail() {
  const key = baseDetailFlags();
  if (baseDetailKey !== null && baseDetailKey !== key) {
    renderBaseLayer();
    composeCanvas();
  }
  baseDetailKey = key;
}

// 把底图 + 覆盖层（选区 / 高亮 / hover / 九宫格目标格）合成到主画布
function composeCanvas() {
  const project = App.project;
  if (!project) return;
  if (!lastDisplay) renderBaseLayer();
  const display = lastDisplay;
  // 选区 = 已确认选区 + 拖拽中的实时矩形预览
  const selected = buildRenderSelection();
  const metrics = canvasMetrics(project.width, project.height, App.screenCell, 0, 0, App.screenCell);
  // 尺寸未变时不清空画布，直接覆盖绘制（底图覆盖整块画布）
  if (ctx.canvas.width !== metrics.w) ctx.canvas.width = metrics.w;
  if (ctx.canvas.height !== metrics.h) ctx.canvas.height = metrics.h;
  ctx.clearRect(0, 0, metrics.w, metrics.h); // 清掉上一帧残留（如裁剪蒙版留在四角的像素）
  ctx.drawImage(baseCanvas, 0, 0);
  drawPatternOverlay(ctx, project.width, project.height, display.idx, display.rgb, {
    cell: App.screenCell,
    outerPad: 0,
    edgeNumbers: true,
    zoom: App.zoom,
    selected,
    highlightColor: App.highlightColor,
    highlightBlink: App.highlightBlink,
    crop: App.crop,
    cropActiveEdge: App.cropActiveEdge,
    cropPreview: dragState.cropEdge ? null : App.cropPreview,
    toolState: {
      hover: App.tool === TOOLS.CROP ? null : App.hoverCell,
      tool: App.tool,
      brushSize: App.brushSize,
      pickerCell: App.pickerCell ? { x: App.pickerCell.x, y: App.pickerCell.y } : null,
      brushRgb: App.brushColor != null && App.appliedPalette[App.brushColor]
        ? C.hexToRgb(App.appliedPalette[App.brushColor].hex)
        : null,
    },
  });
  applyTransform();
}

function redrawCanvas() {
  const project = App.project;
  if (!project) return;
  renderBaseLayer();
  composeCanvas();
}

// 选区 + 拖拽预览的合并集合（带缓存：引用未变时复用上次结果）
function buildRenderSelection() {
  if (renderSelectionCache.sel === App.selection
    && renderSelectionCache.drag === App.dragSelect
    && renderSelectionCache.size === App.selection.size) {
    return renderSelectionCache.value;
  }
  const value = new Set(App.selection);
  if (App.dragSelect) {
    for (const p of rectCells(App.dragSelect)) value.add(p);
  }
  renderSelectionCache = { sel: App.selection, drag: App.dragSelect, size: App.selection.size, value };
  return value;
}

// 颜色清单高亮闪烁：高亮时按周期隐现，反色不明显也能看清选中色号
function syncHighlightBlink() {
  const active = App.highlightColor != null && App.project;
  if (!active) {
    clearInterval(App.highlightTimer);
    App.highlightTimer = null;
    App.highlightBlink = true;
    return;
  }
  // 定时器已在运行时直接复用，避免鼠标移动触发的重绘反复重置闪烁相位
  if (App.highlightTimer) return;
  App.highlightTimer = setInterval(() => {
    App.highlightBlink = !App.highlightBlink;
    composeCanvas();
  }, HIGHLIGHT_BLINK_MS);
}

function applyTransform() {
  els.canvas.style.transform = `translate(${App.pan.x}px, ${App.pan.y}px) scale(${App.zoom})`;
  els.zoomLabel.textContent = Math.round(App.zoom * 100) + '%';
}

function zoomFit() {
  if (!App.project) return;
  const vp = App.compareEnabled ? els.beadPane : els.canvasScroll;
  const vw = vp.clientWidth;
  const vh = vp.clientHeight;
  const cw = els.canvas.width;
  const ch = els.canvas.height;
  if (!cw || !ch) return;
  const fit = fitToViewport(cw, ch, vw, vh, FIT_ZOOM_CAP);
  App.zoom = fit.zoom;
  App.pan = fit.pan;
  applyTransform();
  refreshCropMagnifier();
  syncBaseLayerDetail();
  if (App.syncPan && App.originalImage) {
    mirrorBeadToOrig();
    applyOriginalTransform();
  }
}

function zoomAt(clientX, clientY, factor) {
  if (!App.project) return;
  const rect = els.canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const oldZ = App.zoom;
  const newZ = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldZ * factor));
  const r = zoomAroundPoint(rect.left, rect.top, App.pan.x, App.pan.y, oldZ, clientX, clientY, newZ);
  App.zoom = r.zoom;
  App.pan = r.pan;
  applyTransform();
  // 缩放后立即重绘覆盖层，让 hover 边框的隐藏阈值随缩放即时生效（底图不受缩放影响）
  composeCanvas();
  syncBaseLayerDetail();
  refreshCropMagnifier();
  if (App.syncPan && App.originalImage) {
    mirrorBeadToOrig();
    applyOriginalTransform();
  }
}

// ---------------- 颜色配置 ----------------

async function loadConfigs(selectName) {
  const res = await api.getConfigs();
  App.configs = res.configs;
  els.configSelect.innerHTML = '';
  for (const c of res.configs) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name}（${c.colorCount}色）`;
    els.configSelect.appendChild(opt);
  }
  const name = selectName && res.configs.some((c) => c.name === selectName)
    ? selectName
    : (res.configs[0] ? res.configs[0].name : null);
  App.configName = name;
  els.configSelect.value = name || '';
  if (name && !App.palette.length) {
    await loadConfigDetail(name);
  }
}

async function loadConfigDetail(name) {
  const res = await api.getConfig(name);
  const hadPalette = App.palette.length > 0;
  // 色板配置修改（含切换配置）只更新配置本身，画布与编辑工具保持不变，
  // 单击「重新压缩」后才会按新配置重新生成图案
  App.palette = res.colors;
  App.configName = res.name;
  els.configSelect.value = res.name;
  renderColorTable();
  scheduleAutosave();
  // 首次打开加载默认配置不算“更改”，不弹提示
  if (hadPalette) hintPaletteDeferred();
}

async function selectAndLoad(name) {
  await loadConfigs(name);
  if (name) await loadConfigDetail(name);
}

function scheduleConfigSave() {
  if (!App.configName) return;
  clearTimeout(App.configTimer);
  App.configTimer = setTimeout(async () => {
    try {
      await api.saveConfig(App.configName, App.palette);
    } catch (err) {
      toast('配置保存失败：' + err.message);
    }
  }, CONFIG_SAVE_DELAY_MS);
}

function renumberPalette() {
  App.palette.forEach((c, i) => { c.index = i + 1; });
}

function renderColorTable() {
  const tb = els.colorTable;
  tb.innerHTML = '';
  App.palette.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'color-row';

    const idx = document.createElement('input');
    idx.type = 'text';
    idx.className = 'c-index';
    idx.value = String(c.index);
    idx.readOnly = true;
    idx.title = '豆编号';

    const code = document.createElement('input');
    code.type = 'text';
    code.className = 'c-code';
    code.value = c.code || '';
    code.title = '豆色号';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'c-name';
    name.value = c.name || '';
    name.title = '名称';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = c.hex;

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'c-hex';
    hex.value = c.hex;

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = '删除该颜色';

    row.append(idx, code, name, color, hex, del);

    color.addEventListener('input', () => {
      App.palette[i].hex = color.value.toUpperCase();
      hex.value = App.palette[i].hex;
      // 色板配置修改不即时应用到画布/画笔，单击「重新压缩」后才生效
      scheduleConfigSave();
      hintPaletteDeferred();
    });
    hex.addEventListener('change', () => {
      const h = /^#?[0-9a-fA-F]{6}$/.test(hex.value.trim())
        ? '#' + hex.value.trim().replace('#', '').toUpperCase()
        : c.hex;
      App.palette[i].hex = h;
      color.value = h;
      hex.value = h;
      scheduleConfigSave();
      hintPaletteDeferred();
    });
    const onText = () => {
      App.palette[i].code = code.value.trim();
      App.palette[i].name = name.value.trim();
      scheduleConfigSave();
    };
    code.addEventListener('change', onText);
    name.addEventListener('change', onText);
    del.addEventListener('click', () => removeColor(i));

    tb.appendChild(row);
  });
}

function removeColor(i) {
  const used = App.project && App.project.grid.some((v) => v === i);
  if (used && !confirm('该颜色正在被使用，删除后重新压缩时已使用的格子会自动替换为最相近的颜色。是否继续？')) return;
  const oldPalette = App.palette;
  App.palette = App.palette.filter((_, k) => k !== i);
  if (!App.palette.length) {
    toast('至少保留一个颜色');
    App.palette = oldPalette;
    return;
  }
  renumberPalette();
  // 只修改色板配置本身，画布保持不变，重新压缩后才会按新配置生成
  renderColorTable();
  scheduleConfigSave();
  hintPaletteDeferred();
}

function addColor() {
  const n = App.palette.length + 1;
  App.palette.push({ index: n, code: String(n).padStart(3, '0'), name: '', hex: '#FFFFFF' });
  renderColorTable();
  scheduleConfigSave();
  hintPaletteDeferred();
}

function updateBrush() {
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
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    if (lum < bestLum) {
      bestLum = lum;
      best = i;
    }
  });
  return best;
}

// 画笔未选色时取调色板最暗色；调色板为空时提示并返回 false
function ensureBrushColor() {
  if (App.brushColor != null) return true;
  const dark = darkestPaletteIndex();
  if (dark == null) {
    toast('调色板为空，请先导入颜色配置');
    return false;
  }
  App.brushColor = dark;
  updateBrush();
  renderBrushColorList();
  renderAll();
  return true;
}

// 快捷键 / 按钮共用：切换到指定工具（画笔未选色时先取最暗色）
function switchToolShortcut(tool) {
  if (tool === TOOLS.BRUSH && !ensureBrushColor()) return;
  setTool(tool);
}

// 模式相关控件：画笔/橡皮显示尺寸拖动条；选择模式显示同色选区与选中高亮颜色
function updateModeControls() {
  const size = String(App.brushSize);
  if (els.brushSize.value !== size) els.brushSize.value = size;
  if (els.brushSizeValue.textContent !== size) els.brushSizeValue.textContent = size;
  els.brushSizeWrap.classList.toggle('hidden', App.tool !== TOOLS.BRUSH && App.tool !== TOOLS.ERASER);
  els.selectionControls.classList.toggle('hidden', App.tool !== TOOLS.SELECT);
  els.cropControls.classList.toggle('hidden', App.tool !== TOOLS.CROP);
  const disabled = App.highlightColor == null;
  if (els.selectHighlightBtn.disabled !== disabled) els.selectHighlightBtn.disabled = disabled;
}

// 右侧画笔颜色列表（可点击选择画笔颜色；选择模式有选区时点击为整块填充）
function renderBrushColorList(counts) {
  if (!counts && App.project) {
    counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  }
  const list = els.colorList;
  list.innerHTML = '';
  App.appliedPalette.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'color-item' + (App.brushColor === i ? ' selected' : '');
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
    item.addEventListener('click', () => {
      App.brushColor = i;
      updateBrush();
      if (App.tool === TOOLS.SELECT && App.selection.size > 0) {
        // 选择模式且有选区：将选区填充为该颜色，保持选择与模式，整块记一步撤销
        fillSelectionWithBrush();
      } else {
        // 无选区：切换为画笔模式
        setTool(TOOLS.BRUSH);
      }
      renderBrushColorList();
    });
    list.appendChild(item);
  });
  updateBrush();
}

// 工作区右侧的颜色清单：点击可高亮图片中对应色号的像素
function renderHighlightColorList(counts) {
  const list = els.highlightColorList;
  list.innerHTML = '';
  if (!counts && App.project) {
    counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  }
  const entries = [];
  App.appliedPalette.forEach((c, i) => {
    if (counts && counts[i]) entries.push({ c, i, count: counts[i] });
  });
  // 按数量正序（数量少的优先，值得修改），数量相同按色号
  entries.sort((a, b) => a.count - b.count || (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : 0));
  for (const { c, i, count } of entries) {
    const item = document.createElement('div');
    item.className = 'hc-item' + (App.highlightColor === i ? ' active' : '');
    item.title = `${titleOf(c)} ×${count}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    const code = document.createElement('span');
    code.className = 'hc-code';
    code.textContent = codeOf(c);
    const cnt = document.createElement('span');
    cnt.className = 'hc-count';
    cnt.textContent = countBadge(count);
    item.append(sw, code, cnt);
    item.addEventListener('click', () => {
      // 单选：再次点击取消，选择其它色号则替换
      App.highlightColor = App.highlightColor === i ? null : i;
      renderAll();
    });
    list.appendChild(item);
  }
}

// ---------------- 图片导入与映射 ----------------

async function processUpload({ confirmHistory = true } = {}) {
  if (!App.originalFile) return;
  if (confirmHistory && !confirmClearRecords('导入图片将清空全部事务历史与撤销记录。是否继续？')) return;
  try {
    const target = Math.min(TARGET_PIXELS_MAX, parseInt(els.targetPixels.value, 10) || DEFAULT_TARGET_PIXELS);
    const res = await api.uploadImage(App.originalFile, target, els.chkSharpen.checked);
    const img = new Image();
    img.src = 'data:image/png;base64,' + res.pngBase64;
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; });
    const off = document.createElement('canvas');
    off.width = res.width;
    off.height = res.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    const rgba = octx.getImageData(0, 0, res.width, res.height).data;
    App.compressed = { rgba, width: res.width, height: res.height };
    applyMapping();
    const used = C.countUsedColors(App.project.grid, App.project.width, App.project.height);
    toast(`已导入 ${res.width} × ${res.height}，共使用 ${used} 种颜色`);
  } catch (err) {
    toast('导入失败：' + err.message);
  }
}

function applyMapping() {
  if (!App.compressed) return;
  const isNew = !App.project;
  const { rgba, width, height } = App.compressed;
  const { grid } = C.computeInitialMapping(rgba, width, height, App.palette, App.settings.useLab);
  App.project = { width, height, grid };
  App.baseGrid = grid.slice();
  // 重新压缩/导入后，当前色板配置成为已应用色板（画布与编辑工具随之更新）
  App.appliedPalette = App.palette.map((c) => ({ ...c }));
  // 网格被替换，九宫格目标格索引可能失效
  resetProjectEditingState();
  App.maxColors = Math.max(2, C.countUsedColors(grid, width, height));
  App.sliderN = null;
  App.editedSinceSlider = false;
  renderAll();
  if (isNew) zoomFit();
  scheduleAutosave();
}

async function recompress() {
  if (!App.originalFile) { toast('请先导入图片'); return; }
  if (App.project && App.dirty) {
    if (!confirm('重新压缩将按新设置重新生成图案，并丢弃画布上的手动修改。是否继续？')) return;
  }
  if (!confirmClearRecords('重新压缩将清空全部事务历史与撤销记录。是否继续？')) return;
  await processUpload({ confirmHistory: false });
  zoomFit(); // 重新压缩后默认适应窗口
}

// ---------------- 画布编辑 ----------------

function cellFromEvent(e) {
  const rect = els.canvas.getBoundingClientRect();
  if (rect.width === 0 || !App.project) return null;
  const scale = rect.width / els.canvas.width;
  const cell = App.screenCell;
  const px = (e.clientX - rect.left) / scale;
  const py = (e.clientY - rect.top) / scale;
  const gx = Math.floor(px / cell);
  const gy = Math.floor(py / cell);
  const x = gx - CANVAS_EDGE_CELLS;
  const y = gy - CANVAS_EDGE_CELLS;
  // 四周 1 格为行列号条，不属于图案
  if (x < 0 || y < 0 || x >= App.project.width || y >= App.project.height) return null;
  return { x, y };
}

function paintCell(x, y) {
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
  if (!batchingFill) {
    scheduleRender();
    scheduleAutosave();
  }
  return { x, y, from, to: v };
}

// 按画笔 / 橡皮尺寸涂一个矩形（边长 = 2×brushSize−1，以目标格为中心，裁剪到图案边界）
function paintStamp(cell) {
  if (!cell) return;
  const r = App.brushSize - 1;
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

// ---------------- 区域选择 ----------------

function clearSelection() {
  if (!App.selection.size && !App.dragSelect) return;
  App.selection = new Set();
  App.dragSelect = null;
  renderAll();
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

function addToSelection(cells) {
  const next = new Set(App.selection);
  for (const p of cells) next.add(p);
  App.selection = next;
}

function replaceSelection(cells) {
  App.selection = new Set(cells);
}

// 单击选择：同色选区勾选时选连通块，否则选单格；Shift 追加并集，非 Shift 替换
function selectClick(cell, shift) {
  let cells;
  if (App.sameColorSelect) {
    cells = connectedColorCells(cell.x, cell.y);
  } else {
    cells = new Set([cell.y * App.project.width + cell.x]);
  }
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  renderAll();
}

// 矩形拖选：范围已裁剪到图案边界；Shift 追加并集，非 Shift 替换
// 矩形内的格索引集合（范围已裁剪到图案边界）
function rectCells(rect) {
  const { width } = App.project;
  const cells = new Set();
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) cells.add(y * width + x);
  }
  return cells;
}

function selectRect(rect, shift) {
  const cells = rectCells(rect);
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  renderAll();
}

// 用当前画笔颜色填充整个选区，整块记一步撤销（不改变选择与模式）
function fillSelectionWithBrush() {
  if (!App.project || !App.selection.size) return;
  App.strokeBuffer = [];
  const { width } = App.project;
  batchingFill = true;
  for (const p of App.selection) {
    const x = p % width;
    const y = (p / width) | 0;
    paintCell(x, y);
  }
  batchingFill = false;
  if (App.strokeBuffer.length) recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
  App.strokeBuffer = null;
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
}

// Delete 键：把选中格清除为空位，整块记一步撤销（不改变选择与模式）
function clearSelectionToEmpty() {
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

// ---------------- 单步撤销 / 重做 ----------------

// 裁剪等结构型操作的统一记录入口：旧增量步骤因坐标失效会被清空
function recordCropStep(before, after) {
  return recordStructuralStep(App.undoStack, App.redoStack, before, after, 'crop');
}

// 应用一步撤销 / 重做（兼容普通增量步骤与结构型步骤）
function applyUndoRedoStep(step, mode) {
  if (step.structural) {
    const holder = { width: 0, height: 0, grid: null, baseGrid: null };
    applyStructuralStep(holder, step, mode);
    App.project = { width: holder.width, height: holder.height, grid: holder.grid };
    App.baseGrid = holder.baseGrid;
    App.sliderN = null;
    App.editedSinceSlider = false;
    clearProjectEditingState();
    zoomFit(); // 尺寸变化后适应窗口
  } else {
    applyStepToGrid(App.project.grid, App.project.width, step.changes, mode);
  }
  setDirty(true);
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
}

function doUndo() {
  if (!App.project) return;
  const step = undoStep(App.undoStack, App.redoStack);
  if (!step) return;
  applyUndoRedoStep(step, 'undo');
  toast(`已撤销（剩余 ${App.undoStack.length} 步）`);
}

function doRedo() {
  if (!App.project) return;
  const step = redoStep(App.undoStack, App.redoStack);
  if (!step) return;
  applyUndoRedoStep(step, 'redo');
  toast(`已重做（剩余 ${App.redoStack.length} 步）`);
}

function updateUndoUI() {
  els.btnUndo.disabled = App.undoStack.length === 0;
  els.btnRedo.disabled = App.redoStack.length === 0;
  els.undoInfo.textContent = `单步记录：${App.undoStack.length}/${MAX_UNDO_STEPS}`;
}

// 同步「有未保存的修改」提示：画布有改动但尚未保存为事务时显示
function setDirty(d) {
  App.dirty = d;
  els.dirtyIndicator.classList.toggle('hidden', !d);
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
  renderBrushColorList();
  if (App.selection.size > 0) {
    // 有选区：取色后立即把选区填充为该颜色，再回选择模式（选区保留）
    fillSelectionWithBrush();
    setTool(TOOLS.SELECT);
  } else {
    // 无选区：取色后切换为画笔模式
    setTool(TOOLS.BRUSH);
  }
}

function strokeLine(a, b) {
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    paintStamp({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

// 仅重绘画布（hover 等不影响面板的变化），避免移动鼠标时反复重建颜色清单等面板 DOM
function scheduleCanvasRender() {
  if (canvasRenderQueued || renderQueued) return;
  canvasRenderQueued = true;
  requestAnimationFrame(() => {
    canvasRenderQueued = false;
    if (renderQueued) return; // 全量重绘即将执行，由 renderAll 统一覆盖
    composeCanvas();
  });
}

// ---------------- D 键快速选色 ----------------

// 九宫格候选色的邻近 8 格偏移（不含自身）
const QUICK_PICKER_NEIGHBORS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// 构建九宫格候选色：周围 8 格的颜色优先，不足 9 个时用最相近颜色补齐
function buildQuickCandidates(cell) {
  const { grid, width, height } = App.project;
  const p = cell.y * width + cell.x;
  App.pickerCell = { x: cell.x, y: cell.y, p, original: grid[p] };
  App.pickerPreviewIndex = null;
  const own = grid[p];
  const exclude = new Set(own >= 0 ? [own] : []);
  const candSet = new Set();
  for (const [dx, dy] of QUICK_PICKER_NEIGHBORS) {
    const nx = cell.x + dx;
    const ny = cell.y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const v = grid[ny * width + nx];
    if (v >= 0 && !exclude.has(v)) candSet.add(v);
  }
  const list = [...candSet];
  if (list.length < QUICK_PICKER_MAX) {
    const baseHex = own >= 0 && App.appliedPalette[own]
      ? App.appliedPalette[own].hex
      : (App.brushColor != null && App.appliedPalette[App.brushColor] ? App.appliedPalette[App.brushColor].hex : '#FFFFFF');
    const baseRgb = C.hexToRgb(baseHex);
    const scored = App.appliedPalette
      .map((c, i) => ({ i, d: C.colorDist2(baseRgb, C.hexToRgb(c.hex), App.settings.useLab) }))
      .filter((s) => !list.includes(s.i) && !exclude.has(s.i))
      .sort((a, b) => a.d - b.d);
    for (const s of scored) {
      if (list.length >= QUICK_PICKER_MAX) break;
      list.push(s.i);
    }
  }
  const scored = list.slice(0, QUICK_PICKER_MAX).map((i) => ({ i }));
  App.pickerCandidates = scored;
  return scored;
}

// 渲染九宫格弹窗内容（候选按钮 + 取消）
function renderQuickPicker(scored) {
  const box = els.quickPicker;
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'qp-title';
  title.textContent = '相近颜色（按 1-9 选择）';
  box.appendChild(title);
  const usedCounts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  for (let k = 0; k < scored.length; k++) {
    const c = App.appliedPalette[scored[k].i];
    const btn = document.createElement('button');
    btn.style.background = c.hex;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(k + 1);
    btn.appendChild(num);
    const rgb = C.hexToRgb(c.hex);
    const code = document.createElement('span');
    code.className = 'qp-code';
    code.textContent = codeOf(c);
    code.style.color = C.isLightColor(rgb) ? '#111111' : '#FFFFFF';
    const cnt = document.createElement('span');
    cnt.className = 'qp-count';
    cnt.textContent = countBadge(usedCounts[scored[k].i]);
    cnt.style.color = code.style.color;
    btn.appendChild(code);
    btn.appendChild(cnt);
    btn.title = titleOf(c);
    btn.addEventListener('click', () => applyQuickColor(k));
    btn.addEventListener('mouseover', () => previewQuickColor(k));
    box.appendChild(btn);
  }
  const cancel = document.createElement('button');
  cancel.className = 'qp-cancel';
  cancel.textContent = '取消（Esc）';
  cancel.addEventListener('click', closeQuickPicker);
  box.appendChild(cancel);
  box.classList.remove('hidden');
}

// 把九宫格弹窗定位到目标格下方（空间不足时移到上方，并限制在窗口内）
function positionQuickPicker(cell) {
  const box = els.quickPicker;
  const rect = els.canvas.getBoundingClientRect();
  const scale = rect.width / els.canvas.width;
  const sc = App.screenCell;
  const cx = rect.left + ((cell.x + CANVAS_EDGE_CELLS + 0.5) * sc) * scale;
  const cy = rect.top + ((cell.y + CANVAS_EDGE_CELLS + 0.5) * sc) * scale;
  const gap = sc * scale;
  const bw = QUICK_PICKER_CELL * QUICK_PICKER_COLS + QUICK_PICKER_PAD;
  const bh = QUICK_PICKER_HEIGHT;
  const left = Math.max(
    QUICK_PICKER_EDGE_MARGIN,
    Math.min(cx - bw / 2, window.innerWidth - bw - QUICK_PICKER_EDGE_MARGIN)
  );
  let top = cy + gap * QUICK_PICKER_OFFSET_CELLS; // 像素下方，再隔一个像素格
  if (top + bh > window.innerHeight - QUICK_PICKER_EDGE_MARGIN) {
    top = cy - gap * QUICK_PICKER_OFFSET_CELLS - bh;
  }
  top = Math.max(QUICK_PICKER_EDGE_MARGIN, top);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

function openQuickPicker(cell) {
  if (!App.appliedPalette.length) return;
  const scored = buildQuickCandidates(cell);
  renderQuickPicker(scored);
  positionQuickPicker(cell);
}

function applyQuickColor(k) {
  const cand = App.pickerCandidates && App.pickerCandidates[k];
  if (!cand) return;
  const { grid } = App.project;
  const pc = App.pickerCell; // 九宫格打开时由 openQuickPicker 设置目标格
  App.brushColor = cand.i;
  setTool(TOOLS.SELECT); // 改完颜色后回到选择模式（九宫格仅单选一格时可用）
  updateBrush();
  if (pc) {
    // 悬停预览可能已改动格子，这里统一以「打开时的原始颜色 → 目标颜色」记一步
    grid[pc.p] = cand.i;
    if (grid[pc.p] !== pc.original) {
      App.strokeBuffer = [{ x: pc.x, y: pc.y, from: pc.original, to: cand.i }];
      recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
      App.strokeBuffer = null;
      renderHistoryUI();
    }
  }
  App.pickerPreviewIndex = null;
  App.pickerCell = null;
  closeQuickPicker();
  renderBrushColorList();
  scheduleRender();
}

// 悬停预览：把目标格临时显示为候选颜色（不进撤销栈，移出弹窗/取消时还原）
function previewQuickColor(k) {
  const pc = App.pickerCell;
  const cand = App.pickerCandidates && App.pickerCandidates[k];
  if (!pc || !cand || !App.project) return;
  App.project.grid[pc.p] = cand.i;
  App.pickerPreviewIndex = k;
  scheduleRender();
}

// 还原悬停预览（移出弹窗或取消时调用）
function restoreQuickPickerPreview() {
  if (!App.pickerCell || App.pickerPreviewIndex == null) return;
  if (App.project) App.project.grid[App.pickerCell.p] = App.pickerCell.original;
  App.pickerPreviewIndex = null;
  scheduleRender();
}

function closeQuickPicker() {
  restoreQuickPickerPreview();
  App.pickerCell = null;
  els.quickPicker.classList.add('hidden');
  App.pickerCandidates = null;
}

// ---------------- 事务历史 ----------------

function saveTransaction() {
  if (!App.project) { toast('请先导入图片'); return; }
  const snapshot = {
    grid: Array.from(App.project.grid),
    width: App.project.width,
    height: App.project.height,
    paletteName: App.configName,
    palette: App.appliedPalette.map((c) => ({ ...c })),
    maxColors: App.maxColors,
  };
  const item = createTransaction(App.history, snapshot);
  setDirty(false);
  renderHistoryUI();
  toast(`已保存状态 #${item.id}（Ctrl+S）`);
  scheduleAutosave();
}

async function switchNode(id) {
  const node = findTransaction(App.history, id);
  if (!node) return;
  const snap = node.snapshot;
  App.project = { width: snap.width, height: snap.height, grid: Int16Array.from(snap.grid) };
  App.baseGrid = App.project.grid.slice();
  App.maxColors = snap.maxColors || C.countUsedColors(App.project.grid, snap.width, snap.height) || 2;
  App.sliderN = null;
  App.editedSinceSlider = false;
  App.history.currentId = id;
  // 切换到其它事务后，以该事务快照中的色板作为已应用色板渲染画布
  App.appliedPalette = (snap.palette || []).map((c) => ({ ...c }));
  // 切换到其它事务后，工作网格整体被替换，旧的单步记录不再有效
  resetProjectEditingState();

  const exists = snap.paletteName && App.configs.some((c) => c.name === snap.paletteName);
  if (exists) {
    try {
      const res = await api.getConfig(snap.paletteName);
      App.palette = res.colors;
      App.configName = res.name;
      els.configSelect.value = res.name;
      renderColorTable();
    } catch (e) {
      App.palette = (snap.palette || []).map((c) => ({ ...c }));
    }
  } else {
    App.palette = (snap.palette || []).map((c) => ({ ...c }));
  }
  renderBrushColorList();
  updateBrush();
  renderAll();
  renderHistoryUI();
  toast(`已切换到状态 #${id}`);
  scheduleAutosave();
}

function doDeleteNode(id) {
  const node = findTransaction(App.history, id);
  if (!node) return;
  if (!confirm(`确定删除事务「${node.label}」吗？此操作不可恢复。`)) return;
  const prev = App.history.currentId;
  const { newCurrent } = deleteTransaction(App.history, id);
  if (newCurrent != null && newCurrent !== prev) {
    switchNode(newCurrent);
  } else {
    if (prev === id) {
      // 删除了当前事务：工作网格失去锚点，单步记录一并清空
      App.undoStack = [];
      App.redoStack = [];
      App.strokeBuffer = null;
    }
    renderHistoryUI();
  }
  scheduleAutosave();
}

function clearAll() {
  if (!App.project && App.history.items.length === 0) { toast('当前没有可清空的内容'); return; }
  if (!confirm('确定要清空所有状态吗？\n将清空画布并删除全部事务历史，此操作不可恢复。')) return;
  App.project = null;
  App.baseGrid = null;
  App.compressed = null;
  App.originalFile = null;
  App.history = createEmptyHistory();
  App.maxColors = 2;
  App.sliderN = null;
  App.editedSinceSlider = false;
  resetProjectEditingState();
  renderHistoryUI();
  renderAll();
  scheduleAutosave();
  toast('已清空所有状态');
}

function renderHistoryUI() {
  const list = els.treeList;
  list.innerHTML = '';
  els.treeEmpty.style.display = App.history.items.length ? 'none' : '';
  // 扁平展示：没有子树，所有事务节点按保存顺序排列在同一层
  for (const item of App.history.items) list.appendChild(renderHistoryItem(item));
  updateUndoUI();
}

function renderHistoryItem(item) {
  const { id } = item;
  const div = document.createElement('div');
  div.className = 'tree-node' + (App.history.currentId === id ? ' current' : '');

  const head = document.createElement('div');
  head.className = 'tn-head';
  const label = document.createElement('span');
  label.className = 'tn-label';
  label.textContent = item.label;
  const time = document.createElement('span');
  time.className = 'tn-time';
  time.textContent = new Date(item.createdAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  head.append(label, time);

  const actions = document.createElement('div');
  actions.className = 'tn-actions';
  const del = document.createElement('button');
  del.textContent = '删除';
  del.title = '只删除该事务节点';
  del.addEventListener('click', (e) => { e.stopPropagation(); doDeleteNode(id); });
  actions.append(del);
  div.append(head, actions);

  div.addEventListener('click', () => {
    if (App.history.currentId !== id) switchNode(id);
  });
  return div;
}

// ---------------- 导出 ----------------

function buildExportData() {
  const counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  const n = App.project.width * App.project.height;
  const gridOut = new Int16Array(n);
  const codesOut = new Array(n).fill('');
  const hexMap = new Map();
  const paletteOut = [];
  for (let p = 0; p < n; p++) {
    const v = App.project.grid[p];
    if (v < 0) { gridOut[p] = -1; continue; }
    codesOut[p] = codeOf(App.appliedPalette[v]);
    const hex = App.appliedPalette[v] ? App.appliedPalette[v].hex : '#FFFFFF';
    let i = hexMap.get(hex);
    if (i == null) {
      i = paletteOut.length;
      hexMap.set(hex, i);
      paletteOut.push({ index: i, hex });
    }
    gridOut[p] = i;
  }
  const legend = buildLegend(counts);
  return { grid: Array.from(gridOut), palette: paletteOut, legend, codes: codesOut };
}

function openExportDialog() {
  if (!App.project) { toast('请先导入图片'); return; }
  els.dlgCodes.checked = App.settings.showCodes;
  els.exportDialog.classList.remove('hidden');
  renderExportPreview();
}

// 导出预览：用前端渲染器即时绘制一张小图（不经过后端，秒级响应）
function renderExportPreview() {
  if (!App.project) return;
  const counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  const legend = buildLegend(counts);
  const display = buildDisplayData();
  const cellSize = clampInt(els.dlgCell.value, EXPORT_CELL_MIN, EXPORT_CELL_MAX, EXPORT_CELL_DEFAULT);
  const pad = clampInt(els.dlgPad.value, 0, EXPORT_PAD_MAX, 0);
  const showLegend = els.dlgLegend.checked;
  const previewCell = EXPORT_PREVIEW_CELL;
  const previewPad = Math.round(pad * previewCell / cellSize);
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  drawPattern(octx, App.project.width, App.project.height, display.idx, display.rgb, {
    cell: previewCell,
    outerPad: previewPad,
    gridLines: els.dlgGrid.checked,
    hatch: true,
    emptyStyle: els.dlgEmptyStyle.value,
    edgeNumbers: els.dlgEdgeNumbers.checked,
    showCodes: els.dlgCodes.checked,
    codes: buildCodes(),
    legend: showLegend ? legend : [],
    showLegend,
    background: '#ffffff', // 导出预览以白底呈现（图例 / 外白边区域不透明）
  });
  const pv = els.dlgPreview;
  const scale = Math.min(EXPORT_PREVIEW_MAX_W / off.width, EXPORT_PREVIEW_MAX_H / off.height, 1);
  pv.width = Math.max(1, Math.round(off.width * scale));
  pv.height = Math.max(1, Math.round(off.height * scale));
  const pctx = pv.getContext('2d');
  pctx.clearRect(0, 0, pv.width, pv.height);
  pctx.drawImage(off, 0, 0, pv.width, pv.height);
}

async function doExport() {
  if (!App.project) return;
  const fmt = els.dlgFormat.value;
  const { grid, palette, legend, codes } = buildExportData();
  // 导出期间显示进度条并禁止操作导出界面
  els.dlgBusy.classList.remove('hidden');
  els.dlgStatus.textContent = '正在导出…';
  try {
    const res = await api.exportImage({
      width: App.project.width,
      height: App.project.height,
      grid,
      palette,
      legend,
      codes,
      options: {
        cellSize: clampInt(els.dlgCell.value, EXPORT_CELL_MIN, EXPORT_CELL_MAX, EXPORT_CELL_DEFAULT),
        gridLines: els.dlgGrid.checked,
        outerPad: clampInt(els.dlgPad.value, 0, EXPORT_PAD_MAX, 0),
        edgeNumbers: els.dlgEdgeNumbers.checked,
        showCodes: els.dlgCodes.checked,
        legend: els.dlgLegend.checked,
        format: fmt,
        quality: 95,
        emptyStyle: els.dlgEmptyStyle.value,
      },
    });
    downloadDataUrl(res.dataUrl, `拼豆图案.${fmt === 'png' ? 'png' : 'jpg'}`);
    els.dlgStatus.textContent = '导出完成';
    await new Promise((r) => setTimeout(r, 900)); // 稍作停留展示完成状态
    els.exportDialog.classList.add('hidden');
  } catch (err) {
    toast('导出失败：' + err.message);
  } finally {
    els.dlgBusy.classList.add('hidden');
  }
}

// ---------------- 使用问题修复（下拉菜单 + 文档弹窗） ----------------

const FIX_DOCS = {
  'right-drag-gesture-fix': '/static/docs/right-drag-gesture-fix.md',
};

// 极简 Markdown 渲染：仅覆盖文档用到的标题 / 列表 / 引用 / 加粗 / 行内代码 / 代码块
function renderMarkdown(md) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '';
  let list = null;
  let inCode = false;
  const codeBuf = [];
  const closeList = () => {
    if (list) { html += `</${list}>`; list = null; }
  };
  for (const raw of String(md).split(/\r?\n/)) {
    if (/^```/.test(raw)) {
      if (inCode) { html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; codeBuf.length = 0; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      continue;
    }
    const quote = raw.match(/^\s*>\s?(.*)/);
    if (quote) {
      closeList();
      if (quote[1].trim() !== '') html += `<blockquote><p>${inline(quote[1])}</p></blockquote>`;
      continue;
    }
    const ul = raw.match(/^\s*[-*]\s+(.*)/);
    if (ul) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }
    const ol = raw.match(/^\s*\d+[.、]\s+(.*)/);
    if (ol) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`;
      continue;
    }
    closeList();
    if (raw.trim() === '') continue;
    html += `<p>${inline(raw)}</p>`;
  }
  if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
  closeList();
  return html;
}

async function openFixDoc(key) {
  const url = FIX_DOCS[key];
  if (!url) return;
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (err) {
    els.docContent.textContent = '文档加载失败：' + err.message;
    els.docDialog.classList.remove('hidden');
    return;
  }
  els.docContent.innerHTML = renderMarkdown(text);
  els.docDialog.classList.remove('hidden');
}

function closeFixDoc() {
  els.docDialog.classList.add('hidden');
}

// ---------------- 日间 / 夜间模式 ----------------

const THEME_STORAGE_KEY = 'fuse-theme';

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.btnTheme.textContent = theme === 'dark' ? '☀ 日间模式' : '🌙 夜间模式';
  els.btnTheme.title = theme === 'dark' ? '当前为夜间模式，点击切换为日间' : '当前为日间模式，点击切换为夜间';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (e) {
    // localStorage 不可用时（如隐私模式）忽略，仅本次会话生效
  }
  if (App.project) redrawCanvas(); // 工作区四角颜色随主题重绘
  refreshCropMagnifier();
}

function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

// ---------------- 自动保存与恢复 ----------------

function buildStatePayload() {
  return {
    settings: {
      ...App.settings,
      targetPixels: Math.min(TARGET_PIXELS_MAX, parseInt(els.targetPixels.value, 10) || DEFAULT_TARGET_PIXELS),
    },
    project: App.project ? {
      width: App.project.width,
      height: App.project.height,
      grid: Array.from(App.project.grid),
      baseGrid: App.baseGrid ? Array.from(App.baseGrid) : null,
      sliderN: App.sliderN,
      editedSinceSlider: App.editedSinceSlider,
      paletteName: App.configName,
      palette: App.appliedPalette.map((c) => ({ ...c })),
      maxColors: App.maxColors,
    } : null,
    history: App.history,
  };
}

function scheduleAutosave() {
  clearTimeout(App.saveTimer);
  App.saveTimer = setTimeout(saveStateNow, AUTOSAVE_DELAY_MS);
}

async function saveStateNow() {
  try {
    await api.putState(buildStatePayload());
    els.autosave.textContent = '已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (err) {
    els.autosave.textContent = '自动保存失败';
  }
}

// 把持久化设置同步到 App 状态与界面控件
function applySettingsToControls() {
  App.brushSize = clampInt(App.settings.brushSize, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN);
  App.sameColorSelect = !!App.settings.sameColorSelect;
  els.sameColorChk.checked = App.sameColorSelect;
  els.targetPixels.value = App.settings.targetPixels;
  els.chkSharpen.checked = App.settings.sharpen;
  els.chkCodes.checked = App.settings.showCodes;
  els.selDistance.value = App.settings.useLab ? 'lab' : 'rgb';
  els.emptyStyle.value = ['default', 'black', 'white'].includes(App.settings.emptyStyle)
    ? App.settings.emptyStyle
    : 'default';
  // 对比/同步状态随设置持久化；原图从缓存恢复后再真正开启对比
  App.compareEnabled = !!App.settings.compare;
  App.syncPan = !!App.settings.syncPan;
  els.chkCompare.checked = App.compareEnabled;
  els.chkSyncPan.checked = App.syncPan;
  els.canvasScroll.classList.remove('compare-on');
}

// 恢复项目快照（画布、基副本、色板配置与已应用色板）
async function restoreProjectState(st) {
  if (!st.project) return;
  App.project = {
    width: st.project.width,
    height: st.project.height,
    grid: Int16Array.from(st.project.grid || []),
  };
  App.baseGrid = st.project.baseGrid
    ? Int16Array.from(st.project.baseGrid)
    : App.project.grid.slice();
  App.maxColors = st.project.maxColors || C.countUsedColors(App.project.grid, st.project.width, st.project.height) || 2;
  App.sliderN = st.project.sliderN ?? null;
  App.editedSinceSlider = !!st.project.editedSinceSlider;
  App.configName = st.project.paletteName || App.configName;
  // 已应用色板 = 上次保存/导入时画布所用的色板，画布与编辑工具按其显示
  App.appliedPalette = (st.project.palette && st.project.palette.length)
    ? st.project.palette.map((c) => ({ ...c }))
    : App.appliedPalette.map((c) => ({ ...c }));
  // 色板配置（可编辑）以磁盘上的配置为准；仅当配置不存在时回退到快照色板
  const configExists = App.configName && App.configs.some((c) => c.name === App.configName);
  if (configExists) {
    try {
      const res = await api.getConfig(App.configName);
      App.palette = res.colors;
    } catch (e) {
      // 保留已加载的配置色板
    }
  } else if (st.project.palette && st.project.palette.length) {
    App.palette = st.project.palette.map((c) => ({ ...c }));
  }
  els.configSelect.value = App.configName || '';
  renderColorTable();
  renderBrushColorList();
  updateBrush();
}

async function restoreState() {
  let st;
  try {
    st = await api.getState();
  } catch (e) {
    st = {};
  }
  if (st.settings) Object.assign(App.settings, st.settings);
  delete App.settings.outline; // 描边功能已移除
  applySettingsToControls();
  await restoreProjectState(st);
  App.history = sanitizeHistory(st.history);
  renderHistoryUI();
  renderAll();
  if (App.project) zoomFit();
  // 从浏览器缓存恢复原图：刷新后对比功能仍可用
  const originalRestored = await restoreOriginalFromCache();
  if (App.compareEnabled) {
    if (App.project && originalRestored) {
      setCompareEnabled(true, { silent: true });
    } else {
      App.compareEnabled = false;
      App.settings.compare = false;
      App.syncPan = false;
      App.settings.syncPan = false;
      els.chkCompare.checked = false;
      els.chkSyncPan.checked = false;
    }
  }
}

// ---------------- 画布交互（鼠标 / 滚轮） ----------------

function blurActive() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

// 右键拖拽平移（工作区 / 对比原图共用入口）
function startPanDrag(e, { orig = false } = {}) {
  dragState.active = true;
  dragState.orig = orig;
  dragState.moved = false;
  dragState.panning = !orig;
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.panStart = { ...App.pan };
  if (orig) dragState.origPanStart = { ...App.origPan };
  dragState.downCell = null; // 右键不参与选择/取色
  dragState.selectionAnchor = null;
  dragState.shift = false;
}

// 左键按下：进入选择 / 涂色 / 取色流程的公共初始状态
function startLeftDrag(e, cell) {
  dragState.active = true;
  dragState.moved = false;
  dragState.panning = false;
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.panStart = { ...App.pan };
  dragState.downCell = cell;
  dragState.selectionAnchor = null;
  dragState.shift = false;
}

// 一次交互结束后统一复位拖拽状态
function resetDragState() {
  App.dragSelect = null;
  dragState.active = false;
  dragState.cropEdge = null;
  dragState.orig = false;
  dragState.moved = false;
  dragState.panning = false;
  dragState.selectionAnchor = null;
  dragState.downCell = null;
  dragState.shift = false;
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
    if (!dragState.moved && Math.hypot(dx, dy) > 4) dragState.moved = true;
    if (dragState.moved) {
      if (App.syncPan) {
        App.pan = { x: dragState.panStart.x + dx, y: dragState.panStart.y + dy };
        App.origPan = { x: dragState.origPanStart.x + dx, y: dragState.origPanStart.y + dy };
      } else {
        App.origPan = { x: dragState.origPanStart.x + dx, y: dragState.origPanStart.y + dy };
      }
      applyOriginalTransform();
      if (App.syncPan) applyTransform();
      els.canvasOriginal.style.cursor = 'grabbing';
    }
    return;
  }
  if (!dragState.active || !App.project) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (!dragState.moved && Math.hypot(dx, dy) > 4) dragState.moved = true;
  if (dragState.moved && dragState.panning) {
    App.pan = { x: dragState.panStart.x + dx, y: dragState.panStart.y + dy };
    if (App.syncPan && App.originalImage) {
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
  if (App.tool === TOOLS.SELECT && dragState.moved && dragState.selectionAnchor && !App.sameColorSelect) {
    // 矩形拖选实时预览（裁剪到图案边界）
    const cell = cellFromEvent(e);
    if (!cell) return;
    const a = dragState.selectionAnchor;
    App.dragSelect = {
      x0: Math.min(a.x, cell.x), y0: Math.min(a.y, cell.y),
      x1: Math.max(a.x, cell.x), y1: Math.max(a.y, cell.y),
    };
    scheduleRender();
    return;
  }
  if (!App.painting) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (App.lastCell) strokeLine(App.lastCell, cell);
  App.lastCell = cell;
}

// 统一的 mousemove 入口：先更新 hover，再处理拖拽
function onWindowMouseMove(e) {
  if (App.tool === TOOLS.CROP) cropLastMouse = { clientX: e.clientX, clientY: e.clientY };
  updateHoverCell(e);
  updateDragMove(e);
  updateCropCursor(e);
  updateCropPreview(e);
  updateCropMagnifier(e);
}

function onWindowMouseUp() {
  if (dragState.active && !dragState.moved) {
    if (App.tool === TOOLS.SELECT && dragState.downCell) {
      // 选择模式：单击选中（同色选区勾选时选连通块）
      selectClick(dragState.downCell, dragState.shift);
    } else if (App.tool === TOOLS.PICKER && dragState.downCell) {
      applyPickerColor(dragState.downCell);
    }
  } else if (dragState.active && dragState.moved && App.tool === TOOLS.SELECT
    && dragState.selectionAnchor && App.dragSelect && !App.sameColorSelect) {
    // 选择模式：左键拖拽 = 矩形选区（Shift 追加并集）
    selectRect(App.dragSelect, dragState.shift);
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
    scheduleRender();
  }
  resetDragState();
}

function onCanvasScrollMouseDown(e) {
  if (!App.project) return;
  const inOrig = e.target && e.target.closest && e.target.closest('#compare-original');
  if (e.button === 2) {
    // 右键：工作区内任意位置拖拽平移（对比原图由自己的右键处理）
    e.preventDefault();
    if (inOrig) return;
    blurActive();
    if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
    startPanDrag(e);
    els.canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0 || inOrig) return;
  blurActive();
  const cell = cellFromEvent(e);
  e.preventDefault();
  if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
  startLeftDrag(e, cell);
  if (App.tool === TOOLS.CROP) {
    // 裁剪模式：选中/拖拽边，或按平行格线移动已选中的边
    handleCropMouseDown(e);
    return;
  }
  if (App.tool === TOOLS.SELECT) {
    // 选择模式：左键单击/拖拽选择区域（同色选区勾选时拖拽无效，仅单击）
    if (cell) {
      dragState.selectionAnchor = cell;
      dragState.shift = !!e.shiftKey;
      if (!e.shiftKey && !App.sameColorSelect && (App.selection.size || App.dragSelect)) {
        // 非 Shift 新选区开始时立即清空旧选区（Shift 追加并集则保留；同色选区拖拽无效不清空）
        App.selection = new Set();
        App.dragSelect = null;
        scheduleRender();
      }
    }
    return;
  }
  if (App.tool === TOOLS.BRUSH || App.tool === TOOLS.ERASER) {
    // 画笔 / 橡皮：从图案格开始连续涂色
    if (cell) {
      App.painting = true;
      App.lastCell = cell;
      // 一次按下到放开的全部像素修改记为一步
      App.strokeBuffer = [];
      paintStamp(cell);
    }
    return;
  }
  // 取色模式：单击在 mouseup 时取色
}

function onCompareMouseDown(e) {
  if (!App.project || !App.originalImage || !App.compareEnabled) return;
  if (e.button !== 2) return; // 对比原图同样改为右键拖拽
  e.preventDefault();
  blurActive();
  startPanDrag(e, { orig: true });
  els.canvasOriginal.style.cursor = 'grabbing';
}

function onCanvasScrollMouseLeave() {
  if (App.hoverCell != null) {
    App.hoverCell = null;
    scheduleCanvasRender();
  }
  hideCropMagnifier();
}

function onCanvasWheel(e) {
  if (!App.project) return;
  if (e.target && e.target.closest && e.target.closest('#compare-original')) return;
  if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR);
}

function onCompareWheel(e) {
  if (!App.project || !App.originalImage || !App.compareEnabled) return;
  e.preventDefault();
  e.stopPropagation();
  zoomAtOriginal(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR);
}

// ---------------- 事件绑定 ----------------

// 渲染「目标像素量」下拉预设项（带悬浮提示）
function renderTargetPixelOptions() {
  const menu = els.targetPixelsMenu;
  menu.innerHTML = '';
  TARGET_PIXEL_PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item';
    btn.dataset.value = String(p.value);
    btn.title = p.tip;
    btn.textContent = String(p.value);
    btn.addEventListener('click', () => {
      els.targetPixels.value = String(p.value);
      els.targetPixelsMenu.classList.add('hidden');
    });
    menu.appendChild(btn);
  });
}

function bindEvents() {
  bindPanelToggles();
  renderTargetPixelOptions();
  els.targetPixelsBtn.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    els.targetPixelsMenu.classList.toggle('hidden');
  });

  els.btnLogin.addEventListener('click', tryLogin);
  els.loginToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryLogin();
  });
  els.btnLogout.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch (e) { /* ignore */ }
    location.reload();
  });

  els.btnImport.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const f = els.fileInput.files[0];
    if (f) {
      App.originalFile = f;
      loadOriginalImage(f);
      processUpload();
    }
    els.fileInput.value = '';
  });
  els.btnRecompress.addEventListener('click', recompress);
  els.chkCompare.addEventListener('change', () => {
    setCompareEnabled(els.chkCompare.checked);
  });
  els.chkSyncPan.addEventListener('change', () => {
    setSyncPan(els.chkSyncPan.checked);
  });
  els.chkCodes.addEventListener('change', () => {
    App.settings.showCodes = els.chkCodes.checked;
    renderAll();
    scheduleAutosave();
  });
  els.selDistance.addEventListener('change', () => {
    const useLab = els.selDistance.value === 'lab';
    if (App.settings.useLab === useLab) return;
    // 颜色距离只保存设置，不立即重算；单击「重新压缩」后才按新算法生成图案
    App.settings.useLab = useLab;
    scheduleAutosave();
    hintDistanceDeferred();
  });

  els.colorSlider.addEventListener('input', () => {
    applySlider(parseInt(els.colorSlider.value, 10));
  });
  els.emptyStyle.addEventListener('change', () => {
    App.settings.emptyStyle = els.emptyStyle.value;
    redrawCanvas();
    scheduleAutosave();
  });

  els.btnExport.addEventListener('click', openExportDialog);
  els.dlgCancel.addEventListener('click', () => els.exportDialog.classList.add('hidden'));
  els.dlgOk.addEventListener('click', doExport);
  for (const [key, evt] of [
    ['dlgCell', 'input'], ['dlgPad', 'input'],
    ['dlgGrid', 'change'], ['dlgEdgeNumbers', 'change'], ['dlgCodes', 'change'], ['dlgLegend', 'change'],
    ['dlgEmptyStyle', 'change'], ['dlgFormat', 'change'],
  ]) {
    els[key].addEventListener(evt, renderExportPreview);
  }

  els.btnSaveStateSide.addEventListener('click', saveTransaction);
  els.btnClearAll.addEventListener('click', clearAll);
  els.btnUndo.addEventListener('click', doUndo);
  els.btnRedo.addEventListener('click', doRedo);
  els.btnFixMenu.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    els.fixMenu.classList.toggle('hidden');
  });
  els.fixItemGesture.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    openFixDoc('right-drag-gesture-fix');
  });
  els.docClose.addEventListener('click', closeFixDoc);
  els.btnTheme.addEventListener('click', toggleTheme);
  document.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    els.targetPixelsMenu.classList.add('hidden');
  });

  els.configSelect.addEventListener('change', () => {
    const name = els.configSelect.value;
    if (name) loadConfigDetail(name);
  });
  els.btnNewConfig.addEventListener('click', async () => {
    const name = prompt('新配置名称：');
    if (!name) return;
    const colors = App.palette.length
      ? App.palette.map((c) => ({ ...c }))
      : [{ index: 1, code: '001', name: '白色', hex: '#FFFFFF' }];
    try {
      await api.createConfig(name, colors);
      await selectAndLoad(name);
      toast(`已创建配置「${name}」`);
    } catch (err) {
      toast('创建失败：' + err.message);
    }
  });
  els.btnImportConfig.addEventListener('click', () => els.configFileInput.click());
  els.configFileInput.addEventListener('change', async () => {
    const f = els.configFileInput.files[0];
    els.configFileInput.value = '';
    if (!f) return;
    try {
      const res = await api.importConfig(f);
      await selectAndLoad(res.name);
      toast(`已导入配置「${res.name}」（${res.colors.length}色）`);
    } catch (err) {
      toast('导入失败：' + err.message);
    }
  });
  els.btnExportConfig.addEventListener('click', () => {
    if (!App.configName) return;
    downloadUrl('/api/configs/' + encodeURIComponent(App.configName) + '/export', App.configName + '.csv');
  });
  els.btnRenameConfig.addEventListener('click', async () => {
    if (!App.configName) return;
    const newName = prompt('新的配置名称：', App.configName);
    if (!newName || newName === App.configName) return;
    try {
      await api.renameConfig(App.configName, newName);
      await selectAndLoad(newName);
      toast('已重命名');
    } catch (err) {
      toast('重命名失败：' + err.message);
    }
  });
  els.btnDeleteConfig.addEventListener('click', async () => {
    if (!App.configName) return;
    if (App.configs.length <= 1) { toast('至少保留一个配置'); return; }
    if (!confirm(`确定删除配置「${App.configName}」吗？`)) return;
    try {
      await api.deleteConfig(App.configName);
      const remaining = App.configs.filter((c) => c.name !== App.configName);
      await selectAndLoad(remaining[0] ? remaining[0].name : null);
      toast('已删除配置');
    } catch (err) {
      toast('删除失败：' + err.message);
    }
  });
  els.btnAddColor.addEventListener('click', addColor);

  // 模式按钮：画笔 / 橡皮 / 取色互斥切换（画笔未选色时先取调色板最暗色）
  for (const [btnKey, tool] of [
    ['toolBrush', TOOLS.BRUSH],
    ['toolEraser', TOOLS.ERASER],
    ['toolPicker', TOOLS.PICKER],
    ['toolCrop', TOOLS.CROP],
  ]) {
    els[btnKey].addEventListener('click', () => {
      if (tool === TOOLS.BRUSH && !ensureBrushColor()) return;
      setTool(App.tool === tool ? TOOLS.SELECT : tool);
    });
  }
  els.btnAutoCrop.addEventListener('click', autoCrop);
  els.btnApplyCrop.addEventListener('click', applyCrop);
  els.sameColorChk.addEventListener('change', () => {
    App.sameColorSelect = els.sameColorChk.checked;
    App.settings.sameColorSelect = App.sameColorSelect;
    scheduleAutosave();
  });
  els.selectHighlightBtn.addEventListener('click', () => {
    // 选中高亮颜色：先取消当前选择，再选中该色号全部像素，并取消高亮显示
    if (App.highlightColor == null || !App.project) return;
    const color = App.highlightColor;
    const { grid } = App.project;
    const next = new Set();
    for (let p = 0; p < grid.length; p++) {
      if (grid[p] === color) next.add(p);
    }
    App.selection = next;
    App.dragSelect = null;
    App.highlightColor = null;
    renderAll();
  });
  els.brushSize.addEventListener('input', () => {
    App.brushSize = clampInt(els.brushSize.value, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN);
    App.settings.brushSize = App.brushSize;
    updateModeControls();
    scheduleRender();
    scheduleAutosave();
  });

  // 缩放按钮：围绕工作区中心缩放
  for (const [btnKey, factor] of [
    ['zoomIn', ZOOM_BUTTON_FACTOR],
    ['zoomOut', 1 / ZOOM_BUTTON_FACTOR],
  ]) {
    els[btnKey].addEventListener('click', () => {
      const vp = els.canvasScroll;
      const r = vp.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    });
  }
  els.zoomFit.addEventListener('click', zoomFit);

  els.canvasScroll.addEventListener('mousedown', onCanvasScrollMouseDown);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  els.canvasScroll.addEventListener('mouseleave', onCanvasScrollMouseLeave);
  // 九宫格：鼠标移出弹窗时还原悬停预览的颜色
  els.quickPicker.addEventListener('mouseleave', restoreQuickPickerPreview);
  // 全域禁用右键菜单：工具不需要右键菜单，避免拖拽结束时在菜单栏等位置弹出
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  els.canvasScroll.addEventListener('wheel', onCanvasWheel, { passive: false });
  els.compareOriginal.addEventListener('mousedown', onCompareMouseDown);
  els.compareOriginal.addEventListener('wheel', onCompareWheel, { passive: false });

  document.querySelectorAll('.tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs .tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $('tab-palette').classList.toggle('hidden', tab !== 'palette');
      $('tab-edit').classList.toggle('hidden', tab !== 'edit');
    });
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!els.docDialog.classList.contains('hidden')) {
        closeFixDoc();
        e.preventDefault();
        return;
      }
      if (!els.fixMenu.classList.contains('hidden')) {
        els.fixMenu.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!els.targetPixelsMenu.classList.contains('hidden')) {
        els.targetPixelsMenu.classList.add('hidden');
        e.preventDefault();
        return;
      }
    }
    // Ctrl+S 与 Ctrl+Z/Y 同样遵循焦点守卫：输入框内不拦截浏览器快捷键
    if (mod && e.key.toLowerCase() === 's' && !inField) {
      e.preventDefault();
      saveTransaction();
      return;
    }
    if (inField) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      doUndo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
      return;
    }
    const pickerOpen = !els.quickPicker.classList.contains('hidden');
    if (pickerOpen) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= QUICK_PICKER_MAX && App.pickerCandidates && App.pickerCandidates[n - 1]) {
        e.preventDefault();
        applyQuickColor(n - 1);
      } else if (e.key === 'Escape') {
        closeQuickPicker();
      }
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'q') { e.preventDefault(); switchToolShortcut(TOOLS.BRUSH); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'w') { e.preventDefault(); switchToolShortcut(TOOLS.PICKER); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'e') { e.preventDefault(); switchToolShortcut(TOOLS.ERASER); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'r') { e.preventDefault(); switchToolShortcut(TOOLS.CROP); return; }
    if (e.key === 'Delete') { e.preventDefault(); clearSelectionToEmpty(); return; }
    if (e.key.toLowerCase() === 'd' && App.tool === TOOLS.SELECT && App.project && !dragState.active) {
      // 单选一格时作用于选中格，否则作用于当前悬停格（拖拽中忽略）
      let target = null;
      if (App.selection.size === 1) {
        const p = App.selection.values().next().value;
        target = { x: p % App.project.width, y: (p / App.project.width) | 0 };
      } else if (App.hoverCell) {
        target = App.hoverCell;
      }
      if (target) {
        e.preventDefault();
        openQuickPicker(target);
      }
    } else if (e.key === 'Escape') {
      closeQuickPicker();
      if (App.tool !== TOOLS.SELECT) setTool(TOOLS.SELECT);
      else clearSelection();
    }
  });
}

// ---------------- 裁剪工具 ----------------

// 进入裁剪模式：初始矩形 = 整张图
function initCropRect() {
  if (!App.project) return;
  App.crop = { x0: 0, y0: 0, x1: App.project.width - 1, y1: App.project.height - 1 };
  App.cropActiveEdge = null;
  App.cropPreview = null;
}

function hideCropMagnifier() {
  if (!els.cropMagnifier.classList.contains('hidden')) els.cropMagnifier.classList.add('hidden');
}

// 事件坐标 → 画布内连续格坐标（horizontal=true 取横向 x，否则取纵向 y）
function cropPosFromEvent(e, horizontal) {
  const rect = els.canvas.getBoundingClientRect();
  const scale = rect.width / els.canvas.width;
  const cell = App.screenCell;
  const px = (e.clientX - rect.left) / scale;
  const py = (e.clientY - rect.top) / scale;
  return (horizontal ? px : py) / cell - CANVAS_EDGE_CELLS;
}

// 命中检测：鼠标是否靠近某条边（屏幕像素阈值内）
function cropEdgeAt(e) {
  if (!App.project || !App.crop) return null;
  const rect = els.canvas.getBoundingClientRect();
  const scale = rect.width / els.canvas.width;
  const cell = App.screenCell;
  const px = (e.clientX - rect.left) / scale;
  const py = (e.clientY - rect.top) / scale;
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
function moveCropEdgeTo(edge, pos) {
  if (!App.project || !App.crop) return;
  const c = App.crop;
  const w = App.project.width;
  const h = App.project.height;
  const v = Math.round(pos);
  if (edge === 'left') c.x0 = clampInt(v, 0, c.x1);
  else if (edge === 'right') c.x1 = clampInt(v - 1, c.x0, w - 1);
  else if (edge === 'top') c.y0 = clampInt(v, 0, c.y1);
  else if (edge === 'bottom') c.y1 = clampInt(v - 1, c.y0, h - 1);
  scheduleRender();
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
  const rect = els.canvas.getBoundingClientRect();
  const scale = rect.width / els.canvas.width;
  const cell = App.screenCell;
  const px = (e.clientX - rect.left) / scale;
  const py = (e.clientY - rect.top) / scale;
  const totalW = (App.project.width + 2 * CANVAS_EDGE_CELLS) * cell;
  const totalH = (App.project.height + 2 * CANVAS_EDGE_CELLS) * cell;
  return px >= -2 && py >= -2 && px <= totalW + 2 && py <= totalH + 2;
}

function handleCropMouseDown(e) {
  if (!App.project || !App.crop) return;
  if (!isInCropArea(e)) {
    // 图片之外：取消当前边选择，不修改位置
    if (App.cropActiveEdge != null) {
      App.cropActiveEdge = null;
      App.cropPreview = null;
      scheduleRender();
    }
    return;
  }
  // 1) 点中某条边：选中并进入拖拽
  const edge = cropEdgeAt(e);
  if (edge) {
    App.cropActiveEdge = edge;
    dragState.cropEdge = edge;
    App.cropPreview = null;
    scheduleRender();
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
function updateCropEdgeDrag(e) {
  const edge = dragState.cropEdge;
  if (!edge || !App.crop) return;
  const horizontal = edge === 'left' || edge === 'right';
  moveCropEdgeTo(edge, cropPosFromEvent(e, horizontal));
}

// 裁剪模式鼠标：边命中或已选中边时显示调整光标（上下/左右双箭头）
function updateCropCursor(e) {
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
function updateCropPreview(e) {
  const active = App.tool === TOOLS.CROP && App.project && App.crop
    && App.cropActiveEdge && !dragState.cropEdge && isInCropArea(e);
  if (!active) return; // 图片之外：保留当前预览位置，不更新也不清除
  const horizontal = App.cropActiveEdge === 'left' || App.cropActiveEdge === 'right';
  const pos = Math.round(cropPosFromEvent(e, horizontal));
  const maxPos = horizontal ? App.project.width : App.project.height;
  const clamped = clampInt(pos, 0, maxPos);
  if (!App.cropPreview || App.cropPreview.horizontal !== horizontal || App.cropPreview.pos !== clamped) {
    App.cropPreview = { horizontal, pos: clamped };
    scheduleRender();
  }
}

// 自动裁剪：外框收缩到非空格的包围盒（再缩一行/一列就会出现空格）
function autoCrop() {
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
  scheduleRender();
}

// 应用裁剪：记录结构型撤销步骤 + 裁剪前事务快照，然后切换尺寸
function applyCrop() {
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
  item.label = `裁剪前 ${before.width}×${before.height}`;
  // 单步撤销：结构型步骤（旧增量步骤因坐标失效被清空）
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
  renderAll();
  zoomFit();
  setDirty(true);
  scheduleAutosave();
  toast(`已裁剪为 ${w} × ${h}`);
}

// 放大镜：低缩放下显示鼠标悬停位置 10×10 的放大视图
function drawCropMagnifier() {
  const canvas = els.cropMagnifierCanvas;
  const n = CROP_MAGNIFIER_SIZE;
  // 放大后每格尺寸 = 当前屏幕格宽 × 倍率（至少 16px，保证可见）
  const cell = Math.max(16, Math.round(App.screenCell * App.zoom * CROP_MAGNIFIER_SCALE));
  canvas.width = n * cell;
  canvas.height = n * cell;
  const ctx2 = canvas.getContext('2d');
  const { grid, width, height } = App.project;
  const hx = App.hoverCell.x;
  const hy = App.hoverCell.y;
  const dark = document.documentElement.dataset.theme === 'dark';
  const outsideColor = dark ? '#3a424c' : '#e8eaee';
  // 始终以鼠标悬停格为中心（不夹紧到图案边界），边缘处可看到行列号条与外部区域
  const off = Math.floor((n - 1) / 2);
  const x0 = hx - off;
  const y0 = hy - off;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const gx = x0 + c;
      const gy = y0 + r;
      const px0 = c * cell;
      const py0 = r * cell;
      if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
        // 图案内：豆色 / 空位
        const v = grid[gy * width + gx];
        if (v >= 0) {
          ctx2.fillStyle = App.appliedPalette[v] ? App.appliedPalette[v].hex : '#ffffff';
          ctx2.fillRect(px0, py0, cell, cell);
        } else {
          ctx2.fillStyle = '#e8eaee';
          ctx2.fillRect(px0, py0, cell, cell);
          ctx2.strokeStyle = '#9aa4b0';
          ctx2.beginPath();
          ctx2.moveTo(px0, py0 + cell);
          ctx2.lineTo(px0 + cell, py0);
          ctx2.stroke();
        }
        ctx2.strokeStyle = '#c9ced6';
        ctx2.lineWidth = 1;
        ctx2.strokeRect(px0 + 0.5, py0 + 0.5, cell - 1, cell - 1);
      } else if (((gx === -1 || gx === width) && gy >= 0 && gy < height)
        || ((gy === -1 || gy === height) && gx >= 0 && gx < width)) {
        // 行列号条：仅环绕图案的一圈（超出图案的行列不再延伸）
        ctx2.fillStyle = '#d6e6f7';
        ctx2.fillRect(px0, py0, cell, cell);
        let label = '';
        if (gy >= 0 && gy < height && (gx === -1 || gx === width)) label = String(gy + 1);
        if (gx >= 0 && gx < width && (gy === -1 || gy === height)) label = String(gx + 1);
        if (label) {
          ctx2.fillStyle = '#000000';
          ctx2.font = `${Math.max(8, Math.round(cell * 0.5))}px Consolas, monospace`;
          ctx2.fillText(label, px0 + cell / 2, py0 + cell / 2);
        }
      } else {
        // 图案之外（含四角）：夜间用 UI 灰色，日间用浅灰
        ctx2.fillStyle = outsideColor;
        ctx2.fillRect(px0, py0, cell, cell);
      }
    }
  }
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
      ctx2.strokeStyle = name === App.cropActiveEdge ? '#3b82f6' : '#ff3b30';
      ctx2.beginPath();
      ctx2.moveTo(ex0, ey0);
      ctx2.lineTo(ex1, ey1);
      ctx2.stroke();
    }
    if (App.cropPreview && !dragState.cropEdge) {
      ctx2.strokeStyle = '#ff3b30';
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
  const pad = 16;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  if (left + w > (window.innerWidth || 0) - 8) left = e.clientX - w - pad;
  if (top + h > (window.innerHeight || 0) - 8) top = e.clientY - h - pad;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function updateCropMagnifier(e) {
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

// 缩放 / 主题变化后重新评估放大镜是否显示并重绘
function refreshCropMagnifier() {
  if (cropLastMouse) updateCropMagnifier(cropLastMouse);
  else hideCropMagnifier();
}

function setTool(t) {
  if (App.tool === t) return;
  if (t === TOOLS.CROP && !App.project) {
    toast('请先导入图片');
    return;
  }
  // 离开裁剪模式：丢弃未应用的裁剪
  if (App.tool === TOOLS.CROP && t !== TOOLS.CROP) {
    App.crop = null;
    App.cropActiveEdge = null;
    App.cropPreview = null;
    hideCropMagnifier();
  }
  App.tool = t;
  els.toolBrush.classList.toggle('active', t === TOOLS.BRUSH);
  els.toolPicker.classList.toggle('active', t === TOOLS.PICKER);
  els.toolEraser.classList.toggle('active', t === TOOLS.ERASER);
  els.toolCrop.classList.toggle('active', t === TOOLS.CROP);
  els.canvas.classList.toggle('mode-brush', t === TOOLS.BRUSH);
  els.canvas.classList.toggle('mode-picker', t === TOOLS.PICKER);
  els.canvas.classList.toggle('mode-eraser', t === TOOLS.ERASER);
  els.canvas.classList.toggle('mode-crop', t === TOOLS.CROP);
  if (t === TOOLS.BRUSH || t === TOOLS.ERASER) {
    // 画笔 / 橡皮模式下选区没有意义，进入时清空；色号高亮保留
    App.selection = new Set();
    App.dragSelect = null;
  }
  if (t === TOOLS.CROP) {
    // 裁剪模式：清空选区，初始矩形 = 整图
    App.selection = new Set();
    App.dragSelect = null;
    initCropRect();
  }
  document.body.classList.toggle('crop-active', t === TOOLS.CROP);
  // 切换工具后立即重绘，让 hover 边框样式随之更新
  redrawCanvas();
  updateModeControls();
  els.modeLabel.textContent = t === TOOLS.BRUSH ? '画笔模式'
    : t === TOOLS.ERASER ? '橡皮模式'
      : t === TOOLS.PICKER ? '取色模式'
        : t === TOOLS.CROP ? '裁剪模式' : '选择模式';
}

// ---------------- 启动 ----------------

// 启动时校验关键 DOM 元素，缺失时立即报错，避免运行到一半才崩溃
function assertElements() {
  const missing = Object.entries(els)
    .filter(([, el]) => !el)
    .map(([k]) => k);
  if (missing.length) throw new Error('缺少页面元素：' + missing.join(', '));
}

async function init() {
  assertElements();
  applyPanelPrefs();
  applyTheme(currentTheme());
  bindEvents();
  await ensureAuth();
  try {
    await loadConfigs();
  } catch (e) {
    console.error('配置加载失败：', e);
    toast('配置加载失败：' + e.message);
  }
  try {
    await restoreState();
  } catch (e) {
    console.error('状态恢复失败：', e);
    toast('状态恢复失败：' + e.message);
  }
  renderAll();
  renderHistoryUI();
}

init();

// 调试 / 自动化测试句柄：仅在 URL 带 ?test=1 或预置 __FUSE_TEST__ 全局标记时暴露，
// 避免生产页面被任意脚本读取内部状态
const exposeTestHooks = (
  (typeof window !== 'undefined' && window.__FUSE_TEST__ === true)
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test'))
);
if (exposeTestHooks) {
  window.__app = App;
  window.__dragState = dragState;

  // 自动化测试用：暴露需要直接驱动的内部函数
  window.__testHooks = {
    renderAll,
    redrawCanvas,
    drawPattern,
    setTool,
    updateBrush,
    paintCell,
    paintStamp,
    applyQuickColor,
    doUndo,
    doRedo,
    openFixDoc,
    closeFixDoc,
    toggleTheme,
    recordCropStep,
    moveCropEdgeTo,
    updateCropCursor,
    updateCropPreview,
    autoCrop,
    applyCrop,
    updateCropMagnifier,
    applySlider,
    saveTransaction,
    switchNode,
    doDeleteNode,
    clearAll,
    restoreState,
    renderHistoryUI,
    openExportDialog,
    renderExportPreview,
    mirrorBeadToOrig,
    mirrorOrigToBead,
  };
}
