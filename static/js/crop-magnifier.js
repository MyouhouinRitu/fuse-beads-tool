// 裁剪放大镜：低缩放下显示鼠标悬停位置 11×11 的放大视图。

import { getDisplayData } from './canvas.js';
import {
  CROP_MAGNIFIER_GAP,
  CROP_MAGNIFIER_MIN_CELL,
  CROP_MAGNIFIER_MIN_SCREEN_CELL,
  CROP_MAGNIFIER_OUTSIDE,
  CROP_MAGNIFIER_SCALE,
  CROP_MAGNIFIER_SIZE,
  CROP_MAGNIFIER_WINDOW_MARGIN,
  TOOLS,
} from './constants.js';
import { els } from './els.js';
import { interactionState } from './interaction.js';
import { drawPatternBase, strokeCropEdges, strokeCropPreview } from './render.js';
import { App, dragState } from './state.js';
import { hideCropMagnifier } from './utils.js';

let cropLastMouse = null; // 裁剪模式最近一次鼠标位置（缩放后重绘放大镜用）
let magnifierOffCanvas = null; // 复用离屏画布，避免 mousemove 每帧新建
let magnifierLastDisplay = null;
let magnifierDrawKey = null;

// 放大镜：低缩放下显示鼠标悬停位置 11×11 的放大视图。
// 窗口内容复用底图渲染器（与工作区同一套网格/空位/行列号规范），只叠加裁剪框。
function drawCropMagnifier() {
  const canvas = els.cropMagnifierCanvas;
  const n = CROP_MAGNIFIER_SIZE;
  // 放大后每格尺寸 = 当前屏幕格宽 × 倍率（至少 16px，保证可见）
  const cell = Math.max(
    CROP_MAGNIFIER_MIN_CELL,
    Math.round(App.screenCell * App.zoom * CROP_MAGNIFIER_SCALE),
  );
  const { width, height } = App.project;
  const hx = interactionState.hoverCell.x;
  const hy = interactionState.hoverCell.y;
  const dark = document.documentElement.dataset.theme === 'dark';
  const outsideColor = dark ? CROP_MAGNIFIER_OUTSIDE.dark : CROP_MAGNIFIER_OUTSIDE.light;
  // 始终以鼠标悬停格为中心（不夹紧到图案边界），边缘处可看到行列号条与外部区域
  const off = Math.floor((n - 1) / 2);
  const x0 = hx - off;
  const y0 = hy - off;
  // 窗口内容先画到离屏画布（含行列号条，不含色号），图案外区域保持透明；
  // 底图渲染器只画窗口内的格子，避免大图逐帧全量重绘
  const display = getDisplayData();
  const crop = interactionState.crop;
  const preview = interactionState.cropPreview;
  const drawKey = [
    hx,
    hy,
    cell,
    dark,
    App.settings.emptyStyle,
    crop ? `${crop.x0},${crop.y0},${crop.x1},${crop.y1}` : '',
    interactionState.cropActiveEdge || '',
    preview ? `${preview.horizontal},${preview.pos}` : '',
  ].join('|');
  if (display === magnifierLastDisplay && drawKey === magnifierDrawKey) return; // 内容未变
  magnifierLastDisplay = display;
  magnifierDrawKey = drawKey;

  if (!magnifierOffCanvas) magnifierOffCanvas = document.createElement('canvas');
  const octx = magnifierOffCanvas.getContext('2d');
  drawPatternBase(octx, width, height, display.idx, display.rgb, {
    cell,
    outerPad: 0,
    gridLines: true,
    hatch: true,
    emptyStyle: App.settings.emptyStyle,
    edgeNumbers: true,
    showCodes: false,
    viewport: { x0, y0, x1: x0 + n - 1, y1: y0 + n - 1 },
  });
  canvas.width = n * cell;
  canvas.height = n * cell;
  const ctx2 = canvas.getContext('2d');
  // 图案之外（含四角）：夜间用 UI 灰色，日间用浅灰
  ctx2.fillStyle = outsideColor;
  ctx2.fillRect(0, 0, canvas.width, canvas.height);
  ctx2.drawImage(magnifierOffCanvas, 0, 0);
  // 裁剪元素：红实线 / 选中边蓝实线 / 预览红虚线（放大镜内同样显示，不画中心格方框）
  if (interactionState.crop) {
    const ox = -x0 * cell;
    const oy = -y0 * cell;
    strokeCropEdges(ctx2, interactionState.crop, interactionState.cropActiveEdge, cell, ox, oy, 2);
    if (interactionState.cropPreview && !dragState.cropEdge) {
      strokeCropPreview(ctx2, interactionState.cropPreview, cell, ox, oy, n * cell, n * cell, {
        lineWidth: 2,
        dash: [6, 5],
      });
    }
  }
}

function positionCropMagnifier(e) {
  const el = els.cropMagnifier;
  const w = el.offsetWidth || 300;
  const h = el.offsetHeight || 300;
  const pad = CROP_MAGNIFIER_GAP;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  if (left + w > (window.innerWidth || 0) - CROP_MAGNIFIER_WINDOW_MARGIN)
    left = e.clientX - w - pad;
  if (top + h > (window.innerHeight || 0) - CROP_MAGNIFIER_WINDOW_MARGIN) top = e.clientY - h - pad;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function updateCropMagnifier(e) {
  const el = els.cropMagnifier;
  if (
    App.tool !== TOOLS.CROP ||
    !App.project ||
    !interactionState.hoverCell ||
    App.screenCell * App.zoom >= CROP_MAGNIFIER_MIN_SCREEN_CELL
  ) {
    hideCropMagnifier();
    return;
  }
  drawCropMagnifier();
  positionCropMagnifier(e);
  el.classList.remove('hidden');
}

// 缩放/主题变化后重新评估放大镜是否显示并重绘
export function refreshCropMagnifier() {
  if (cropLastMouse) updateCropMagnifier(cropLastMouse);
  else hideCropMagnifier();
}

export function rememberCropMouse(e) {
  cropLastMouse = { clientX: e.clientX, clientY: e.clientY };
}
