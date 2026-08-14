// D 键九宫格快速选色：候选色构建、弹窗渲染与定位、悬停预览与确认改色。

import { scheduleAutosave } from './autosave.js';
import * as C from './colors.js';
import {
  QUICK_PICKER_CELL,
  QUICK_PICKER_COLS,
  QUICK_PICKER_EDGE_MARGIN,
  QUICK_PICKER_HEIGHT,
  QUICK_PICKER_MAX,
  QUICK_PICKER_OFFSET_CELLS,
  QUICK_PICKER_PAD,
  TOOLS,
} from './constants.js';
import { els } from './els.js';
import { recordStep } from './history.js';
import { scheduleCanvasRender, scheduleRender } from './render-queue.js';
import { App, setDirty } from './state.js';
import { setTool } from './tool-state.js';
import { codeOf, countBadge, titleOf } from './utils.js';
import { cellCenterToScreen } from './view.js';

// 九宫格候选色的邻近 8 格偏移（不含自身）
const QUICK_PICKER_NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// 构建九宫格候选色：周围 8 格的颜色优先，不足 9 个时用最相近颜色补齐
export function buildQuickCandidates(cell) {
  const { grid, width, height } = App.project;
  const p = cell.y * width + cell.x;
  App.pickerCell = { x: cell.x, y: cell.y, p, original: grid[p] };
  App.pickerPreviewIndex = null;
  const own = grid[p];
  const exclude = new Set(own >= 0 ? [own] : []);
  const candSet = new Set();
  for (const [dx, dy] of QUICK_PICKER_NEIGHBORS) {
    const nx = cell.x + dx;
    const ny = cell.y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const v = grid[ny * width + nx];
    if (v >= 0 && !exclude.has(v)) candSet.add(v);
  }
  const list = [...candSet];
  if (list.length < QUICK_PICKER_MAX) {
    const baseHex =
      own >= 0 && App.appliedPalette[own]
        ? App.appliedPalette[own].hex
        : App.brushColor != null && App.appliedPalette[App.brushColor]
          ? App.appliedPalette[App.brushColor].hex
          : '#FFFFFF';
    const baseRgb = C.hexToRgb(baseHex);
    const scored = App.appliedPalette
      .map((c, i) => ({ i, d: C.colorDist2(baseRgb, C.hexToRgb(c.hex), App.settings.useLab) }))
      .filter((s) => !list.includes(s.i) && !exclude.has(s.i))
      .sort((a, b) => a.d - b.d);
    for (const s of scored) {
      if (list.length >= QUICK_PICKER_MAX) break;
      list.push(s.i);
    }
  }
  const scored = list.slice(0, QUICK_PICKER_MAX).map((i) => ({ i }));
  App.pickerCandidates = scored;
  return scored;
}

// 九宫格事件委托：容器上只绑定 click / mouseover 两组监听
export function bindQuickPicker() {
  const box = els.quickPicker;
  box.addEventListener('click', (e) => {
    if (e.target.closest('.qp-cancel')) {
      closeQuickPicker();
      return;
    }
    const btn = e.target.closest('.qp-btn');
    if (btn) applyQuickColor(Number(btn.dataset.index));
  });
  box.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.qp-btn');
    if (btn) previewQuickColor(Number(btn.dataset.index));
  });
}

// 渲染九宫格弹窗内容（候选按钮 + 取消）
export function renderQuickPicker(scored) {
  const box = els.quickPicker;
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  const title = document.createElement('div');
  title.className = 'qp-title';
  title.textContent = '相近颜色（按 1-9 选择）';
  frag.appendChild(title);
  const usedCounts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  for (let k = 0; k < scored.length; k++) {
    const c = App.appliedPalette[scored[k].i];
    const btn = document.createElement('button');
    btn.className = 'qp-btn';
    btn.dataset.index = String(k);
    btn.style.background = c.hex;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(k + 1);
    btn.appendChild(num);
    const rgb = C.hexToRgb(c.hex);
    const code = document.createElement('span');
    code.className = 'qp-code';
    code.textContent = codeOf(c);
    code.style.color = C.isLightColor(rgb) ? '#111111' : '#FFFFFF';
    const cnt = document.createElement('span');
    cnt.className = 'qp-count';
    cnt.textContent = countBadge(usedCounts[scored[k].i]);
    cnt.style.color = code.style.color;
    btn.appendChild(code);
    btn.appendChild(cnt);
    btn.title = titleOf(c);
    frag.appendChild(btn);
  }
  const cancel = document.createElement('button');
  cancel.className = 'qp-cancel';
  cancel.textContent = '取消（esc）';
  frag.appendChild(cancel);
  box.appendChild(frag);
  box.classList.remove('hidden');
}

// 把九宫格弹窗定位到目标格下方（空间不足时移到上方，并限制在窗口内）
export function positionQuickPicker(cell) {
  const box = els.quickPicker;
  const { x: cx, y: cy, scale } = cellCenterToScreen(cell);
  const gap = App.screenCell * scale;
  const bw = QUICK_PICKER_CELL * QUICK_PICKER_COLS + QUICK_PICKER_PAD;
  const bh = QUICK_PICKER_HEIGHT;
  const left = Math.max(
    QUICK_PICKER_EDGE_MARGIN,
    Math.min(cx - bw / 2, window.innerWidth - bw - QUICK_PICKER_EDGE_MARGIN),
  );
  let top = cy + gap * QUICK_PICKER_OFFSET_CELLS; // 像素下方，再隔一个像素格
  if (top + bh > window.innerHeight - QUICK_PICKER_EDGE_MARGIN) {
    top = cy - gap * QUICK_PICKER_OFFSET_CELLS - bh;
  }
  top = Math.max(QUICK_PICKER_EDGE_MARGIN, top);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

export function openQuickPicker(cell) {
  if (!App.appliedPalette.length) return;
  const scored = buildQuickCandidates(cell);
  renderQuickPicker(scored);
  positionQuickPicker(cell);
}

export function applyQuickColor(k) {
  const cand = App.pickerCandidates?.[k];
  if (!cand) return;
  const { grid } = App.project;
  const pc = App.pickerCell; // 九宫格打开时由 openQuickPicker 设置目标格
  App.brushColor = cand.i;
  setTool(TOOLS.SELECT); // 改完颜色后回到选择模式（九宫格仅单选一格时可用）
  if (pc) {
    // 悬停预览可能已改动格子，这里统一以「打开时的原始颜色 → 目标颜色」记一步
    const changed = grid[pc.p] !== pc.original;
    grid[pc.p] = cand.i;
    if (changed) {
      App.strokeBuffer = [{ x: pc.x, y: pc.y, from: pc.original, to: cand.i }];
      recordStep(App.undoStack, App.redoStack, App.strokeBuffer);
      App.strokeBuffer = null;
      setDirty(true);
      App.editedSinceSlider = true;
      scheduleAutosave();
    }
  }
  App.pickerPreviewIndex = null;
  App.pickerCell = null;
  closeQuickPicker();
  // 全量刷新：更新画布、画笔色列表选中态与撤销按钮（renderAll 统一覆盖）
  scheduleRender();
}

// 悬停预览：把目标格临时显示为候选颜色（不进撤销栈，移出弹窗/取消时还原）
export function previewQuickColor(k) {
  const pc = App.pickerCell;
  const cand = App.pickerCandidates?.[k];
  if (!pc || !cand || !App.project) return;
  App.project.grid[pc.p] = cand.i;
  App.pickerPreviewIndex = k;
  scheduleCanvasRender();
}

// 还原悬停预览（移出弹窗或取消时调用）
export function restoreQuickPickerPreview() {
  if (!App.pickerCell || App.pickerPreviewIndex == null) return;
  if (App.project) App.project.grid[App.pickerCell.p] = App.pickerCell.original;
  App.pickerPreviewIndex = null;
  scheduleCanvasRender();
}

export function closeQuickPicker() {
  restoreQuickPickerPreview();
  App.pickerCell = null;
  els.quickPicker.classList.add('hidden');
  App.pickerCandidates = null;
}
