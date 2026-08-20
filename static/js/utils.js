// 跨模块共享的小工具：提示、下载、颜色文案、数值收敛、几何换算等。

import {
  DEFAULT_TARGET_PIXELS,
  HINT_THROTTLE_MS,
  TARGET_PIXELS_MAX,
  TARGET_PIXELS_MIN,
  TOAST_DURATION_MS,
  TOAST_FADE_MS,
  VIEWPORT_PADDING,
  ZOOM_MIN,
} from './constants.js';
import { els } from './els.js';
import { App } from './state.js';

/** @type {Array<{ text: string, important: boolean, type: string }>} */
const toastQueue = [];
let toastVisible = false;
let toastImportant = false;
/** @type {{ text: string, important: boolean, type: string } | null} */
let pendingNormal = null;

/** @param {string} msg @param {{ important?: boolean, type?: string }} [opts] */
export function toast(msg, { important = false, type = 'info' } = {}) {
  const text = String(msg);
  const item = { text, important, type };
  if (important) {
    toastQueue.push(item);
    if (!toastVisible) showNextToast();
    return;
  }
  if (!toastVisible) {
    showToast(text, false, type);
    return;
  }
  if (toastImportant) {
    pendingNormal = item;
    return;
  }
  clearTimeout(App.toastTimer ?? undefined);
  showToast(text, false, type);
}

function showNextToast() {
  if (toastQueue.length) {
    const item = toastQueue.shift();
    if (!item) return;
    showToast(item.text, true, item.type);
    return;
  }
  if (pendingNormal) {
    const item = pendingNormal;
    pendingNormal = null;
    showToast(item.text, false, item.type);
    return;
  }
  toastVisible = false;
}

/** @param {string} text @param {boolean} important @param {string} [type] */
function showToast(text, important, type = 'info') {
  els.toast.textContent = text;
  els.toast.classList.toggle('toast-success', type === 'success');
  els.toast.classList.toggle('toast-error', type === 'error');
  els.toast.classList.add('show');
  toastVisible = true;
  toastImportant = important;
  clearTimeout(App.toastTimer ?? undefined);
  App.toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    // 等淡出动画结束后再显示下一条，保证队列衔接也有完整淡入淡出
    App.toastTimer = setTimeout(showNextToast, TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
}

// 异步操作防重复：pending 期间禁用触发器并标记 aria-busy，结束后恢复
/** @param {HTMLElement | null} trigger @param {() => any} task @returns {Promise<any>} */
export async function withPending(trigger, task) {
  if (!trigger) return task();
  if (trigger.disabled) return;
  trigger.disabled = true;
  trigger.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    trigger.disabled = false;
    trigger.removeAttribute('aria-busy');
  }
}

export function getToastQueue() {
  return [...toastQueue.map((item) => item.text), ...(pendingNormal ? [pendingNormal.text] : [])];
}

let paletteHintShownAt = 0;

// 色板配置修改后不即时生效：弹出一条提示，3 秒内不重复打扰
export function hintPaletteDeferred() {
  const now = Date.now();
  if (now - paletteHintShownAt < HINT_THROTTLE_MS) return;
  paletteHintShownAt = now;
  toast('色板配置修改后需单击「重新压缩」才会应用到画布');
}

let distanceHintShownAt = 0;

// 颜色距离修改后不即时生效：弹出一条提示，3 秒内不重复打扰
export function hintDistanceDeferred() {
  const now = Date.now();
  if (now - distanceHintShownAt < HINT_THROTTLE_MS) return;
  distanceHintShownAt = now;
  toast('颜色距离修改后需单击「重新压缩」才会重新生成图案');
}

// 触发浏览器下载（data URL 或普通 URL）
/** @param {string} url @param {string} filename */
export function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 二进制导出下载：Blob → object URL → 触发下载，随后释放 URL
/** @param {Blob} blob @param {string} filename */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 颜色条目的通用文案：色号 / 完整标题
/** @param {FusePaletteColor | null | undefined} c @returns {string} */
export function codeOf(c) {
  return (c && (c.code || String(c.index))) || '';
}

// 文件名去扩展名并去首尾空白（用于项目显示名）
/** @param {string | null | undefined} name @returns {string} */
export function fileNameStem(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .trim();
}

/** @param {FusePaletteColor | null | undefined} c @returns {string} */
export function titleOf(c) {
  if (!c) return '';
  return `${c.name || ''} ${c.code || ''} ${c.hex}`.trim();
}

// 数量徽标（如 ×12）：与导出图例的「色号 × 数量」格式区分，徽标省略前导空格
/** @param {number} count @returns {string} */
export function countBadge(count) {
  return count ? `×${count}` : '';
}

// 解析输入数值并夹取到 [min, max]；非法/为空时返回 fallback
/** @param {string | number} raw @param {number} min @param {number} max @param {number} fallback @returns {number} */
export function clampInt(raw, min, max, fallback = min) {
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 「目标像素量」统一取值入口：输入框 → 合法区间
export function getTargetPixels() {
  return Math.min(
    TARGET_PIXELS_MAX,
    Math.max(TARGET_PIXELS_MIN, parseInt(els.targetPixels.value, 10) || DEFAULT_TARGET_PIXELS),
  );
}

// 计算把尺寸适配进视口的缩放与居中位移
/** @param {number} sizeW @param {number} sizeH @param {number} vw @param {number} vh @param {number} cap @returns {{ zoom: number, pan: { x: number, y: number } }} */
export function fitToViewport(sizeW, sizeH, vw, vh, cap) {
  const zoom = Math.max(
    ZOOM_MIN,
    Math.min((vw - VIEWPORT_PADDING) / sizeW, (vh - VIEWPORT_PADDING) / sizeH, cap),
  );
  return {
    zoom,
    pan: { x: (vw - sizeW * zoom) / 2, y: (vh - sizeH * zoom) / 2 },
  };
}

// 围绕画布上某点缩放：保持该点的内容位置不变，返回新的 zoom 与 pan
/** @param {number} rectLeft @param {number} rectTop @param {number} panX @param {number} panY @param {number} oldZoom @param {number} clientX @param {number} clientY @param {number} newZoom @returns {{ zoom: number, pan: { x: number, y: number } }} */
export function zoomAroundPoint(rectLeft, rectTop, panX, panY, oldZoom, clientX, clientY, newZoom) {
  const stageLeft = rectLeft - panX;
  const stageTop = rectTop - panY;
  const ix = (clientX - rectLeft) / oldZoom;
  const iy = (clientY - rectTop) / oldZoom;
  return {
    zoom: newZoom,
    pan: { x: clientX - stageLeft - ix * newZoom, y: clientY - stageTop - iy * newZoom },
  };
}

export function blurActive() {
  const el = /** @type {HTMLElement | null} */ (document.activeElement);
  if (el && typeof el.blur === 'function') {
    el.blur();
  }
}

// 矩形内的格索引集合（范围已裁剪到图案边界）
/** @param {{ x0: number, y0: number, x1: number, y1: number }} rect @returns {Set<number>} */
export function rectCells(rect) {
  const { width } = /** @type {FuseProject} */ (App.project);
  const cells = new Set();
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) cells.add(y * width + x);
  }
  return cells;
}

// 隐藏裁剪放大镜（工具切换等场景复用）
export function hideCropMagnifier() {
  if (!els.cropMagnifier.classList.contains('hidden')) els.cropMagnifier.classList.add('hidden');
}
