// 工具模式状态与相关控件：切换工具、模式控件显隐、模式标签。

import { TOOLS, WAND_SENSITIVITY_DEFAULT } from './constants.js';
import { els } from './els.js';
import { interactionState } from './interaction.js';
import * as mirror from './mirror.js';
import { scheduleCanvasRender } from './render-queue.js';
import { App } from './state.js';
import { hideCropMagnifier, toast } from './utils.js';

// 工具 → UI 的映射（按钮 / 画布模式类 / 模式标签），避免 setTool 里逐行手写
const TOOL_UI = [
  { tool: TOOLS.BRUSH, btn: 'toolBrush', modeClass: 'mode-brush', label: '画笔模式' },
  { tool: TOOLS.PICKER, btn: 'toolPicker', modeClass: 'mode-picker', label: '取色模式' },
  { tool: TOOLS.ERASER, btn: 'toolEraser', modeClass: 'mode-eraser', label: '橡皮模式' },
  { tool: TOOLS.CROP, btn: 'toolCrop', modeClass: 'mode-crop', label: '裁剪模式' },
  { tool: TOOLS.WAND, btn: 'toolWand', modeClass: 'mode-wand', label: '魔棒模式' },
  { tool: TOOLS.MIRROR, btn: 'toolMirror', modeClass: 'mode-mirror', label: '镜像模式' },
];
const TOOL_LABELS = { [TOOLS.SELECT]: '选择模式' };
for (const u of TOOL_UI) TOOL_LABELS[u.tool] = u.label;

// 模式相关控件：画笔/橡皮显示尺寸拖动条；选择模式显示同色选区与选中高亮颜色
export function updateModeControls() {
  const size = String(App.settings.brushSize);
  if (els.brushSize.value !== size) els.brushSize.value = size;
  if (els.brushSizeValue.textContent !== size) els.brushSizeValue.textContent = size;
  els.brushSizeWrap.classList.toggle(
    'hidden',
    App.tool !== TOOLS.BRUSH && App.tool !== TOOLS.ERASER,
  );
  const sens = Number.isFinite(App.settings.wandSensitivity)
    ? App.settings.wandSensitivity
    : WAND_SENSITIVITY_DEFAULT;
  if (els.wandSensitivity.value !== String(sens)) els.wandSensitivity.value = String(sens);
  if (els.wandSensitivityValue.textContent !== String(sens))
    els.wandSensitivityValue.textContent = String(sens);
  els.wandSensitivityWrap.classList.toggle('hidden', App.tool !== TOOLS.WAND);
  els.selectionControls.classList.toggle('hidden', App.tool !== TOOLS.SELECT);
  els.cropControls.classList.toggle('hidden', App.tool !== TOOLS.CROP);
  els.mirrorControls.classList.toggle('hidden', App.tool !== TOOLS.MIRROR);
  const disabled = interactionState.highlightColor == null;
  if (els.selectHighlightBtn.disabled !== disabled) els.selectHighlightBtn.disabled = disabled;
}

// 进入裁剪模式时初始化矩形 = 整张图
function initCropRect() {
  if (!App.project) return;
  interactionState.crop = { x0: 0, y0: 0, x1: App.project.width - 1, y1: App.project.height - 1 };
  interactionState.cropActiveEdge = null;
  interactionState.cropPreview = null;
}

export function setTool(t) {
  if (App.tool === t) return;
  if (t === TOOLS.CROP && !App.project) {
    toast('请先导入一张图片');
    return;
  }
  // 进入镜像模式前校验项目；离开镜像模式时丢弃未应用的预览（恢复进入前的网格与显示）
  if (t === TOOLS.MIRROR && !App.project) {
    toast('请先导入一张图片');
    return;
  }
  // 离开裁剪模式：丢弃未应用的裁剪
  if (App.tool === TOOLS.CROP && t !== TOOLS.CROP) {
    interactionState.crop = null;
    interactionState.cropActiveEdge = null;
    interactionState.cropPreview = null;
    hideCropMagnifier();
  }
  // 离开镜像模式：恢复未应用的预览（应用镜像时先由 applyMirror 提交再退出，此处为无操作）
  if (App.tool === TOOLS.MIRROR && t !== TOOLS.MIRROR) {
    mirror.cancelMirror();
  }
  App.tool = t;
  for (const u of TOOL_UI) {
    els[u.btn].classList.toggle('active', t === u.tool);
    els[u.btn].setAttribute('aria-pressed', String(t === u.tool));
    els.canvas.classList.toggle(u.modeClass, t === u.tool);
  }
  if (t === TOOLS.BRUSH || t === TOOLS.ERASER) {
    // 画笔/橡皮模式下选区没有意义，进入时清空；色号高亮保留
    App.selection = new Set();
    interactionState.dragPreview = null;
  }
  if (t === TOOLS.CROP) {
    // 裁剪模式：清空选区，初始矩形 = 整图
    App.selection = new Set();
    interactionState.dragPreview = null;
    initCropRect();
  }
  if (t === TOOLS.MIRROR) {
    // 镜像模式：清空选区，初始化预览（保存进入前网格，勾选后即时预览）
    App.selection = new Set();
    interactionState.dragPreview = null;
    mirror.enterMirror();
  }
  document.body.classList.toggle('crop-active', t === TOOLS.CROP);
  // 切换工具后重绘 overlay，让 hover 边框样式随之更新（底图与工具无关）
  scheduleCanvasRender();
  updateModeControls();
  els.modeLabel.textContent = TOOL_LABELS[t] || '选择模式';
}
