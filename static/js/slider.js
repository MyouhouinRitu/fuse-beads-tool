// 颜色数量滑块：从基副本按 N 色重算工作网格（结构性重建）。

import { scheduleAutosave } from './autosave.js';
import * as canvas from './canvas.js';
import { mergeGridAsync } from './color-queue.js';
import * as C from './colors.js';
import { SLIDER_APPLY_DELAY_MS, TOOLS } from './constants.js';
import { els } from './els.js';
import * as historyUI from './history-ui.js';
import { confirmDialog } from './popup.js';
import { renderFullNow } from './render-queue.js';
import { App, clearHistoryRecords, hasPendingRecords, setProjectDirty } from './state.js';
import * as toolState from './tool-state.js';

// 调整滑块会清空历史 / 撤销记录的确认提示文案
const SLIDER_CONFIRM_MESSAGE =
  '调整滑块将清空全部快照与撤销记录，并丢弃滑块调整后的编辑，按新的颜色数量重新生成图案。是否继续？';

let sliderTimer = null;
let sliderApplying = false;
let confirmPending = false; // 确认框已弹出，等待用户结果（期间忽略新的 input）
let sliderConfirmed = false; // 本次已确认，applySlider 不再重复弹窗
let sliderCanceled = false; // 本次交互已取消，不再弹窗 / 应用

// 当前已应用的颜色数量（用于取消确认后回退滑块显示）
function currentSliderValue() {
  if (!App.project) return 2;
  const baseUsed = App.baseGrid
    ? C.countUsedColors(App.baseGrid, App.project.width, App.project.height)
    : 0;
  return App.sliderN ?? Math.max(2, baseUsed);
}

// 从基副本按颜色数量 N 生成工作副本（有确认提示；已由 scheduleSliderApply 提前确认时跳过）
export async function applySlider(n) {
  if (!App.project) return;
  const hasHistory = hasPendingRecords();
  if (!sliderConfirmed && (hasHistory || App.editedSinceSlider)) {
    if (!(await confirmDialog(SLIDER_CONFIRM_MESSAGE))) {
      els.colorSlider.value = String(currentSliderValue());
      els.sliderValue.textContent = String(currentSliderValue());
      return;
    }
  }
  sliderConfirmed = false; // 本次确认已消费，下次拖动重新判定
  App.project.grid =
    (await mergeGridAsync(
      App.baseGrid,
      App.project.width,
      App.project.height,
      App.appliedPalette,
      App.settings.useLab,
      n,
    )) ?? canvas.mergeGrid(App.baseGrid, App.appliedPalette, App.settings.useLab, n);
  if (hasHistory || App.editedSinceSlider) {
    // 合并完成后再清空，避免历史已清但画布仍是旧状态的不一致窗口
    clearHistoryRecords();
    historyUI.renderHistoryUI();
  }
  App.sliderN = n;
  App.editedSinceSlider = false;
  setProjectDirty(true);
  canvas.resetProjectEditingState();
  toolState.setTool(TOOLS.SELECT); // 修改颜色数量后回到选择模式
  renderFullNow();
  scheduleAutosave();
}

// 新一次拖动 / 键盘调整开始时复位「已取消」状态
export function resetSliderSession() {
  sliderCanceled = false;
}

// 完整重置滑块会话 / 确认状态（测试与异常恢复用）
export function resetSliderState() {
  clearTimeout(sliderTimer);
  sliderTimer = null;
  sliderApplying = false;
  confirmPending = false;
  sliderConfirmed = false;
  sliderCanceled = false;
}

// 滑块 input 高频触发：需要确认时立即弹出确认框（不等防抖），
// 确认 / 取消后按防抖调度或回退，避免拖动过程中反复弹窗与全量重算。
export function scheduleSliderApply() {
  if (sliderApplying) return;
  const needsConfirm = hasPendingRecords() || App.editedSinceSlider;
  if (needsConfirm && !sliderConfirmed && !sliderCanceled) {
    if (confirmPending) return;
    confirmPending = true;
    confirmDialog(SLIDER_CONFIRM_MESSAGE).then((ok) => {
      confirmPending = false;
      if (ok) {
        sliderConfirmed = true;
        scheduleSliderApply(); // 重新进入，直接走防抖调度
      } else {
        sliderCanceled = true;
        els.colorSlider.value = String(currentSliderValue());
        els.sliderValue.textContent = String(currentSliderValue());
      }
    });
    return;
  }
  if (sliderCanceled) return;
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(() => {
    sliderTimer = null;
    sliderApplying = true;
    applySlider(parseInt(els.colorSlider.value, 10)).finally(() => {
      sliderApplying = false;
    });
  }, SLIDER_APPLY_DELAY_MS);
}
