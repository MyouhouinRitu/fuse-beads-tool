// 颜色清单与画笔色：右侧「全部颜色」列表、未选色默认色、取色工具与选区填充入口。

import * as C from './colors.js';
import { TOOLS } from './constants.js';
import { els } from './els.js';
import { fillSelectionWithBrush } from './selection.js';
import { App } from './state.js';
import { setTool } from './tool-state.js';
import { codeOf, countBadge, titleOf, toast } from './utils.js';

// ---------- 画笔 ----------

// 未导入项目时没有“已应用色板”，此时用当前配置色板作为画笔色板，允许提前选色
function brushPalette() {
  return App.project && App.appliedPalette.length ? App.appliedPalette : App.palette;
}

export function updateBrush() {
  const palette = brushPalette();
  if (App.brushColor != null && App.brushColor >= palette.length) {
    App.brushColor = Math.max(0, palette.length - 1);
  }
  if (App.brushColor == null || !palette.length) {
    els.brushSwatch.style.background = '#ffffff';
    els.brushSwatch.style.border = '2px dashed #b9bec7';
    els.brushLabel.textContent = '未选择颜色';
    return;
  }
  const c = palette[App.brushColor];
  if (!c) {
    els.brushSwatch.style.background = '#cccccc';
    els.brushSwatch.style.border = '';
    els.brushLabel.textContent = '未选择颜色';
    return;
  }
  els.brushSwatch.style.background = c.hex;
  els.brushSwatch.style.border = '';
  els.brushLabel.textContent = titleOf(c);
}

// 调色板中最暗的颜色索引（按感知亮度），画笔未选色时用作默认颜色
/** @param {Array<any>} palette @returns {number | null} */
function darkestPaletteIndex(palette) {
  if (!palette.length) return null;
  let best = 0;
  let bestLum = Infinity;
  palette.forEach((c, i) => {
    if (!c?.hex) return;
    const [r, g, b] = C.hexToRgb(c.hex);
    const lum = C.luminance([r, g, b]);
    if (lum < bestLum) {
      bestLum = lum;
      best = i;
    }
  });
  return best;
}

// 画笔未选色时取调色板最暗色；调色板为空时提示并返回 false
export function ensureBrushColor() {
  if (App.brushColor != null) return true;
  const dark = darkestPaletteIndex(brushPalette());
  if (dark == null) {
    toast('调色板为空，请先导入颜色配置');
    return false;
  }
  App.brushColor = dark;
  updateBrush();
  renderColorList();
  return true;
}

// 快捷键/按钮共用：切换到指定工具（画笔未选色时先取最暗色）
/** @param {string} tool */
export function switchToolShortcut(tool) {
  if (tool === TOOLS.BRUSH && !ensureBrushColor()) return;
  setTool(tool);
}

// 右侧「全部颜色」列表（可点击选择画笔颜色；选择模式有选区时点击为整块填充）
// 事件委托：容器上只绑定一个 click，避免整表重建时反复创建监听器
export function bindColorList() {
  els.colorList.addEventListener('click', (e) => {
    const item = /** @type {HTMLElement | null} */ (e.target?.closest?.('.color-item'));
    if (!item) return;
    const i = Number(item.dataset.index);
    if (!Number.isInteger(i)) return;
    App.brushColor = i;
    updateBrush();
    if ((App.tool === TOOLS.SELECT || App.tool === TOOLS.WAND) && App.selection.size > 0) {
      // 选择 / 魔棒模式且有选区：将选区填充为该颜色，保持当前模式，整块记一步撤销
      fillSelectionWithBrush();
    } else {
      // 无选区：切换为画笔模式
      setTool(TOOLS.BRUSH);
    }
    renderColorList();
  });
}

/** @param {Array<number> | null | undefined} [counts] */
export function renderColorList(counts) {
  if (!counts && App.project) {
    counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  }
  const palette = brushPalette();
  const list = els.colorList;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  palette.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = `color-item${App.brushColor === i ? ' selected' : ''}`;
    item.dataset.index = String(i);
    item.title = titleOf(c);
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    const codeLabel = document.createElement('span');
    codeLabel.className = 'ci-code';
    codeLabel.textContent = codeOf(c);
    const rgb = C.hexToRgb(c.hex);
    const textColor = C.isLightColor(rgb) ? '#111111' : '#FFFFFF';
    codeLabel.style.color = textColor;
    sw.appendChild(codeLabel);
    const count = document.createElement('span');
    count.className = 'ci-count';
    count.textContent = counts?.[i] ? countBadge(counts[i]) : '';
    count.style.color = textColor;
    sw.appendChild(count);
    item.appendChild(sw);
    frag.appendChild(item);
  });
  list.appendChild(frag);
  updateBrush();
}

// 取色工具：把目标格的颜色设为画笔色；有选区时立即填充选区，否则切回画笔模式
/** @param {{ x: number, y: number }} cell */
export function applyPickerColor(cell) {
  const project = /** @type {FuseProject} */ (App.project);
  const v = project.grid[cell.y * project.width + cell.x];
  if (v < 0) {
    toast('该位置是空位，无法取色');
    return;
  }
  App.brushColor = v;
  updateBrush();
  renderColorList();
  if (App.selection.size > 0) {
    // 有选区：取色后立即把选区填充为该颜色，再回选择模式（选区保留）
    fillSelectionWithBrush();
    setTool(TOOLS.SELECT);
  } else {
    // 无选区：取色后切换为画笔模式
    setTool(TOOLS.BRUSH);
  }
}
