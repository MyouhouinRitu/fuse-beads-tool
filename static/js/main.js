// 应用入口（组合根）：装配各功能模块、绑定事件、启动流程与测试钩子。
// 全量刷新 renderAll 与缩放联动钩子在这里编排，功能模块只依赖 render-queue 请求渲染。

import * as api from './api.js';
import * as C from './colors.js';
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  QUICK_PICKER_MAX,
  TARGET_PIXEL_PRESETS,
  TOOLS,
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
  ZOOM_BUTTON_FACTOR,
  ZOOM_MAX,
  ZOOM_MIN,
} from './constants.js';
import { sanitizeHistory, sanitizeUndoStack } from './history.js';
import { App, dragState, hasPendingRecords, clearHistoryRecords, setDirty, setProjectDirty } from './state.js';
import { assertElements, els } from './els.js';
import { clampInt, downloadDataUrl, downloadUrl, hintDistanceDeferred, toast } from './utils.js';
import { renderAllNow, scheduleCanvasRender, setRenderers } from './render-queue.js';
import * as auth from './auth.js';
import { buildProjectDocument, defaultProjectFileName, scheduleAutosave } from './autosave.js';
import * as canvas from './canvas.js';
import * as compare from './compare.js';
import * as crop from './crop.js';
import * as exportDialog from './export-dialog.js';
import * as highlight from './highlight.js';
import * as historyActions from './history-actions.js';
import * as historyUI from './history-ui.js';
import * as markdown from './markdown.js';
import * as palette from './palette.js';
import * as panel from './panel.js';
import * as quickPicker from './quick-picker.js';
import * as theme from './theme.js';
import * as toolState from './tool-state.js';
import * as upload from './upload.js';
import * as view from './view.js';
import * as workspace from './workspace.js';
import { installTestHooks } from './test-hooks.js';

let nativeDialogs = false; // 后端明确告知是否支持 Windows 系统文件对话框

function projectNameStem(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
}

function updateProjectNameLabel() {
  const name = App.projectName
    || (App.originalName ? projectNameStem(App.originalName) : '');
  els.projectNameLabel.textContent = name ? `· ${name}` : '';
}

// ---------------- 全量刷新（面板 + 画布） ----------------

function renderAll() {
  const project = App.project;
  if (!project) {
    updateProjectNameLabel();
    canvas.clearWorkspace();
    els.emptyHint.style.display = '';
    els.colorSlider.disabled = true;
    els.btnSaveProject.disabled = true;
    els.cellInfo.textContent = '';
    els.usedColors.textContent = '';
    els.sliderValue.textContent = '2';
    canvas.syncHighlightBlink();
    toolState.updateModeControls();
    historyUI.updateUndoUI();
    if (App.settings.compare || App.settings.syncPan) {
      compare.setCompareEnabled(false, { silent: true });
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
  updateProjectNameLabel();
  canvas.redrawCanvas();
  els.emptyHint.style.display = 'none';

  let empty = 0;
  for (let p = 0; p < project.grid.length; p++) if (project.grid[p] < 0) empty++;
  els.cellInfo.textContent = `${project.width} × ${project.height} · 总量 ${project.grid.length - empty} · 空位 ${empty}`;
  workspace.renderColorList(counts);
  highlight.renderHighlightColorList(counts);
  canvas.syncHighlightBlink();
  els.btnSaveProject.disabled = false;
  toolState.updateModeControls();
  historyUI.updateUndoUI();
}

setRenderers(renderAll, canvas.composeCanvas);

// 缩放结束后统一联动：细节阈值重建、overlay 重绘、裁剪放大镜、对比镜像
view.setAfterZoomHook(() => {
  canvas.syncBaseLayerDetail();
  canvas.composeCanvas();
  crop.refreshCropMagnifier();
  if (App.settings.syncPan && App.originalImage) {
    view.mirrorBeadToOrig();
    view.applyOriginalTransform();
  }
});

// ---------------- 颜色数量滑块 ----------------

// 从基副本按颜色数量 N 生成工作副本（有确认提示）
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
      historyUI.renderHistoryUI();
    }
  }
  App.project.grid = canvas.mergeGrid(App.baseGrid, App.appliedPalette, App.settings.useLab, n);
  App.sliderN = n;
  App.editedSinceSlider = false;
  setProjectDirty(true);
  canvas.resetProjectEditingState();
  renderAllNow();
  scheduleAutosave();
}

// ---------------- 状态恢复 ----------------

// 把持久化设置同步到 App 状态与界面控件
function applySettingsToControls() {
  App.settings.brushSize = clampInt(App.settings.brushSize, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN);
  els.sameColorChk.checked = !!App.settings.sameColorSelect;
  els.targetPixels.value = App.settings.targetPixels;
  els.chkSharpen.checked = App.settings.sharpen;
  els.chkCodes.checked = App.settings.showCodes;
  els.selDistance.value = App.settings.useLab ? 'lab' : 'rgb';
  els.emptyStyle.value = ['default', 'black', 'white'].includes(App.settings.emptyStyle)
    ? App.settings.emptyStyle
    : 'default';
  App.settings.wandSensitivity = clampInt(
    App.settings.wandSensitivity,
    WAND_SENSITIVITY_MIN,
    WAND_SENSITIVITY_MAX,
    WAND_SENSITIVITY_DEFAULT,
  );
  els.wandSensitivity.value = String(App.settings.wandSensitivity);
  els.wandSensitivityValue.textContent = String(App.settings.wandSensitivity);
  // 对比/同步状态随设置持久化；原图从缓存恢复后再真正开启对比
  els.chkCompare.checked = !!App.settings.compare;
  els.chkSyncPan.checked = !!App.settings.syncPan;
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
  // 色板配置（可编辑）以磁盘上的配置为准；快照与配置不一致时自动创建恢复配置
  const snapPalette = st.project.palette && st.project.palette.length
    ? st.project.palette
    : null;
  if (snapPalette) {
    const preferred = App.configName || '恢复色板';
    const { name, created } = await palette.ensurePaletteConfig(snapPalette, preferred);
    App.configName = name;
    try {
      const res = await api.getConfig(name);
      App.palette = res.colors;
    } catch (e) {
      App.palette = snapPalette.map((c) => ({ ...c }));
    }
    if (created || name !== preferred) scheduleAutosave();
  } else if (App.configName && App.configs.some((c) => c.name === App.configName)) {
    try {
      const res = await api.getConfig(App.configName);
      App.palette = res.colors;
    } catch (e) {
      App.palette = [];
    }
  } else {
    App.palette = [];
  }
  els.configSelect.value = App.configName || '';
  palette.renderColorTable();
}

const RESTORABLE_TOOLS = new Set([TOOLS.SELECT, TOOLS.BRUSH, TOOLS.ERASER, TOOLS.PICKER, TOOLS.WAND]);

function restoreSelection(raw, project) {
  if (!project || !Array.isArray(raw)) return new Set();
  const n = project.width * project.height;
  const sel = new Set();
  for (const v of raw) {
    const p = Number(v);
    if (Number.isInteger(p) && p >= 0 && p < n) sel.add(p);
  }
  return sel;
}

function applySavedOriginalViewport(vp) {
  const oz = Number(vp && vp.origZoom);
  const op = vp && vp.origPan;
  if (!Number.isFinite(oz) || oz <= 0 || !op
    || !Number.isFinite(Number(op.x)) || !Number.isFinite(Number(op.y))) {
    return false;
  }
  App.origZoom = oz;
  App.origPan = { x: Number(op.x), y: Number(op.y) };
  view.applyOriginalTransform();
  return true;
}

function restoreViewport(vp) {
  const zoom = Number(vp && vp.zoom);
  const pan = vp && vp.pan;
  if (!Number.isFinite(zoom) || zoom <= 0 || !pan
    || !Number.isFinite(Number(pan.x)) || !Number.isFinite(Number(pan.y))) {
    return false;
  }
  App.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  App.pan = { x: Number(pan.x), y: Number(pan.y) };
  view.applyTransform();
  applySavedOriginalViewport(vp);
  return true;
}

async function restoreState() {
  let st;
  try {
    st = await api.getState();
  } catch (e) {
    st = {};
  }
  if (st.settings) Object.assign(App.settings, st.settings);
  applySettingsToControls();
  await restoreProjectState(st);

  App.history = sanitizeHistory(st.history);
  App.undoStack = sanitizeUndoStack(st.undo && st.undo.undoStack);
  App.redoStack = sanitizeUndoStack(st.undo && st.undo.redoStack);
  historyUI.renderHistoryUI();

  App.originalId = st.original && st.original.id ? String(st.original.id) : null;
  App.originalName = st.original && st.original.name ? String(st.original.name) : null;
  App.originalSha256 = st.original && st.original.sha256 ? String(st.original.sha256) : null;
  App.originalSize = st.original && Number.isFinite(Number(st.original.size))
    ? Number(st.original.size)
    : null;
  App.projectName = st.projectName
    || (st.original && st.original.name ? projectNameStem(st.original.name) : null);

  const editor = st.editor || {};
  App.selection = restoreSelection(editor.selection, App.project);
  App.brushColor = (App.project && Number.isInteger(editor.brushColor)
    && editor.brushColor >= 0 && editor.brushColor < App.appliedPalette.length)
    ? editor.brushColor
    : null;
  App.dirty = !!editor.dirty && !!App.project;
  setDirty(App.dirty);
  App.projectDirty = !!st.projectDirty && !!App.project;

  renderAllNow();
  if (App.project) {
    if (!restoreViewport(st.viewport)) view.fitViewportToCanvas();
  }

  const storedTool = editor.tool;
  const tool = App.project && RESTORABLE_TOOLS.has(storedTool) ? storedTool : TOOLS.SELECT;
  toolState.setTool(tool);
  if (tool === TOOLS.BRUSH && App.brushColor == null) workspace.ensureBrushColor();

  // 先从浏览器缓存恢复原图；缓存缺失时回退到后端保存的原图
  let originalRestored = await compare.restoreOriginalFromCache();
  if (!originalRestored && App.originalId) {
    try {
      const blob = await api.getOriginalBlob(App.originalId);
      originalRestored = await compare.loadOriginalImage(blob);
    } catch (e) { /* 忽略：无原图时对比保持关闭 */ }
  }

  if (App.settings.compare) {
    if (App.project && originalRestored) {
      compare.setCompareEnabled(true, { silent: true });
      if (App.settings.syncPan) {
        view.mirrorBeadToOrig();
        view.applyOriginalTransform();
      } else {
        applySavedOriginalViewport(st.viewport);
      }
    } else {
      App.settings.compare = false;
      App.settings.syncPan = false;
      els.chkCompare.checked = false;
      els.chkSyncPan.checked = false;
    }
  }
}

async function applyProjectDocument(doc, path = null) {
  if (!doc || !doc.project) {
    toast('项目文件缺少画布数据');
    return;
  }
  // 打开项目后运行态全部重置，文档状态以文件为准
  App.selection = new Set();
  App.undoStack = [];
  App.redoStack = [];
  App.brushColor = null;
  App.dragPreview = null;
  App.crop = null;
  App.cropActiveEdge = null;
  App.cropPreview = null;
  App.highlightColor = null;
  App.compressed = null;
  if (App.originalUrl) {
    try { URL.revokeObjectURL(App.originalUrl); } catch (e) { /* ignore */ }
  }
  App.originalFile = null;
  App.originalImage = null;
  App.originalUrl = null;
  App.tool = TOOLS.SELECT;

  if (doc.settings) Object.assign(App.settings, doc.settings);
  applySettingsToControls();
  await restoreProjectState({ project: doc.project, settings: doc.settings });

  App.history = sanitizeHistory(doc.history);
  historyUI.renderHistoryUI();

  App.originalId = doc.original && doc.original.id ? String(doc.original.id) : null;
  App.originalName = doc.original && doc.original.name ? String(doc.original.name) : null;
  App.originalSha256 = doc.original && doc.original.sha256 ? String(doc.original.sha256) : null;
  App.originalSize = doc.original && Number.isFinite(Number(doc.original.size))
    ? Number(doc.original.size)
    : null;
  App.projectName = path
    ? projectNameStem(String(path).split(/[\\/]/).pop())
    : (doc.original && doc.original.name ? projectNameStem(doc.original.name) : '未命名');

  setDirty(false);
  setProjectDirty(false);
  renderAllNow();
  if (!restoreViewport(doc.viewport)) view.fitViewportToCanvas();
  toolState.setTool(TOOLS.SELECT);

  let originalRestored = false;
  if (App.originalId) {
    try {
      const blob = await api.getOriginalBlob(App.originalId);
      originalRestored = await compare.loadOriginalImage(blob);
    } catch (e) { /* 忽略 */ }
  }
  if (App.settings.compare) {
    if (App.project && originalRestored) {
      compare.setCompareEnabled(true, { silent: true });
      if (App.settings.syncPan) {
        view.mirrorBeadToOrig();
        view.applyOriginalTransform();
      } else {
        applySavedOriginalViewport(doc.viewport);
      }
    } else {
      App.settings.compare = false;
      App.settings.syncPan = false;
      els.chkCompare.checked = false;
      els.chkSyncPan.checked = false;
    }
  }
  scheduleAutosave();
  toast('已打开项目');
}

async function saveProjectFile() {
  if (!App.project) return;
  try {
    const isTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
    const res = await api.saveProject(
      buildProjectDocument(),
      defaultProjectFileName(),
      isTest ? 'download' : undefined,
    );
    if (res.cancelled) return;
    if (res.mode === 'download') {
      downloadDataUrl('data:application/octet-stream;base64,' + res.dataBase64, res.filename);
      App.projectName = projectNameStem(res.filename);
      toast('已生成项目文件（浏览器下载）');
    } else if (res.mode === 'saved') {
      App.projectName = projectNameStem(String(res.path).split(/[\\/]/).pop());
      toast(`已保存项目：${res.path}`);
    }
    setDirty(false);
    setProjectDirty(false);
    updateProjectNameLabel();
  } catch (e) {
    toast('保存项目失败：' + e.message);
  }
}

async function openProjectViaDialog() {
  if (App.projectDirty && !confirm('当前项目有未保存的更改，打开新项目将覆盖。是否继续？')) return;
  const isTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
  if (!nativeDialogs || isTest) {
    els.projectFileInput.click();
    return;
  }
  try {
    const pick = await api.pickOpenProject();
    if (pick.cancelled) return;
    if (pick.error) {
      els.projectFileInput.click();
      return;
    }
    const res = await api.openProjectPath(pick.path);
    await applyProjectDocument(res.document, res.path);
  } catch (e) {
    toast('打开项目失败：' + e.message);
  }
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
      setProjectDirty(true);
    });
    menu.appendChild(btn);
  });
}

function bindEvents() {
  panel.bindPanelToggles();
  palette.bindColorTable();
  workspace.bindColorList();
  highlight.bindHighlightList();
  historyUI.bindHistoryList();
  quickPicker.bindQuickPicker();
  renderTargetPixelOptions();
  // 箭头展开预设（输入框本身只编辑，光标为文本竖线）
  els.targetPixelsBtn.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    // 控件包在 <label> 内：不 preventDefault 时浏览器会把点击转发给输入框，
    // 再冒泡到 document 的「点击关闭菜单」处理器，导致菜单刚展开就被收起
    if (e.preventDefault) e.preventDefault();
    els.targetPixelsMenu.classList.toggle('hidden');
  });

  els.btnLogin.addEventListener('click', auth.tryLogin);
  els.loginToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') auth.tryLogin();
  });
  els.btnLogout.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch (e) { /* ignore */ }
    location.reload();
  });

  els.btnOpenProject.addEventListener('click', openProjectViaDialog);
  els.projectFileInput.addEventListener('change', async () => {
    const f = els.projectFileInput.files[0];
    els.projectFileInput.value = '';
    if (!f) return;
    if (App.projectDirty && !confirm('当前项目有未保存的更改，打开新项目将覆盖。是否继续？')) return;
    try {
      const res = await api.openProjectUpload(f);
      await applyProjectDocument(res.document);
    } catch (e) {
      toast('打开项目失败：' + e.message);
    }
  });
  els.btnSaveProject.addEventListener('click', saveProjectFile);
  els.btnImport.addEventListener('click', () => {
    if (App.projectDirty && !confirm('当前项目有未保存的更改，导入新图片将覆盖。是否继续？')) return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', () => {
    const f = els.fileInput.files[0];
    if (f) {
      historyUI.clearAll({ silent: true });
      App.originalFile = f;
      compare.loadOriginalImage(f);
      upload.processUpload();
    }
    els.fileInput.value = '';
  });
  els.btnRecompress.addEventListener('click', upload.recompress);
  els.chkCompare.addEventListener('change', () => {
    compare.setCompareEnabled(els.chkCompare.checked);
    setProjectDirty(true);
  });
  els.chkSyncPan.addEventListener('change', () => {
    compare.setSyncPan(els.chkSyncPan.checked);
    setProjectDirty(true);
  });
  els.chkCodes.addEventListener('change', () => {
    App.settings.showCodes = els.chkCodes.checked;
    canvas.redrawCanvas();
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.chkSharpen.addEventListener('change', () => {
    App.settings.sharpen = els.chkSharpen.checked;
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.targetPixels.addEventListener('input', () => {
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.selDistance.addEventListener('change', () => {
    const useLab = els.selDistance.value === 'lab';
    if (App.settings.useLab === useLab) return;
    // 颜色距离只保存设置，不立即重算；单击「重新压缩」后按新算法生成图案
    App.settings.useLab = useLab;
    setProjectDirty(true);
    scheduleAutosave();
    hintDistanceDeferred();
  });

  els.colorSlider.addEventListener('input', () => {
    applySlider(parseInt(els.colorSlider.value, 10));
  });
  els.emptyStyle.addEventListener('change', () => {
    App.settings.emptyStyle = els.emptyStyle.value;
    canvas.redrawCanvas();
    setProjectDirty(true);
    scheduleAutosave();
  });

  els.btnExport.addEventListener('click', exportDialog.openExportDialog);
  els.dlgCancel.addEventListener('click', () => els.exportDialog.classList.add('hidden'));
  els.dlgOk.addEventListener('click', exportDialog.doExport);
  for (const [key, evt] of [
    ['dlgCell', 'input'], ['dlgPad', 'input'],
    ['dlgGrid', 'change'], ['dlgEdgeNumbers', 'change'], ['dlgCodes', 'change'], ['dlgLegend', 'change'],
    ['dlgEmptyStyle', 'change'], ['dlgFormat', 'change'],
  ]) {
    els[key].addEventListener(evt, exportDialog.renderExportPreview);
  }

  els.btnSaveStateSide.addEventListener('click', historyUI.saveTransaction);
  els.btnClearAll.addEventListener('click', historyUI.clearAll);
  els.btnUndo.addEventListener('click', historyActions.doUndo);
  els.btnRedo.addEventListener('click', historyActions.doRedo);
  els.btnFixMenu.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    els.fixMenu.classList.toggle('hidden');
  });
  els.fixItemGesture.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    markdown.openFixDoc('right-drag-gesture-fix');
  });
  els.fixItemShortcuts.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    markdown.openFixDoc('shortcuts');
  });
  els.docClose.addEventListener('click', markdown.closeFixDoc);
  els.btnTheme.addEventListener('click', theme.toggleTheme);
  document.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    els.targetPixelsMenu.classList.add('hidden');
  });

  els.configSelect.addEventListener('change', () => {
    const name = els.configSelect.value;
    if (name) {
      setProjectDirty(true);
      palette.loadConfigDetail(name);
    }
  });
  els.btnNewConfig.addEventListener('click', async () => {
    const name = prompt('新配置名称：');
    if (!name) return;
    const colors = App.palette.length
      ? App.palette.map((c) => ({ ...c }))
      : [{ index: 1, code: '001', name: '白色', hex: '#FFFFFF' }];
    try {
      await api.createConfig(name, colors);
      await palette.selectAndLoad(name);
      setProjectDirty(true);
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
      await palette.selectAndLoad(res.name);
      setProjectDirty(true);
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
      await palette.selectAndLoad(newName);
      setProjectDirty(true);
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
      await palette.selectAndLoad(remaining[0] ? remaining[0].name : null);
      setProjectDirty(true);
      toast('已删除配置');
    } catch (err) {
      toast('删除失败：' + err.message);
    }
  });
  els.btnAddColor.addEventListener('click', palette.addColor);

  // 模式按钮：画笔/橡皮/取色互斥切换（画笔未选色时先取调色板最暗色）
  for (const [btnKey, tool] of [
    ['toolBrush', TOOLS.BRUSH],
    ['toolEraser', TOOLS.ERASER],
    ['toolPicker', TOOLS.PICKER],
    ['toolCrop', TOOLS.CROP],
    ['toolWand', TOOLS.WAND],
  ]) {
    els[btnKey].addEventListener('click', () => {
      if (tool === TOOLS.BRUSH && !workspace.ensureBrushColor()) return;
      toolState.setTool(App.tool === tool ? TOOLS.SELECT : tool);
    });
  }
  els.btnAutoCrop.addEventListener('click', crop.autoCrop);
  els.btnApplyCrop.addEventListener('click', crop.applyCrop);
  els.sameColorChk.addEventListener('change', () => {
    App.settings.sameColorSelect = els.sameColorChk.checked;
    setProjectDirty(true);
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
    App.dragPreview = null;
    App.highlightColor = null;
    canvas.syncHighlightBlink();
    highlight.renderHighlightColorList();
    scheduleCanvasRender();
    toolState.updateModeControls();
  });
  els.brushSize.addEventListener('input', () => {
    App.settings.brushSize = clampInt(els.brushSize.value, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN);
    toolState.updateModeControls();
    setProjectDirty(true);
    scheduleCanvasRender();
    scheduleAutosave();
  });
  els.wandSensitivity.addEventListener('input', () => {
    App.settings.wandSensitivity = clampInt(
      els.wandSensitivity.value,
      WAND_SENSITIVITY_MIN,
      WAND_SENSITIVITY_MAX,
      WAND_SENSITIVITY_DEFAULT,
    );
    toolState.updateModeControls();
    setProjectDirty(true);
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
      view.zoomAtCore(r.left + r.width / 2, r.top + r.height / 2, factor);
      setProjectDirty(true);
    });
  }
  els.zoomFit.addEventListener('click', () => {
    view.fitViewportToCanvas();
    setProjectDirty(true);
  });

  els.canvasScroll.addEventListener('mousedown', workspace.onCanvasScrollMouseDown);
  window.addEventListener('mousemove', workspace.onWindowMouseMove);
  window.addEventListener('mouseup', workspace.onWindowMouseUp);
  els.canvasScroll.addEventListener('mouseleave', workspace.onCanvasScrollMouseLeave);
  // 九宫格：鼠标移出弹窗时还原悬停预览的颜色
  els.quickPicker.addEventListener('mouseleave', quickPicker.restoreQuickPickerPreview);
  // 全域禁用右键菜单：工具不需要右键菜单，避免拖拽结束时在菜单栏等位置弹出
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  els.canvasScroll.addEventListener('wheel', workspace.onCanvasWheel, { passive: false });
  els.compareOriginal.addEventListener('mousedown', workspace.onCompareMouseDown);
  els.compareOriginal.addEventListener('wheel', workspace.onCompareWheel, { passive: false });

  const tabs = document.querySelectorAll('.tabs .tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      els.tabPalette.classList.toggle('hidden', tab !== 'palette');
      els.tabEdit.classList.toggle('hidden', tab !== 'edit');
    });
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!els.docDialog.classList.contains('hidden')) {
        markdown.closeFixDoc();
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
      if (!els.exportDialog.classList.contains('hidden')) {
        // 导出弹窗：Escape 与「取消」一致
        els.exportDialog.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!els.loginMask.classList.contains('hidden')) {
        // 登录是必经门槛，Escape 仅清除错误提示，不关闭遮罩
        els.loginError.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (inField) return; // 输入框内不处理工具/选区 Escape
      if (!els.quickPicker.classList.contains('hidden')) {
        quickPicker.closeQuickPicker();
        e.preventDefault();
        return;
      }
      quickPicker.closeQuickPicker(); // 未打开时为无操作
      if (App.tool !== TOOLS.SELECT) toolState.setTool(TOOLS.SELECT);
      else workspace.clearSelection();
      e.preventDefault();
      return;
    }
    // Ctrl+Shift+S 保存项目；Ctrl+S 保存事务；两者都遵循焦点守卫
    if (mod && e.shiftKey && e.key.toLowerCase() === 's' && !inField) {
      e.preventDefault();
      saveProjectFile();
      return;
    }
    if (mod && e.key.toLowerCase() === 's' && !inField) {
      e.preventDefault();
      historyUI.saveTransaction();
      return;
    }
    if (inField) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      historyActions.doUndo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      historyActions.doRedo();
      return;
    }
    const pickerOpen = !els.quickPicker.classList.contains('hidden');
    if (pickerOpen) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= QUICK_PICKER_MAX && App.pickerCandidates && App.pickerCandidates[n - 1]) {
        e.preventDefault();
        quickPicker.applyQuickColor(n - 1);
      }
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'q') { e.preventDefault(); workspace.switchToolShortcut(TOOLS.BRUSH); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'w') { e.preventDefault(); workspace.switchToolShortcut(TOOLS.PICKER); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'e') { e.preventDefault(); workspace.switchToolShortcut(TOOLS.ERASER); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'r') { e.preventDefault(); workspace.switchToolShortcut(TOOLS.CROP); return; }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'm') { e.preventDefault(); workspace.switchToolShortcut(TOOLS.WAND); return; }
    if (e.key === 'Delete') { e.preventDefault(); workspace.clearSelectionToEmpty(); return; }
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
        quickPicker.openQuickPicker(target);
      }
    }
  });
}

// ---------------- 启动 ----------------

async function init() {
  assertElements();
  try {
    const info = await api.getAppInfo();
    nativeDialogs = !!info.nativeDialogs;
  } catch (e) { /* 保持默认 false */ }
  panel.applyPanelPrefs();
  theme.applyTheme(theme.currentTheme());
  bindEvents();
  await auth.ensureAuth();
  try {
    await palette.loadConfigs();
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
  renderAllNow();
  historyUI.renderHistoryUI();
}

init();

// 自动化测试挂钩（稳定契约）：暴露面与安装逻辑见 test-hooks.js
installTestHooks({ renderAll, applySlider, restoreState });
