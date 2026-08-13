// 工具模式状态与相关控件：切换工具、模式控件显隐、模式标签。

import { TOOLS } from './constants.js';
import { els } from './els.js';
import { App } from './state.js';
import { hideCropMagnifier, toast } from './utils.js';
import { scheduleCanvasRender } from './render-queue.js';

// 工具 → UI 的映射（按钮 / 画布模式类 / 模式标签），避免 setTool 里逐行手写
const TOOL_UI = [
  { tool: TOOLS.BRUSH, btn: 'toolBrush', modeClass: 'mode-brush', label: '画笔模式' },
  { tool: TOOLS.PICKER, btn: 'toolPicker', modeClass: 'mode-picker', label: '取色模式' },
  { tool: TOOLS.ERASER, btn: 'toolEraser', modeClass: 'mode-eraser', label: '橡皮模式' },
  { tool: TOOLS.CROP, btn: 'toolCrop', modeClass: 'mode-crop', label: '裁剪模式' },
];
const TOOL_LABELS = { [TOOLS.SELECT]: '选择模式' };
for (const u of TOOL_UI) TOOL_LABELS[u.tool] = u.label;

// 模式相关控件：画笔/橡皮显示尺寸拖动条；选择模式显示同色选区与选中高亮颜色
export function updateModeControls() {
  const size = String(App.settings.brushSize);
  if (els.brushSize.value !== size) els.brushSize.value = size;
  if (els.brushSizeValue.textContent !== size) els.brushSizeValue.textContent = size;
  els.brushSizeWrap.classList.toggle('hidden', App.tool !== TOOLS.BRUSH && App.tool !== TOOLS.ERASER);
  els.selectionControls.classList.toggle('hidden', App.tool !== TOOLS.SELECT);
  els.cropControls.classList.toggle('hidden', App.tool !== TOOLS.CROP);
  const disabled = App.highlightColor == null;
  if (els.selectHighlightBtn.disabled !== disabled) els.selectHighlightBtn.disabled = disabled;
}

// 进入裁剪模式时初始化矩形 = 整张图
function initCropRect() {
  if (!App.project) return;
  App.crop = { x0: 0, y0: 0, x1: App.project.width - 1, y1: App.project.height - 1 };
  App.cropActiveEdge = null;
  App.cropPreview = null;
}

export function setTool(t) {
  if (App.tool === t) return;
  if (t === TOOLS.CROP && !App.project) {
    toast('请先导入一张图片');
    return;
  }
  // 离开裁剪模式：丢弃未应用的裁剪
  if (App.tool === TOOLS.CROP && t !== TOOLS.CROP) {
    App.crop = null;
    App.cropActiveEdge = null;
    App.cropPreview = null;
    hideCropMagnifier();
  }
  App.tool = t;
  for (const u of TOOL_UI) {
    els[u.btn].classList.toggle('active', t === u.tool);
    els.canvas.classList.toggle(u.modeClass, t === u.tool);
  }
  if (t === TOOLS.BRUSH || t === TOOLS.ERASER) {
    // 画笔/橡皮模式下选区没有意义，进入时清空；色号高亮保留
    App.selection = new Set();
    App.dragPreview = null;
  }
  if (t === TOOLS.CROP) {
    // 裁剪模式：清空选区，初始矩形 = 整图
    App.selection = new Set();
    App.dragPreview = null;
    initCropRect();
  }
  document.body.classList.toggle('crop-active', t === TOOLS.CROP);
  // 切换工具后重绘 overlay，让 hover 边框样式随之更新（底图与工具无关）
  scheduleCanvasRender();
  updateModeControls();
  els.modeLabel.textContent = TOOL_LABELS[t] || '选择模式';
}
