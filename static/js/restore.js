// 状态 / 项目恢复：把持久化状态或 .ssfbp 文档还原为运行态，含设置同步、原图与对比开关。

import * as api from './api.js';
import { STATE_SCHEMA_VERSION, scheduleAutosave } from './autosave.js';
import * as colorList from './color-list.js';
import * as C from './colors.js';
import * as compare from './compare.js';
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  TOOLS,
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
} from './constants.js';
import { els } from './els.js';
import { decodeInt16Grid } from './grid-codec.js';
import { sanitizeHistory, sanitizeUndoStack } from './history.js';
import * as historyUI from './history-ui.js';
import { interactionState } from './interaction.js';
import * as mirror from './mirror.js';
import * as palette from './palette.js';
import { renderFullNow } from './render-queue.js';
import { App, setDirty, setProjectDirty } from './state.js';
import * as toolState from './tool-state.js';
import { clampInt, fileNameStem, toast } from './utils.js';
import { validateProjectPayload } from './validate.js';
import * as view from './view.js';

function applySettingsToControls() {
  App.settings.brushSize = clampInt(
    App.settings.brushSize,
    BRUSH_SIZE_MIN,
    BRUSH_SIZE_MAX,
    BRUSH_SIZE_MIN,
  );
  els.sameColorChk.checked = !!App.settings.sameColorSelect;
  els.targetPixels.value = String(App.settings.targetPixels);
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
/** @param {any} st */
async function restoreProjectState(st) {
  if (!st.project) return;
  const projectError = validateProjectPayload(st.project);
  if (projectError) return { ok: false, error: projectError };
  // v2 状态载荷使用 base64 紧凑编码，v1 为数组；两者都兼容
  const grid =
    Array.isArray(st.project.grid) || st.project.grid instanceof Int16Array
      ? Int16Array.from(st.project.grid)
      : decodeInt16Grid(st.project.gridBase64) || new Int16Array(0);
  App.project = {
    width: st.project.width,
    height: st.project.height,
    grid,
  };
  App.baseGrid =
    Array.isArray(st.project.baseGrid) || st.project.baseGrid instanceof Int16Array
      ? Int16Array.from(st.project.baseGrid)
      : decodeInt16Grid(st.project.baseGridBase64) || App.project.grid.slice();
  App.maxColors =
    st.project.maxColors ||
    C.countUsedColors(App.project.grid, st.project.width, st.project.height) ||
    2;
  App.sliderN = st.project.sliderN ?? null;
  App.editedSinceSlider = !!st.project.editedSinceSlider;
  App.configName = st.project.paletteName || App.configName;
  // 已应用色板 = 上次保存/导入时画布所用的色板，画布与编辑工具按其显示
  // 色板配置（可编辑）以磁盘上的配置为准；快照与配置不一致时自动创建恢复配置
  /** @type {FusePaletteColor[] | null} */
  const snapPalette = st.project.palette?.length ? st.project.palette : null;
  App.appliedPalette = snapPalette
    ? snapPalette.map((c) => ({ ...c }))
    : App.appliedPalette.map((c) => ({ ...c }));
  if (snapPalette) {
    const preferred = App.configName || '恢复色板';
    const { name, created } = await palette.ensurePaletteConfig(snapPalette, preferred);
    App.configName = name;
    try {
      const res = await api.getConfig(name);
      App.palette = res.colors;
    } catch (_e) {
      App.palette = snapPalette.map((c) => ({ ...c }));
    }
    if (created || name !== preferred) scheduleAutosave();
  } else if (App.configName && App.configs.some((c) => c.name === App.configName)) {
    try {
      const res = await api.getConfig(App.configName);
      App.palette = res.colors;
    } catch (_e) {
      App.palette = [];
    }
  } else {
    App.palette = [];
  }
  els.configSelect.value = App.configName || '';
  palette.renderColorTable();
  return { ok: true };
}

const RESTORABLE_TOOLS = new Set([
  TOOLS.SELECT,
  TOOLS.BRUSH,
  TOOLS.ERASER,
  TOOLS.PICKER,
  TOOLS.WAND,
]);

/** @param {any} raw @param {FuseProject | null | undefined} project @returns {Set<number>} */
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

/** @param {any} vp @returns {boolean} */
function applySavedOriginalViewport(vp) {
  const oz = Number(vp?.origZoom);
  const op = vp?.origPan;
  if (
    !Number.isFinite(oz) ||
    oz <= 0 ||
    !op ||
    !Number.isFinite(Number(op.x)) ||
    !Number.isFinite(Number(op.y))
  ) {
    return false;
  }
  App.origZoom = oz;
  App.origPan = { x: Number(op.x), y: Number(op.y) };
  view.applyOriginalTransform();
  return true;
}

/** @param {any} vp @returns {boolean} */
function restoreViewport(vp) {
  const zoom = Number(vp?.zoom);
  const pan = vp?.pan;
  if (
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !pan ||
    !Number.isFinite(Number(pan.x)) ||
    !Number.isFinite(Number(pan.y))
  ) {
    return false;
  }
  App.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  App.pan = { x: Number(pan.x), y: Number(pan.y) };
  view.applyTransform();
  applySavedOriginalViewport(vp);
  return true;
}

// 对比原图显示的镜像状态：随状态 / 项目文档持久化，保证原图与拼豆图方向一致
/** @param {any} raw */
function restoreOriginalMirror(raw) {
  App.originalMirror.horizontal = !!raw?.horizontal;
  App.originalMirror.vertical = !!raw?.vertical;
}

/** @param {any} original */
function restoreOriginalMeta(original) {
  App.originalId = original?.id ? String(original.id) : null;
  App.originalName = original?.name ? String(original.name) : null;
  App.originalSha256 = original?.sha256 ? String(original.sha256) : null;
  App.originalSize =
    original && Number.isFinite(Number(original.size)) ? Number(original.size) : null;
}

// 恢复原图：preferCache 时先试浏览器缓存，缺失再回退后端保存的原图
/** @param {boolean} preferCache @returns {Promise<boolean>} */
async function restoreOriginalImage(preferCache) {
  let restored = preferCache ? await compare.restoreOriginalFromCache() : false;
  if (!restored && App.originalId) {
    try {
      const blob = await api.getOriginalBlob(App.originalId);
      restored = await compare.loadOriginalImage(blob);
    } catch (_e) {
      /* 忽略：无原图时对比保持关闭 */
    }
  }
  return restored;
}

// 原图就绪后按偏好开启对比原图；否则关闭对比 / 同步勾选
/** @param {any} vp */
function enableCompareIfReady(vp) {
  if (App.settings.compare && App.project && App.originalImage) {
    compare.setCompareEnabled(true, { silent: true });
    if (App.settings.syncPan) {
      view.mirrorBeadToOrig();
      view.applyOriginalTransform();
    } else {
      applySavedOriginalViewport(vp);
    }
    return;
  }
  App.settings.compare = false;
  App.settings.syncPan = false;
  els.chkCompare.checked = false;
  els.chkSyncPan.checked = false;
}

export async function restoreState() {
  let st;
  try {
    st = await api.getState();
  } catch (_e) {
    st = {};
  }
  // schemaVersion 只接受当前版本及以下；更高版本意味着由更新的应用写入，跳过恢复避免损坏
  if (st.schemaVersion != null && Number(st.schemaVersion) > STATE_SCHEMA_VERSION) {
    toast(
      `状态文件版本（${st.schemaVersion}）高于当前应用支持的版本（${STATE_SCHEMA_VERSION}），已跳过恢复`,
      {
        type: 'error',
      },
    );
    return;
  }
  if (st.settings) Object.assign(App.settings, st.settings);
  restoreOriginalMirror(st.originalMirror);
  applySettingsToControls();
  const projectRestored = await restoreProjectState(st);
  if (projectRestored && !projectRestored.ok) {
    toast(`状态恢复失败：${projectRestored.error}`, { type: 'error' });
  }

  App.history = sanitizeHistory(st.history);
  App.undoStack = sanitizeUndoStack(st.undo?.undoStack);
  App.redoStack = sanitizeUndoStack(st.undo?.redoStack);
  historyUI.renderHistoryUI();

  restoreOriginalMeta(st.original);
  App.projectName = st.projectName || (st.original?.name ? fileNameStem(st.original.name) : null);

  const editor = st.editor || {};
  App.selection = restoreSelection(editor.selection, App.project);
  App.brushColor =
    App.project &&
    Number.isInteger(editor.brushColor) &&
    editor.brushColor >= 0 &&
    editor.brushColor < App.appliedPalette.length
      ? editor.brushColor
      : null;
  App.dirty = !!editor.dirty && !!App.project;
  setDirty(App.dirty);
  App.projectDirty = !!st.projectDirty && !!App.project;

  renderFullNow();
  if (App.project) {
    if (!restoreViewport(st.viewport)) view.fitViewportToCanvas();
  }

  const storedTool = editor.tool;
  const tool = App.project && RESTORABLE_TOOLS.has(storedTool) ? storedTool : TOOLS.SELECT;
  toolState.setTool(tool);
  if (tool === TOOLS.BRUSH && App.brushColor == null) colorList.ensureBrushColor();

  // 先从浏览器缓存恢复原图；缓存缺失时回退到后端保存的原图
  await restoreOriginalImage(true);
  enableCompareIfReady(st.viewport);
}

/** @param {any} doc @param {string | null} [path] */
export async function applyProjectDocument(doc, path = null) {
  if (!doc?.project) {
    toast('项目文件缺少画布数据');
    return;
  }
  if (doc.schemaVersion != null && Number(doc.schemaVersion) > STATE_SCHEMA_VERSION) {
    toast(
      `项目文件版本（${doc.schemaVersion}）高于当前应用支持的版本（${STATE_SCHEMA_VERSION}），无法打开`,
      {
        type: 'error',
      },
    );
    return;
  }
  const projectError = validateProjectPayload(doc.project);
  if (projectError) {
    toast(`项目文件数据无效：${projectError}`, { type: 'error' });
    return;
  }
  // 打开项目后运行态全部重置，文档状态以文件为准
  App.selection = new Set();
  App.undoStack = [];
  App.redoStack = [];
  App.brushColor = null;
  interactionState.dragPreview = null;
  interactionState.crop = null;
  interactionState.cropActiveEdge = null;
  interactionState.cropPreview = null;
  interactionState.highlightColor = null;
  App.compressed = null;
  if (App.originalUrl) {
    try {
      URL.revokeObjectURL(App.originalUrl);
    } catch (_e) {
      /* ignore */
    }
  }
  App.originalFile = null;
  App.originalImage = null;
  App.originalUrl = null;
  App.tool = TOOLS.SELECT;
  mirror.resetMirror(); // 打开项目后丢弃未应用的镜像预览

  if (doc.settings) Object.assign(App.settings, doc.settings);
  restoreOriginalMirror(doc.originalMirror);
  applySettingsToControls();
  await restoreProjectState({ project: doc.project, settings: doc.settings });

  App.history = sanitizeHistory(doc.history);
  historyUI.renderHistoryUI();

  restoreOriginalMeta(doc.original);
  App.projectName = path
    ? fileNameStem(String(path).split(/[\\/]/).pop())
    : doc.original?.name
      ? fileNameStem(doc.original.name)
      : '未命名';

  setDirty(false);
  setProjectDirty(false);
  renderFullNow();
  if (!restoreViewport(doc.viewport)) view.fitViewportToCanvas();
  toolState.setTool(TOOLS.SELECT);

  // 打开项目时以项目文件引用的原图为准（不信任浏览器缓存）
  await restoreOriginalImage(false);
  enableCompareIfReady(doc.viewport);
  scheduleAutosave();
  toast('已打开项目');
}
