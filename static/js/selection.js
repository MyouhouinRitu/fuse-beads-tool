// 选区体系：单击 / 矩形 / 同色 / 魔棒 / 填充 / Delete 清空。

import * as C from './colors.js';
import {
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
} from './constants.js';
import { renderHistoryUI } from './history-ui.js';
import { interactionState } from './interaction.js';
import { applyGridChanges, recordGridChanges } from './mutations.js';
import { findConnectedComponents } from './render.js';
import { scheduleCanvasRender } from './render-queue.js';
import { App } from './state.js';
import { clampInt, rectCells, toast } from './utils.js';

// ---------- 区域选择 ----------

export function clearSelection() {
  if (!App.selection.size && !interactionState.dragPreview) return;
  App.selection = new Set();
  interactionState.dragPreview = null;
  scheduleCanvasRender();
}

// 同色连通块：返回包含 (x,y) 的四方向同色像素组（复用 render.js 的连通分组）；空位视为只有自身一格
function connectedColorCells(x, y) {
  const { grid, width, height } = App.project;
  const p0 = y * width + x;
  const v = grid[p0];
  if (v < 0) return new Set([p0]);
  const components = findConnectedComponents(width, height, (p) => grid[p] === v);
  for (const comp of components) {
    if (comp.includes(p0)) return new Set(comp);
  }
  return new Set([p0]);
}

// 魔棒：以 (x,y) 的颜色为种子，按容差阈值选取四方向连通的相似色；
// 空位与同色选区一致，只选自身一格。
const WAND_DIST2_AT_MAX = 10000; // 容差 100 对应的 Lab 距离平方上限

function wandDistanceThreshold() {
  const s = clampInt(
    App.settings.wandSensitivity,
    WAND_SENSITIVITY_MIN,
    WAND_SENSITIVITY_MAX,
    WAND_SENSITIVITY_DEFAULT,
  );
  const ratio = (s / WAND_SENSITIVITY_MAX) ** 2;
  return WAND_DIST2_AT_MAX * ratio;
}

function similarColorCells(x, y) {
  const { grid, width } = App.project;
  const p0 = y * width + x;
  const seed = grid[p0];
  if (seed < 0) return new Set([p0]);
  const seedColor = App.appliedPalette[seed];
  if (!seedColor) return new Set([p0]);

  const seedRgb = C.hexToRgb(seedColor.hex);
  const dist = App.appliedPalette.map((c) =>
    c ? C.colorDist2(seedRgb, C.hexToRgb(c.hex), App.settings.useLab) : Infinity,
  );
  const threshold = wandDistanceThreshold();
  const visited = new Uint8Array(grid.length);
  const cells = new Set([p0]);
  const stack = [p0];
  visited[p0] = 1;

  while (stack.length) {
    const p = stack.pop();
    const px = p % width;
    const neighbors = [];
    if (px > 0) neighbors.push(p - 1);
    if (px < width - 1) neighbors.push(p + 1);
    if (p >= width) neighbors.push(p - width);
    if (p < grid.length - width) neighbors.push(p + width);
    for (const q of neighbors) {
      if (visited[q]) continue;
      visited[q] = 1;
      const v = grid[q];
      if (v >= 0 && dist[v] <= threshold) {
        cells.add(q);
        stack.push(q);
      }
    }
  }
  return cells;
}

function addToSelection(cells) {
  const next = new Set(App.selection);
  for (const p of cells) next.add(p);
  App.selection = next;
}

function replaceSelection(cells) {
  App.selection = new Set(cells);
}

// 单击选择：同色选区勾选时选连通块，否则选单格；Shift 追加并集，非 Shift 替换；Ctrl 反选当前格
export function selectClick(cell, shift, ctrl = false) {
  const p = cell.y * App.project.width + cell.x;
  if (ctrl) {
    const next = new Set(App.selection);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    App.selection = next;
    scheduleCanvasRender();
    return;
  }
  let cells;
  if (App.settings.sameColorSelect) {
    cells = connectedColorCells(cell.x, cell.y);
  } else {
    cells = new Set([p]);
  }
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  scheduleCanvasRender();
}

export function toggleSelectionCells(cells) {
  const next = new Set(App.selection);
  for (const p of cells) {
    if (next.has(p)) next.delete(p);
    else next.add(p);
  }
  App.selection = next;
}

// 魔棒单击：按当前容差选择四向连通的相似色；Shift 追加并集，非 Shift 替换
export function selectWand(cell, shift) {
  const cells = similarColorCells(cell.x, cell.y);
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  interactionState.dragPreview = null;
  scheduleCanvasRender();
}

export function selectRect(rect, shift) {
  const cells = rectCells(rect);
  if (shift) addToSelection(cells);
  else replaceSelection(cells);
  scheduleCanvasRender();
}

// 用当前画笔颜色填充整个选区，整块记一步撤销（不改变选择与模式）
export function fillSelectionWithBrush() {
  if (!App.project || !App.selection.size || App.brushColor == null) return;
  const { width } = App.project;
  const changes = [];
  for (const p of App.selection) {
    changes.push({ x: p % width, y: (p / width) | 0, to: App.brushColor });
  }
  const applied = applyGridChanges(changes, { silent: true });
  if (applied.length) {
    recordGridChanges(applied);
    renderHistoryUI();
  }
}

// Delete 键：把选中格清为空位，整块记一步撤销（不改变选择与模式）
export function clearSelectionToEmpty() {
  if (!App.project || !App.selection.size) return;
  const { grid, width } = App.project;
  const changes = [];
  for (const p of App.selection) {
    if (grid[p] < 0) continue; // 已是空位
    changes.push({ x: p % width, y: (p / width) | 0, to: -1 });
  }
  const applied = applyGridChanges(changes, { silent: true });
  if (!applied.length) return;
  recordGridChanges(applied);
  renderHistoryUI();
  toast(`已将 ${applied.length} 个格子清除为空位`);
}
