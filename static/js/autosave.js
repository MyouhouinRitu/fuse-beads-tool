// 状态持久化：构建保存载荷、防抖自动保存。

import * as api from './api.js';
import { AUTOSAVE_DELAY_MS } from './constants.js';
import { els } from './els.js';
import { encodeInt16Grid } from './grid-codec.js';
import { paletteHash } from './hash.js';
import { App } from './state.js';
import { getTargetPixels } from './utils.js';

// v2：project/history 的网格改为 base64 紧凑编码（读取端兼容 v1 数组格式）
export const STATE_SCHEMA_VERSION = 2;

function buildViewportPayload() {
  return {
    zoom: App.zoom,
    pan: { ...App.pan },
    origZoom: App.origZoom,
    origPan: { ...App.origPan },
  };
}

function buildProjectPayload() {
  return App.project
    ? {
        width: App.project.width,
        height: App.project.height,
        gridBase64: encodeInt16Grid(App.project.grid),
        baseGridBase64: App.baseGrid ? encodeInt16Grid(App.baseGrid) : null,
        sliderN: App.sliderN,
        editedSinceSlider: App.editedSinceSlider,
        paletteName: App.configName,
        palette: App.appliedPalette.map((c) => ({ ...c })),
        paletteHash: paletteHash(App.appliedPalette),
        maxColors: App.maxColors,
      }
    : null;
}

// 自动保存载荷专用：快照网格编码为 base64；内存态与项目文档（.ssfbp）仍保持数组
function encodeHistoryForState(history) {
  return {
    ...history,
    items: history.items.map((it) => {
      if (!it.snapshot) return it;
      const { grid, ...snapshot } = it.snapshot;
      return { ...it, snapshot: { ...snapshot, gridBase64: encodeInt16Grid(grid) } };
    }),
  };
}

function buildOriginalPayload() {
  return App.originalId
    ? {
        id: App.originalId,
        name: App.originalName,
        sha256: App.originalSha256,
        size: App.originalSize,
      }
    : null;
}

export function buildStatePayload() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    savedAt: Date.now(),
    settings: {
      ...App.settings,
      targetPixels: getTargetPixels(),
    },
    viewport: buildViewportPayload(),
    editor: {
      tool: App.tool,
      brushColor: App.brushColor,
      dirty: App.dirty,
      selection: App.selection.size ? Array.from(App.selection).sort((a, b) => a - b) : [],
    },
    projectDirty: App.projectDirty,
    projectName: App.projectName,
    project: buildProjectPayload(),
    undo: {
      undoStack: App.undoStack,
      redoStack: App.redoStack,
    },
    history: encodeHistoryForState(App.history),
    original: buildOriginalPayload(),
  };
}

export function buildProjectDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    savedAt: Date.now(),
    viewport: buildViewportPayload(),
    projectName: App.projectName, // 后端生成默认项目文件名时的命名回退
    settings: {
      targetPixels: getTargetPixels(),
      useLab: App.settings.useLab,
      sharpen: App.settings.sharpen,
      showCodes: App.settings.showCodes,
      emptyStyle: App.settings.emptyStyle,
      compare: App.settings.compare,
      syncPan: App.settings.syncPan,
      brushSize: App.settings.brushSize,
      sameColorSelect: App.settings.sameColorSelect,
      wandSensitivity: App.settings.wandSensitivity,
    },
    project: buildProjectPayload(),
    history: App.history,
    original: buildOriginalPayload(),
  };
}

export function scheduleAutosave() {
  clearTimeout(App.saveTimer);
  App.saveTimer = setTimeout(saveStateNow, AUTOSAVE_DELAY_MS);
}

let saveInFlight = false;
let saveQueued = false;

async function writeState() {
  try {
    await api.putState(buildStatePayload());
    els.autosave.textContent = `已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  } catch (_err) {
    els.autosave.textContent = '自动保存失败，修改可能丢失';
  }
}

// 自动保存写串行化：同一时间只发一个 PUT，避免前一次慢请求晚于后一次完成、
// 把较旧的状态覆盖到较新的状态上；排队期间有新的保存请求时，完成后立即补写最新载荷。
async function saveStateNow() {
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  try {
    do {
      saveQueued = false;
      await writeState();
    } while (saveQueued);
  } finally {
    saveInFlight = false;
  }
}
