// 状态持久化：构建保存载荷、防抖自动保存。

import * as api from './api.js';
import { AUTOSAVE_DELAY_MS } from './constants.js';
import { els } from './els.js';
import { paletteHash } from './hash.js';
import { App } from './state.js';
import { getTargetPixels } from './utils.js';

export const STATE_SCHEMA_VERSION = 1;

export function buildStatePayload() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    savedAt: Date.now(),
    settings: {
      ...App.settings,
      targetPixels: getTargetPixels(),
    },
    viewport: {
      zoom: App.zoom,
      pan: { ...App.pan },
      origZoom: App.origZoom,
      origPan: { ...App.origPan },
    },
    editor: {
      tool: App.tool,
      brushColor: App.brushColor,
      dirty: App.dirty,
      selection: App.selection.size ? Array.from(App.selection).sort((a, b) => a - b) : [],
    },
    projectDirty: App.projectDirty,
    projectName: App.projectName,
    project: App.project
      ? {
          width: App.project.width,
          height: App.project.height,
          grid: Array.from(App.project.grid),
          baseGrid: App.baseGrid ? Array.from(App.baseGrid) : null,
          sliderN: App.sliderN,
          editedSinceSlider: App.editedSinceSlider,
          paletteName: App.configName,
          palette: App.appliedPalette.map((c) => ({ ...c })),
          paletteHash: paletteHash(App.appliedPalette),
          maxColors: App.maxColors,
        }
      : null,
    undo: {
      undoStack: App.undoStack,
      redoStack: App.redoStack,
    },
    history: App.history,
    original: App.originalId
      ? {
          id: App.originalId,
          name: App.originalName,
          sha256: App.originalSha256,
          size: App.originalSize,
        }
      : null,
  };
}

export function buildProjectDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    savedAt: Date.now(),
    viewport: {
      zoom: App.zoom,
      pan: { ...App.pan },
      origZoom: App.origZoom,
      origPan: { ...App.origPan },
    },
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
    project: App.project
      ? {
          width: App.project.width,
          height: App.project.height,
          grid: Array.from(App.project.grid),
          baseGrid: App.baseGrid ? Array.from(App.baseGrid) : null,
          sliderN: App.sliderN,
          editedSinceSlider: App.editedSinceSlider,
          paletteName: App.configName,
          palette: App.appliedPalette.map((c) => ({ ...c })),
          paletteHash: paletteHash(App.appliedPalette),
          maxColors: App.maxColors,
        }
      : null,
    history: App.history,
    original: App.originalId
      ? {
          id: App.originalId,
          name: App.originalName,
          sha256: App.originalSha256,
          size: App.originalSize,
        }
      : null,
  };
}

export function defaultProjectFileName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const date = `${y}${m}${d}`;
  const stem = String(App.originalName || '').replace(/\.[^.]+$/, '') || '未命名';
  return `${date}_${stem}_拼豆图.ssfbp`;
}

export function scheduleAutosave() {
  clearTimeout(App.saveTimer);
  App.saveTimer = setTimeout(saveStateNow, AUTOSAVE_DELAY_MS);
}

async function saveStateNow() {
  try {
    await api.putState(buildStatePayload());
    els.autosave.textContent = `已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  } catch (_err) {
    els.autosave.textContent = '自动保存失败';
  }
}
