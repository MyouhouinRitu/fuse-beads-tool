// 画布工具：模式按钮 / 裁剪 / 选中高亮颜色。

import * as canvas from './canvas.js';
import * as colorList from './color-list.js';
import { TOOLS } from './constants.js';
import * as crop from './crop.js';
import { els } from './els.js';
import * as highlight from './highlight.js';
import * as historyUI from './history-ui.js';
import { interactionState } from './interaction.js';
import * as mirror from './mirror.js';
import { scheduleCanvasRender } from './render-queue.js';
import { App } from './state.js';
import * as toolState from './tool-state.js';

export function bindTools() {
  // 模式按钮：画笔/橡皮/取色互斥切换（画笔未选色时先取调色板最暗色）
  for (const [btnKey, tool] of [
    ['toolBrush', TOOLS.BRUSH],
    ['toolEraser', TOOLS.ERASER],
    ['toolPicker', TOOLS.PICKER],
    ['toolCrop', TOOLS.CROP],
    ['toolWand', TOOLS.WAND],
    ['toolMirror', TOOLS.MIRROR],
  ]) {
    els[btnKey].addEventListener('click', () => {
      if (tool === TOOLS.BRUSH && !colorList.ensureBrushColor()) return;
      toolState.setTool(App.tool === tool ? TOOLS.SELECT : tool);
    });
  }
  // 镜像模式：勾选水平 / 垂直即时预览；点击「应用」才提交并退出镜像模式
  els.mirrorH.addEventListener('change', () => mirror.toggleMirror('horizontal'));
  els.mirrorV.addEventListener('change', () => mirror.toggleMirror('vertical'));
  els.btnApplyMirror.addEventListener('click', () => {
    mirror.applyMirror();
    historyUI.renderHistoryUI(); // 应用后同步撤销 / 重做按钮状态
    toolState.setTool(TOOLS.SELECT);
  });
  els.btnAutoCrop.addEventListener('click', crop.autoCrop);
  els.btnApplyCrop.addEventListener('click', crop.applyCrop);
  els.selectHighlightBtn.addEventListener('click', () => {
    // 选中高亮颜色：先取消当前选择，再选中该色号全部像素，并取消高亮显示
    if (interactionState.highlightColor == null || !App.project) return;
    const color = interactionState.highlightColor;
    const { grid } = App.project;
    const next = new Set();
    for (let p = 0; p < grid.length; p++) {
      if (grid[p] === color) next.add(p);
    }
    App.selection = next;
    interactionState.dragPreview = null;
    interactionState.highlightColor = null;
    canvas.syncHighlightBlink();
    highlight.renderHighlightColorList();
    scheduleCanvasRender();
    toolState.updateModeControls();
  });
}
