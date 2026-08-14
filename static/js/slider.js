// 颜色数量滑块：从基副本按 N 色重算工作网格（结构性重建）。

import { scheduleAutosave } from './autosave.js';
import * as canvas from './canvas.js';
import * as C from './colors.js';
import { els } from './els.js';
import * as historyUI from './history-ui.js';
import { renderAllNow } from './render-queue.js';
import { App, clearHistoryRecords, hasPendingRecords, setProjectDirty } from './state.js';

// 从基副本按颜色数量 N 生成工作副本（有确认提示）
export function applySlider(n) {
  if (!App.project) return;
  const baseUsed = App.baseGrid
    ? C.countUsedColors(App.baseGrid, App.project.width, App.project.height)
    : 0;
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
