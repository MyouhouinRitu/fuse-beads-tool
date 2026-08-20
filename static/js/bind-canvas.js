// 画布交互：缩放 / 适配 / 拖拽 / 滚轮 / 右键菜单。

import { scheduleAutosave } from './autosave.js';
import { ZOOM_BUTTON_FACTOR } from './constants.js';
import * as drag from './drag.js';
import { els } from './els.js';
import * as quickPicker from './quick-picker.js';
import { setProjectDirty } from './state.js';
import * as view from './view.js';

export function bindCanvas() {
  // 缩放按钮：围绕工作区中心缩放
  /** @type {Array<[keyof typeof els, number]>} */
  const zoomSteps = [
    ['zoomIn', ZOOM_BUTTON_FACTOR],
    ['zoomOut', 1 / ZOOM_BUTTON_FACTOR],
  ];
  for (const [btnKey, factor] of zoomSteps) {
    els[btnKey].addEventListener('click', () => {
      const vp = els.canvasScroll;
      const r = vp.getBoundingClientRect();
      view.zoomAtCore(r.left + r.width / 2, r.top + r.height / 2, factor);
      setProjectDirty(true);
      scheduleAutosave();
    });
  }
  els.zoomFit.addEventListener('click', () => {
    view.fitViewportToCanvas();
    setProjectDirty(true);
    scheduleAutosave();
  });

  els.canvasScroll.addEventListener('pointerdown', drag.onCanvasPointerDown);
  window.addEventListener('pointermove', drag.onWindowPointerMove);
  window.addEventListener('pointerup', drag.onWindowPointerUp);
  els.canvasScroll.addEventListener('pointerleave', drag.onCanvasScrollPointerLeave);
  // 九宫格：鼠标移出弹窗时还原悬停预览的颜色
  els.quickPicker.addEventListener('mouseleave', quickPicker.restoreQuickPickerPreview);
  // 全域禁用右键菜单：工具不需要右键菜单，避免拖拽结束时在菜单栏等位置弹出；
  // 输入框保留原生菜单（粘贴 / 拼写检查等，登录 Token、色号、Hex 等都需要粘贴）
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t?.closest?.('input, textarea, select')) return;
    e.preventDefault();
  });

  els.canvasScroll.addEventListener('wheel', drag.onCanvasWheel, { passive: false });
  els.compareOriginal.addEventListener('pointerdown', drag.onComparePointerDown);
  els.compareOriginal.addEventListener('wheel', drag.onCompareWheel, { passive: false });
}
