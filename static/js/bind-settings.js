// 设置控件：显示编号 / 锐化 / 目标像素 / 颜色距离 / 滑块 / 空格样式 / 同色选择 / 画笔与魔棒参数。

import { scheduleAutosave } from './autosave.js';
import * as canvas from './canvas.js';
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
} from './constants.js';
import { els } from './els.js';
import { scheduleCanvasRender } from './render-queue.js';
import { resetSliderSession, scheduleSliderApply } from './slider.js';
import { App, setProjectDirty } from './state.js';
import * as toolState from './tool-state.js';
import { clampInt, getTargetPixels, hintDistanceDeferred } from './utils.js';

export function bindSettings() {
  els.chkCodes.addEventListener('change', () => {
    App.settings.showCodes = els.chkCodes.checked;
    canvas.rebuildCanvas();
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
  els.targetPixels.addEventListener('change', () => {
    // 失焦时把越界值收敛到合法区间，避免显示值与实际使用值不一致
    els.targetPixels.value = String(getTargetPixels());
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
    els.sliderValue.textContent = els.colorSlider.value;
    scheduleSliderApply();
  });
  // 新一次拖动 / 键盘调整开始时复位「已取消」状态，避免上一次取消影响本次操作
  els.colorSlider.addEventListener('pointerdown', resetSliderSession);
  els.colorSlider.addEventListener('keydown', resetSliderSession);
  els.emptyStyle.addEventListener('change', () => {
    App.settings.emptyStyle = els.emptyStyle.value;
    canvas.rebuildCanvas();
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.sameColorChk.addEventListener('change', () => {
    App.settings.sameColorSelect = els.sameColorChk.checked;
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.brushSize.addEventListener('input', () => {
    App.settings.brushSize = clampInt(
      els.brushSize.value,
      BRUSH_SIZE_MIN,
      BRUSH_SIZE_MAX,
      BRUSH_SIZE_MIN,
    );
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
}
