// 画笔 / 橡皮涂色：单格与矩形笔刷、连续画线。

import * as canvas from './canvas.js';
import { TOOLS } from './constants.js';
import { interactionState } from './interaction.js';
import { applyGridChanges } from './mutations.js';
import { scheduleRender } from './render-queue.js';
import { App } from './state.js';

export function paintCell(x, y, { silent = false } = {}) {
  const { grid, width } = App.project;
  const p = y * width + x;
  const v = App.tool === TOOLS.ERASER ? -1 : App.brushColor != null ? App.brushColor : -2;
  if (v === -2) return; // 未选择颜色
  if (grid[p] === v) return null;
  const applied = applyGridChanges([{ x, y, from: grid[p], to: v }], {
    silent,
    buffer: interactionState.strokeBuffer,
  });
  if (!silent) scheduleRender();
  return applied[0] || null;
}

// 按画笔/橡皮尺寸涂一个矩形（边长 = 2×brushSize−1，以目标格为中心，裁剪到图案边界）
export function paintStamp(cell) {
  if (!cell) return;
  const r = App.settings.brushSize - 1;
  const { grid, width, height } = App.project;
  const x0 = Math.max(0, cell.x - r);
  const y0 = Math.max(0, cell.y - r);
  const x1 = Math.min(width - 1, cell.x + r);
  const y1 = Math.min(height - 1, cell.y + r);
  const v = App.tool === TOOLS.ERASER ? -1 : App.brushColor != null ? App.brushColor : -2;
  if (v === -2) return; // 未选择颜色
  const changes = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x;
      if (grid[p] === v) continue;
      changes.push({ x, y, from: grid[p], to: v });
    }
  }
  const applied = applyGridChanges(changes, {
    silent: true,
    buffer: interactionState.strokeBuffer,
  });
  if (!applied.length) return applied;
  if (interactionState.painting) {
    // 笔划进行中：只增量重绘脏格，不触发全量刷新 / 自动保存；
    // 笔划结束（recordGridChanges）统一全量刷新、记撤销步并落盘。
    canvas.repaintBaseCells(applied);
  } else {
    scheduleRender();
  }
  return applied;
}

export function lineCells(a, b) {
  const cells = [];
  let x0 = a.x,
    y0 = a.y,
    x1 = b.x,
    y1 = b.y;
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return cells;
}

export function strokeLine(a, b) {
  for (const c of lineCells(a, b)) paintStamp(c);
}

export function axisConstrainedEnd(start, current) {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  if (dx >= dy) return { x: current.x, y: start.y };
  return { x: start.x, y: current.y };
}
