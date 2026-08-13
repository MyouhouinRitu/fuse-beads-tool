// 状态持久化：构建保存载荷、防抖自动保存。

import { AUTOSAVE_DELAY_MS } from './constants.js';
import * as api from './api.js';
import { els } from './els.js';
import { App } from './state.js';
import { getTargetPixels } from './utils.js';

export function buildStatePayload() {
  return {
    settings: {
      ...App.settings,
      targetPixels: getTargetPixels(),
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

export function scheduleAutosave() {
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
