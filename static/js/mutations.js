// 网格变更统一入口：所有「修改格子内容」的提交路径都经由本模块写入，
// 统一处理 dirty / editedSinceSlider / 撤销记录 / 自动保存，避免漏标或重复标。
// 结构性替换（导入、滑块重算、裁剪、切换事务等整体换 project）不属于本模块职责。

import { scheduleAutosave } from './autosave.js';
import { recordStep } from './history.js';
import { scheduleRender } from './render-queue.js';
import { App, setDirty } from './state.js';

// 网格内容修订号：画布显示数据缓存据此失效（格子原地修改时引用不变）
export let gridRevision = 0;

/**
 * 写入一批格子变更并统一标记编辑状态。
 * @param {Array<{x: number, y: number, to: number, from?: number}>} changes
 * @param {{silent?: boolean, buffer?: Array|null}} [options]
 *   silent：暂不调度自动保存（批量提交由调用方统一处理）；
 *   buffer：非空时把已应用变更同时追加到该数组（画笔整段累积用）。
 * @returns {Array<{x: number, y: number, from: number, to: number}>} 实际应用的变更
 */
export function applyGridChanges(changes, { silent = false, buffer = null } = {}) {
  if (!App.project || !changes?.length) return [];
  const { grid, width } = App.project;
  const applied = [];
  for (const ch of changes) {
    if (!Number.isInteger(ch.x) || !Number.isInteger(ch.y) || !Number.isInteger(ch.to)) continue;
    const p = ch.y * width + ch.x;
    const from = ch.from ?? grid[p];
    if (from === ch.to) continue;
    // 未显式给 from 且目标已是指定值：视为无实际变化；
    // 显式给 from（如九宫格以打开时原色记录）即使当前已是目标值也保留提交。
    if (ch.from === undefined && grid[p] === ch.to) continue;
    grid[p] = ch.to;
    const change = { x: ch.x, y: ch.y, from, to: ch.to };
    if (buffer) buffer.push(change);
    applied.push(change);
  }
  if (applied.length) {
    gridRevision++;
    setDirty(true);
    App.editedSinceSlider = true;
    if (!silent) scheduleAutosave();
  }
  return applied;
}

// 把一批已应用的变更提交为一步撤销记录，并刷新画布与自动保存
export function recordGridChanges(changes) {
  if (!changes?.length) return null;
  const step = recordStep(App.undoStack, App.redoStack, changes);
  scheduleRender();
  scheduleAutosave();
  return step;
}

// 临时预览写入（九宫格悬停等）：不标记 dirty / 撤销，调用方必须负责还原
export function setGridPreview(p, value) {
  App.project.grid[p] = value;
}
