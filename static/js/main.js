import * as api from './api.js';
import * as C from './colors.js';
import { drawPattern, clearCanvas, CELL, canvasMetrics } from './render.js';
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
  MAX_UNDO_STEPS,
} from './history.js';

const $ = (id) => document.getElementById(id);

const els = {
  toast: $('toast'),
  fileInput: $('file-input'),
  btnImport: $('btn-import'),
  targetPixels: $('target-pixels'),
  btnRecompress: $('btn-recompress'),
  chkSharpen: $('chk-sharpen'),
  chkCodes: $('chk-codes'),
  selDistance: $('sel-distance'),
  btnExport: $('btn-export'),
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
  modeLabel: $('mode-label'),
  brushSwatch: $('brush-swatch'),
  brushLabel: $('brush-label'),
  colorList: $('color-list'),
  canvas: $('canvas'),
  canvasScroll: $('canvas-scroll'),
  emptyHint: $('empty-hint'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  zoomFit: $('zoom-fit'),
  zoomLabel: $('zoom-label'),
  cellInfo: $('cell-info'),
  quickPicker: $('quick-picker'),
  highlightColorList: $('highlight-color-list'),
  treeList: $('tree-list'),
  treeEmpty: $('tree-empty'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
  undoInfo: $('undo-info'),
  exportDialog: $('export-dialog'),
  dlgCell: $('dlg-cell-size'),
  dlgGrid: $('dlg-grid-lines'),
  dlgPad: $('dlg-pad'),
  dlgCodes: $('dlg-codes'),
  dlgLegend: $('dlg-legend'),
  dlgEmptyStyle: $('dlg-empty-style'),
  dlgFormat: $('dlg-format'),
  dlgOk: $('dlg-export-ok'),
  dlgCancel: $('dlg-export-cancel'),
  dlgPreview: $('dlg-preview'),
  dirtyIndicator: $('dirty-indicator'),
  loginMask: $('login-mask'),
  loginToken: $('login-token'),
  btnLogin: $('btn-login'),
  loginError: $('login-error'),
};

const ctx = els.canvas.getContext('2d');

const App = {
  configs: [],
  configName: null,
  palette: [],          // 色板配置（可编辑，重新压缩时才应用到画布）
  appliedPalette: [],   // 已应用色板：当前画布与编辑工具显示所用，重新压缩/导入时更新
  project: null,       // { width, height, grid: Int16Array }
  compressed: null,    // { rgba, width, height }
  originalFile: null,
  maxColors: 2,
  baseGrid: null,
  sliderN: null,
  editedSinceSlider: false,
  brushColor: null,    // 未选择颜色
  tool: 'drag',        // drag（拖拽）/ brush（画笔）/ eraser（橡皮）
  selectedCell: null,
  painting: false,
  lastCell: null,
  pan: { x: 0, y: 0 },
  history: createEmptyHistory(),
  undoStack: [],
  redoStack: [],
  strokeBuffer: null,  // 一次画笔/橡皮按下到放开过程中累积的像素修改
  settings: { targetPixels: 40000, useLab: true, sharpen: true, showCodes: true, emptyStyle: 'default' },
  dirty: false,
  zoom: 1,
  screenCell: CELL,
  highlightBlink: true,
  highlightTimer: null,
  pickerCandidates: null,
  highlightColor: null,
  saveTimer: null,
  configTimer: null,
};

let renderQueued = false;
let toastTimer = null;
let authResolve = null;
const dragState = {
  active: false,
  moved: false,
  panning: false,
  startX: 0,
  startY: 0,
  panStart: null,
  downCell: null,
};

// ---------------- 基础工具 ----------------

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

let paletteHintShownAt = 0;

// 色板配置修改后不即时生效：弹出一次性提示，3 秒内不重复打扰
function hintPaletteDeferred() {
  const now = Date.now();
  if (now - paletteHintShownAt < 3000) return;
  paletteHintShownAt = now;
  toast('色板配置修改后需单击「重新压缩」才会应用到画布');
}

function setBusy(b) {
  document.body.classList.toggle('busy', b);
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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

function chooseScreenCell(width, height) {
  let cell = CELL;
  const MAX_DIM = 28000, MAX_AREA = 80000000;
  const ok = (c) => {
    const { w, h } = canvasMetrics(width, height, c, 0);
    return w <= MAX_DIM && h <= MAX_DIM && w * h <= MAX_AREA;
  };
  while (cell > 2 && !ok(cell)) cell = Math.max(2, Math.floor(cell / 2));
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
      legend.push({ hex: c.hex, code: c.code || String(c.index), count: counts[i] });
    }
  });
  // 按豆数量从多到少排序，数量相同按编号
  legend.sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return legend;
}

function distinctCount(grid, width, height) {
  const set = new Set();
  for (let p = 0; p < width * height; p++) {
    const v = grid[p];
    if (v >= 0) set.add(v);
  }
  return set.size;
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
  const baseUsed = App.baseGrid ? distinctCount(App.baseGrid, App.project.width, App.project.height) : 0;
  const hasHistory = App.history.items.length > 0 || App.undoStack.length > 0 || App.redoStack.length > 0;
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

function buildCodes() {
  const { grid, width, height } = App.project;
  const codes = new Array(width * height).fill('');
  for (let p = 0; p < grid.length; p++) {
    const v = grid[p];
    if (v >= 0 && App.appliedPalette[v]) {
      codes[p] = App.appliedPalette[v].code || String(App.appliedPalette[v].index);
    }
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
    return;
  }
  const counts = C.computeUsedCounts(project.grid, project.width, project.height);
  let used = 0;
  for (const c of counts) if (c > 0) used++;
  const baseUsed = App.baseGrid ? distinctCount(App.baseGrid, project.width, project.height) : used;
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
  renderColorList(counts);
  renderHighlightColorList(counts);
  syncHighlightBlink();
}

function redrawCanvas() {
  const project = App.project;
  if (!project) return;
  const display = buildDisplayData();

  App.screenCell = chooseScreenCell(project.width, project.height);
  drawPattern(ctx, project.width, project.height, display.idx, display.rgb, {
    cell: App.screenCell,
    outerPad: 0, // 工作区不再保留纯白边距，图例只在导出时显示
    gridLines: true,
    hatch: true,
    emptyStyle: App.settings.emptyStyle,
    showCodes: App.settings.showCodes,
    codes: buildCodes(),
    selected: App.selectedCell,
    highlightColor: App.highlightColor,
    highlightBlink: App.highlightBlink,
  });
  applyTransform();
}

// 颜色清单高亮闪烁：高亮时按周期隐现，反色不明显也能看清选中色号
function syncHighlightBlink() {
  clearInterval(App.highlightTimer);
  App.highlightTimer = null;
  if (App.highlightColor == null || !App.project) {
    App.highlightBlink = true;
    return;
  }
  App.highlightTimer = setInterval(() => {
    App.highlightBlink = !App.highlightBlink;
    redrawCanvas();
  }, 500);
}

function applyTransform() {
  els.canvas.style.transform = `translate(${App.pan.x}px, ${App.pan.y}px) scale(${App.zoom})`;
  els.zoomLabel.textContent = Math.round(App.zoom * 100) + '%';
}

function zoomFit() {
  if (!App.project) return;
  const vw = els.canvasScroll.clientWidth;
  const vh = els.canvasScroll.clientHeight;
  const cw = els.canvas.width;
  const ch = els.canvas.height;
  if (!cw || !ch) return;
  const z = Math.min((vw - 24) / cw, (vh - 24) / ch, 1.5);
  App.zoom = Math.max(0.05, z);
  App.pan = { x: (vw - cw * App.zoom) / 2, y: (vh - ch * App.zoom) / 2 };
  applyTransform();
}

function zoomAt(clientX, clientY, factor) {
  if (!App.project) return;
  const rect = els.canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const stageLeft = rect.left - App.pan.x;
  const stageTop = rect.top - App.pan.y;
  const oldZ = App.zoom;
  const newZ = Math.min(8, Math.max(0.05, oldZ * factor));
  const bx = (clientX - rect.left) / oldZ;
  const by = (clientY - rect.top) / oldZ;
  App.zoom = newZ;
  App.pan = { x: clientX - stageLeft - bx * newZ, y: clientY - stageTop - by * newZ };
  applyTransform();
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
  }, 500);
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
  els.brushLabel.textContent = `${c.name || ''} ${c.code || ''} ${c.hex}`.trim();
}

function renderColorList(counts) {
  if (!counts && App.project) {
    counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  }
  const list = els.colorList;
  list.innerHTML = '';
  App.appliedPalette.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'color-item' + (App.brushColor === i ? ' selected' : '');
    item.title = `${c.name || ''} ${c.code || ''} ${c.hex}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    const codeLabel = document.createElement('span');
    codeLabel.className = 'ci-code';
    codeLabel.textContent = c.code || String(c.index);
    const rgb = C.hexToRgb(c.hex);
    codeLabel.style.color = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 150 ? '#111111' : '#FFFFFF';
    sw.appendChild(codeLabel);
    const count = document.createElement('span');
    count.className = 'ci-count';
    count.textContent = counts && counts[i] ? `×${counts[i]}` : '';
    item.append(sw, count);
    item.addEventListener('click', () => {
      App.brushColor = i;
      setTool('brush');
      updateBrush();
      renderColorList();
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
    item.title = `${c.name || ''} ${c.code || ''} ${c.hex} ×${count}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    const code = document.createElement('span');
    code.className = 'hc-code';
    code.textContent = c.code || String(c.index);
    const cnt = document.createElement('span');
    cnt.className = 'hc-count';
    cnt.textContent = `×${count}`;
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
  if (confirmHistory && (App.history.items.length || App.undoStack.length || App.redoStack.length)) {
    if (!confirm('导入图片将清空全部事务历史与撤销记录。是否继续？')) return;
    clearHistoryRecords();
    renderHistoryUI();
  }
  setBusy(true);
  try {
    const target = parseInt(els.targetPixels.value, 10) || 40000;
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
    const counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
    let used = 0;
    for (const c of counts) if (c > 0) used++;
    toast(`已导入 ${res.width} × ${res.height}，共使用 ${used} 种颜色`);
  } catch (err) {
    toast('导入失败：' + err.message);
  } finally {
    setBusy(false);
  }
}

function applyMapping() {
  if (!App.compressed) return;
  const isNew = !App.project;
  const { rgba, width, height } = App.compressed;
  const { grid, counts } = C.computeInitialMapping(rgba, width, height, App.palette, App.settings.useLab);
  App.project = { width, height, grid };
  App.baseGrid = grid.slice();
  // 重新压缩/导入后，当前色板配置成为已应用色板（画布与编辑工具随之更新）
  App.appliedPalette = App.palette.map((c) => ({ ...c }));
  App.selectedCell = null;
  App.highlightColor = null;
  let used = 0;
  for (const c of counts) if (c > 0) used++;
  App.maxColors = Math.max(2, used);
  App.sliderN = null;
  App.editedSinceSlider = false;
  App.undoStack = [];
  App.redoStack = [];
  App.strokeBuffer = null;
  setDirty(false);
  renderAll();
  if (isNew) zoomFit();
  scheduleAutosave();
}

async function recompress() {
  if (!App.originalFile) { toast('请先导入图片'); return; }
  if (App.project && App.dirty) {
    if (!confirm('重新压缩将按新设置重新生成图案，并丢弃画布上的手动修改。是否继续？')) return;
  }
  if (App.history.items.length || App.undoStack.length || App.redoStack.length) {
    if (!confirm('重新压缩将清空全部事务历史与撤销记录。是否继续？')) return;
    clearHistoryRecords();
    renderHistoryUI();
  }
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
  const x = gx - 5;
  const y = gy - 5;
  // 四周 5 格为灰色 X 边距，属于图片但不可改色
  if (x < 0 || y < 0 || x >= App.project.width || y >= App.project.height) return null;
  return { x, y };
}

function paintCell(x, y) {
  const { grid, width } = App.project;
  const p = y * width + x;
  const v = App.tool === 'eraser' ? -1 : (App.brushColor != null ? App.brushColor : -2);
  if (v === -2) return; // 未选择颜色
  if (grid[p] === v) return null;
  const from = grid[p];
  grid[p] = v;
  setDirty(true);
  App.editedSinceSlider = true;
  if (App.strokeBuffer) App.strokeBuffer.push({ x, y, from, to: v });
  scheduleRender();
  scheduleAutosave();
  return { x, y, from, to: v };
}

// ---------------- 单步撤销 / 重做 ----------------

function doUndo() {
  if (!App.project) return;
  const step = undoStep(App.undoStack, App.redoStack);
  if (!step) return;
  applyStepToGrid(App.project.grid, App.project.width, step.changes, 'undo');
  setDirty(true);
  App.editedSinceSlider = true;
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
  toast(`已撤销（剩余 ${App.undoStack.length} 步）`);
}

function doRedo() {
  if (!App.project) return;
  const step = redoStep(App.undoStack, App.redoStack);
  if (!step) return;
  applyStepToGrid(App.project.grid, App.project.width, step.changes, 'redo');
  setDirty(true);
  App.editedSinceSlider = true;
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
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

function pickColorFromCell(cell) {
  const v = App.project.grid[cell.y * App.project.width + cell.x];
  if (v < 0) {
    toast('该位置是空位，无法取色');
    return;
  }
  App.brushColor = v;
  updateBrush();
  renderColorList();
  setTool('brush'); // 取色后自动切换为画笔模式
}

function strokeLine(a, b) {
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    paintCell(x0, y0);
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

// ---------------- D 键快速选色 ----------------

function openQuickPicker(cell) {
  if (!App.appliedPalette.length) return;
  const { grid, width, height } = App.project;
  const p = cell.y * width + cell.x;
  const own = grid[p];
  const exclude = new Set(own >= 0 ? [own] : []);
  // 1) 先取周围一圈 8 个格子的颜色（去重）
  const candSet = new Set();
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
    const nx = cell.x + dx;
    const ny = cell.y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const v = grid[ny * width + nx];
    if (v >= 0 && !exclude.has(v)) candSet.add(v);
  }
  const list = [...candSet];
  // 2) 不足 9 个时，用与当前颜色最相近的颜色补齐
  if (list.length < 9) {
    const baseHex = own >= 0 && App.appliedPalette[own]
      ? App.appliedPalette[own].hex
      : (App.brushColor != null && App.appliedPalette[App.brushColor] ? App.appliedPalette[App.brushColor].hex : '#FFFFFF');
    const baseRgb = C.hexToRgb(baseHex);
    const scored = App.appliedPalette
      .map((c, i) => ({ i, d: C.colorDist2(baseRgb, C.hexToRgb(c.hex), App.settings.useLab) }))
      .filter((s) => !list.includes(s.i) && !exclude.has(s.i))
      .sort((a, b) => a.d - b.d);
    for (const s of scored) {
      if (list.length >= 9) break;
      list.push(s.i);
    }
  }
  const scored = list.slice(0, 9).map((i) => ({ i }));
  App.pickerCandidates = scored;
  const usedCounts = C.computeUsedCounts(grid, width, height);

  const box = els.quickPicker;
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'qp-title';
  title.textContent = '相近颜色（按 1-9 选择）';
  box.appendChild(title);
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
    code.textContent = c.code || String(c.index);
    code.style.color = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 150 ? '#111111' : '#FFFFFF';
    const cnt = document.createElement('span');
    cnt.className = 'qp-count';
    cnt.textContent = usedCounts[scored[k].i] ? `×${usedCounts[scored[k].i]}` : '';
    cnt.style.color = code.style.color;
    btn.appendChild(code);
    btn.appendChild(cnt);
    btn.title = `${c.name || ''} ${c.code || ''} ${c.hex}`;
    btn.addEventListener('click', () => pickQuickColor(k));
    box.appendChild(btn);
  }
  const cancel = document.createElement('button');
  cancel.className = 'qp-cancel';
  cancel.textContent = '取消（Esc）';
  cancel.addEventListener('click', closeQuickPicker);
  box.appendChild(cancel);
  box.classList.remove('hidden');

  const rect = els.canvas.getBoundingClientRect();
  const scale = rect.width / els.canvas.width;
  const sc = App.screenCell;
  const cx = rect.left + ((cell.x + 5.5) * sc) * scale;
  const cy = rect.top + ((cell.y + 5.5) * sc) * scale;
  const gap = sc * scale;
  const bw = 54 * 3 + 22, bh = 250;
  const left = Math.max(8, Math.min(cx - bw / 2, window.innerWidth - bw - 8));
  let top = cy + gap * 1.5; // 像素下方，再隔一个像素格
  if (top + bh > window.innerHeight - 8) top = cy - gap * 1.5 - bh;
  top = Math.max(8, top);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

function pickQuickColor(k) {
  const cand = App.pickerCandidates && App.pickerCandidates[k];
  if (!cand) return;
  App.brushColor = cand.i;
  setTool('drag'); // 改完颜色后回到拖拽模式
  updateBrush();
  if (App.selectedCell) {
    // D 键九宫格对单个像素的修改记为一步
    App.strokeBuffer = [];
    paintCell(App.selectedCell.x, App.selectedCell.y);
    if (App.strokeBuffer.length) recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
    App.strokeBuffer = null;
    renderHistoryUI();
  }
  closeQuickPicker();
  renderColorList();
}

function closeQuickPicker() {
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
  App.selectedCell = null;
  App.highlightColor = null;
  App.maxColors = snap.maxColors || distinctCount(App.project.grid, snap.width, snap.height) || 2;
  App.sliderN = null;
  App.editedSinceSlider = false;
  App.history.currentId = id;
  // 切换到其它事务后，以该事务快照中的色板作为已应用色板渲染画布
  App.appliedPalette = (snap.palette || []).map((c) => ({ ...c }));
  // 切换到其它事务后，工作网格整体被替换，旧的单步记录不再有效
  App.undoStack = [];
  App.redoStack = [];
  App.strokeBuffer = null;
  setDirty(false);
  closeQuickPicker();

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
  renderColorList();
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
  clearHistoryRecords();
  App.maxColors = 2;
  App.sliderN = null;
  App.editedSinceSlider = false;
  setDirty(false);
  App.selectedCell = null;
  App.highlightColor = null;
  closeQuickPicker();
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
    if (App.appliedPalette[v]) codesOut[p] = App.appliedPalette[v].code || String(App.appliedPalette[v].index);
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
  const cellSize = Math.max(5, Math.min(100, parseInt(els.dlgCell.value, 10) || 20));
  const pad = Math.max(0, Math.min(200, parseInt(els.dlgPad.value, 10) || 0));
  const showLegend = els.dlgLegend.checked;
  const previewCell = 8;
  const previewPad = Math.round(pad * previewCell / cellSize);
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  drawPattern(octx, App.project.width, App.project.height, display.idx, display.rgb, {
    cell: previewCell,
    outerPad: previewPad,
    gridLines: els.dlgGrid.checked,
    hatch: true,
    emptyStyle: els.dlgEmptyStyle.value,
    showCodes: els.dlgCodes.checked,
    codes: buildCodes(),
    legend: showLegend ? legend : [],
    showLegend,
  });
  const pv = els.dlgPreview;
  const scale = Math.min(290 / off.width, 250 / off.height, 1);
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
  try {
    const res = await api.exportImage({
      width: App.project.width,
      height: App.project.height,
      grid,
      palette,
      legend,
      codes,
      options: {
        cellSize: Math.max(5, Math.min(100, parseInt(els.dlgCell.value, 10) || 20)),
        gridLines: els.dlgGrid.checked,
        outerPad: Math.max(0, Math.min(200, parseInt(els.dlgPad.value, 10) || 0)),
        showCodes: els.dlgCodes.checked,
        legend: els.dlgLegend.checked,
        format: fmt,
        quality: 95,
        emptyStyle: els.dlgEmptyStyle.value,
      },
    });
    downloadDataUrl(res.dataUrl, `拼豆图案.${fmt === 'png' ? 'png' : 'jpg'}`);
    toast('导出成功');
    els.exportDialog.classList.add('hidden');
  } catch (err) {
    toast('导出失败：' + err.message);
  }
}

// ---------------- 自动保存与恢复 ----------------

function buildStatePayload() {
  return {
    settings: {
      ...App.settings,
      targetPixels: parseInt(els.targetPixels.value, 10) || 40000,
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
  App.saveTimer = setTimeout(saveStateNow, 800);
}

async function saveStateNow() {
  try {
    await api.putState(buildStatePayload());
    els.autosave.textContent = '已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (err) {
    els.autosave.textContent = '自动保存失败';
  }
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
  els.targetPixels.value = App.settings.targetPixels;
  els.chkSharpen.checked = App.settings.sharpen;
  els.chkCodes.checked = App.settings.showCodes;
  els.selDistance.value = App.settings.useLab ? 'lab' : 'rgb';
  els.emptyStyle.value = ['default', 'black', 'white'].includes(App.settings.emptyStyle)
    ? App.settings.emptyStyle
    : 'default';

  if (st.project) {
    App.project = {
      width: st.project.width,
      height: st.project.height,
      grid: Int16Array.from(st.project.grid || []),
    };
    App.baseGrid = st.project.baseGrid
      ? Int16Array.from(st.project.baseGrid)
      : App.project.grid.slice();
    App.maxColors = st.project.maxColors || distinctCount(App.project.grid, st.project.width, st.project.height) || 2;
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
    renderColorList();
    updateBrush();
  }
  App.history = sanitizeHistory(st.history || st.tree);
  renderHistoryUI();
  renderAll();
  if (App.project) zoomFit();
}

// ---------------- 事件绑定 ----------------

function bindEvents() {
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
      processUpload();
    }
    els.fileInput.value = '';
  });
  els.btnRecompress.addEventListener('click', recompress);
  els.chkCodes.addEventListener('change', () => {
    App.settings.showCodes = els.chkCodes.checked;
    renderAll();
    scheduleAutosave();
  });
  els.selDistance.addEventListener('change', () => {
    const useLab = els.selDistance.value === 'lab';
    if (App.settings.useLab === useLab) return;
    if (App.project && App.dirty) {
      if (!confirm('更改颜色距离将按新算法重新生成颜色映射，并丢弃画布上的手动修改。是否继续？')) {
        els.selDistance.value = App.settings.useLab ? 'lab' : 'rgb';
        return;
      }
    }
    App.settings.useLab = useLab;
    if (App.project && App.compressed) applyMapping();
    else renderAll();
    scheduleAutosave();
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
    ['dlgGrid', 'change'], ['dlgCodes', 'change'], ['dlgLegend', 'change'],
    ['dlgEmptyStyle', 'change'], ['dlgFormat', 'change'],
  ]) {
    els[key].addEventListener(evt, renderExportPreview);
  }

  els.btnSaveStateSide.addEventListener('click', saveTransaction);
  els.btnClearAll.addEventListener('click', clearAll);
  els.btnUndo.addEventListener('click', doUndo);
  els.btnRedo.addEventListener('click', doRedo);

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
    const a = document.createElement('a');
    a.href = '/api/configs/' + encodeURIComponent(App.configName) + '/export';
    a.download = App.configName + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  els.toolBrush.addEventListener('click', () => {
    if (App.brushColor == null) { toast('请先在左侧选择一种颜色'); return; }
    setTool(App.tool === 'brush' ? 'drag' : 'brush');
  });
  els.toolEraser.addEventListener('click', () => {
    setTool(App.tool === 'eraser' ? 'drag' : 'eraser');
  });
  els.toolPicker.addEventListener('click', () => {
    setTool(App.tool === 'picker' ? 'drag' : 'picker');
  });

  els.zoomIn.addEventListener('click', () => {
    const vp = els.canvasScroll;
    const r = vp.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25);
  });
  els.zoomOut.addEventListener('click', () => {
    const vp = els.canvasScroll;
    const r = vp.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
  });
  els.zoomFit.addEventListener('click', zoomFit);

  els.canvasScroll.addEventListener('mousedown', (e) => {
    if (!App.project) return;
    if (e.button !== 0) return;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const cell = cellFromEvent(e);
    e.preventDefault();
    if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
    dragState.active = true;
    dragState.moved = false;
    dragState.panning = false;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.panStart = { ...App.pan };
    dragState.downCell = cell;
    if (App.tool === 'brush' || App.tool === 'eraser') {
      // 画笔 / 橡皮：从图案格开始连续涂色，否则平移
      if (cell) {
        App.painting = true;
        App.lastCell = cell;
        // 一次按下到放开的全部像素修改记为一步
        App.strokeBuffer = [];
        paintCell(cell.x, cell.y);
      } else {
        dragState.panning = true;
      }
    }
    // 拖拽 / 取色模式：单击与拖动在 mouseup 时区分
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState.active || !App.project) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) > 4) {
      dragState.moved = true;
      if (App.tool === 'drag' || App.tool === 'picker') dragState.panning = true;
    }
    if (dragState.moved && dragState.panning) {
      App.pan = { x: dragState.panStart.x + dx, y: dragState.panStart.y + dy };
      els.canvas.style.cursor = 'grabbing';
      applyTransform();
      return;
    }
    if (!App.painting) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (App.lastCell) strokeLine(App.lastCell, cell);
    App.lastCell = cell;
  });
  window.addEventListener('mouseup', () => {
    if (dragState.active && !dragState.moved) {
      if (App.tool === 'drag') {
        // 拖拽模式：单击像素 = 高亮该像素（拖动时不做高亮）
        App.selectedCell = dragState.downCell || null;
        scheduleRender();
      } else if (App.tool === 'picker' && dragState.downCell) {
        pickColorFromCell(dragState.downCell);
      }
    }
    if (App.strokeBuffer) {
      if (App.strokeBuffer.length) recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
      App.strokeBuffer = null;
      renderHistoryUI();
    }
    dragState.active = false;
    dragState.moved = false;
    dragState.panning = false;
    App.painting = false;
    App.lastCell = null;
    els.canvas.style.cursor = '';
  });
  els.canvas.addEventListener('contextmenu', (e) => {
    if (!App.project || App.tool !== 'drag') return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    e.preventDefault();
    App.selectedCell = cell;
    renderAll();
    openQuickPicker(cell);
  });

  els.canvasScroll.addEventListener('wheel', (e) => {
    if (!App.project) return;
    if (!els.quickPicker.classList.contains('hidden')) closeQuickPicker();
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveTransaction();
      return;
    }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
      return;
    }
    const pickerOpen = !els.quickPicker.classList.contains('hidden');
    if (pickerOpen) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && App.pickerCandidates && App.pickerCandidates[n - 1]) {
        e.preventDefault();
        pickQuickColor(n - 1);
      } else if (e.key === 'Escape') {
        closeQuickPicker();
      }
      return;
    }
    if (e.key.toLowerCase() === 'd' && App.tool === 'drag' && App.selectedCell && App.project) {
      e.preventDefault();
      openQuickPicker(App.selectedCell);
    } else if (e.key === 'Escape') {
      closeQuickPicker();
      if (App.tool !== 'drag') setTool('drag');
    }
  });
}

function setTool(t) {
  App.tool = t;
  els.toolBrush.classList.toggle('active', t === 'brush');
  els.toolPicker.classList.toggle('active', t === 'picker');
  els.toolEraser.classList.toggle('active', t === 'eraser');
  els.canvas.classList.toggle('mode-pan', t === 'drag');
  els.canvas.classList.toggle('mode-brush', t === 'brush');
  els.canvas.classList.toggle('mode-picker', t === 'picker');
  els.canvas.classList.toggle('mode-eraser', t === 'eraser');
  if (t !== 'drag') {
    // 进入画笔 / 取色 / 橡皮模式时取消像素高亮与颜色高亮
    const changed = App.selectedCell != null || App.highlightColor != null;
    App.selectedCell = null;
    App.highlightColor = null;
    if (changed) renderAll();
  }
  els.modeLabel.textContent = t === 'brush' ? '画笔模式'
    : t === 'eraser' ? '橡皮模式'
      : t === 'picker' ? '取色模式' : '拖拽模式';
}

// ---------------- 启动 ----------------

async function init() {
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

// 调试句柄（便于自动化测试读取内部状态）
window.__app = App;

// 自动化测试用：暴露需要直接驱动的内部函数
window.__testHooks = {
  renderAll,
  redrawCanvas,
  updateBrush,
  paintCell,
  pickQuickColor,
  doUndo,
  doRedo,
  applySlider,
  saveTransaction,
  switchNode,
  doDeleteNode,
  clearAll,
  restoreState,
  renderHistoryUI,
  openExportDialog,
  renderExportPreview,
};
