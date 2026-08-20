// 事务历史：独立（扁平）结构，不做树状分支。
// 每次 Ctrl+S 保存一个完整快照（所有点位的颜色），节点之间没有父子关系。
// 另提供单步撤销/重做记录：以增量方式记录（像素 x/y，从哪个色号改到哪个色号）。

import { decodeInt16Grid } from './grid-codec.js';

export const MAX_UNDO_STEPS = 20;
export const MAX_SNAPSHOTS = 100; // 快照数量上限：防止 state.json 无限膨胀
export const SNAPSHOT_BUDGET_BYTES = 4 * 1024 * 1024; // 历史区序列化体积预算（网格 base64 后约 4MB）
const SNAPSHOT_BYTES_PER_CELL = (2 * 4) / 3; // 每格 Int16 2 字节 + base64 膨胀 4/3

// 按网格规模收缩快照上限：大网格少存快照，使历史区体积始终落在预算内
/** @param {number} cells @returns {number} */
function snapshotLimit(cells) {
  const byBudget = Math.floor(
    SNAPSHOT_BUDGET_BYTES / (Math.max(1, cells) * SNAPSHOT_BYTES_PER_CELL),
  );
  return Math.max(1, Math.min(MAX_SNAPSHOTS, byBudget));
}

/** @param {number} width @param {number} height @returns {number} */
export function maxSnapshotsFor(width, height) {
  return snapshotLimit(Math.floor(Number(width) * Number(height)));
}

/** @returns {FuseHistory} */
export function createEmptyHistory() {
  return { items: [], currentId: null, nextId: 1, baselineId: null };
}

// 历史数据清洗：仅保留含完整快照的合法节点；
// 无法解析的旧 / 损坏数据直接返回空历史。
/** @param {any} h @returns {FuseHistory} */
export function sanitizeHistory(h) {
  if (!h || typeof h !== 'object' || !Array.isArray(h.items)) return createEmptyHistory();
  const items = [];
  const ids = new Set();
  for (const it of h.items) {
    if (!it || typeof it !== 'object' || !it.snapshot || typeof it.snapshot !== 'object') continue;
    if (!Array.isArray(it.snapshot.grid) && typeof it.snapshot.gridBase64 !== 'string') continue;
    const id = Number(it.id);
    if (!Number.isInteger(id) || ids.has(id)) continue;
    ids.add(id);
    const snapshot = sanitizeSnapshot(it.snapshot);
    if (!snapshot) continue;
    items.push({
      id,
      createdAt: Number(it.createdAt) || Date.now(),
      label: it.label ? String(it.label) : `快照 #${id}`,
      snapshot,
    });
  }
  // 只保留最近上限个快照（上限按最大网格规模自适应，丢弃最旧）
  let maxCells = 0;
  for (const it of items) {
    maxCells = Math.max(maxCells, it.snapshot.width * it.snapshot.height);
  }
  const limit = snapshotLimit(maxCells);
  const dropped = Math.max(0, items.length - limit);
  if (dropped) items.splice(0, dropped);
  const keptIds = new Set(items.map((it) => it.id));
  let currentId = h.currentId;
  if (currentId != null && !keptIds.has(Number(currentId))) currentId = null;
  const baselineId =
    h.baselineId != null && keptIds.has(Number(h.baselineId)) ? Number(h.baselineId) : null;
  return {
    items,
    currentId,
    baselineId,
    nextId: items.reduce((m, it) => Math.max(m, it.id + 1), 1),
  };
}

/** @param {any} s @returns {FuseSnapshot | null} */
function sanitizeSnapshot(s) {
  if (!s || typeof s !== 'object') return null;
  const width = Number(s.width);
  const height = Number(s.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return null;
  let rawGrid;
  if (Array.isArray(s.grid)) {
    rawGrid = s.grid;
  } else if (typeof s.gridBase64 === 'string') {
    const decoded = decodeInt16Grid(s.gridBase64);
    if (!decoded || decoded.length !== width * height) return null;
    rawGrid = Array.from(decoded);
  } else {
    return null;
  }
  if (rawGrid.length !== width * height) return null;
  /** @param {any[]} arr */
  const norm = (arr) =>
    arr.map((v) => {
      const n = Number(v);
      return Number.isInteger(n) ? n : -1;
    });
  const grid = norm(rawGrid);
  const baseGrid =
    Array.isArray(s.baseGrid) && s.baseGrid.length === width * height
      ? norm(s.baseGrid)
      : grid.slice();
  // 快照记录当时的对比原图镜像状态，切换快照时同步还原原图显示方向
  const mirror = {
    horizontal: !!s.mirror?.horizontal,
    vertical: !!s.mirror?.vertical,
  };
  return { width, height, grid, baseGrid, mirror };
}

// 恢复单步撤销/重做栈：丢弃结构损坏、坐标/快照不完整的步骤，并限制在 MAX_UNDO_STEPS 内
/** @param {unknown} raw @returns {FuseStep[]} */
export function sanitizeUndoStack(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {FuseStep[]} */
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.structural) {
      const before = sanitizeSnapshot(item.before);
      const after = sanitizeSnapshot(item.after);
      if (!before || !after) continue;
      const type = String(item.type || 'crop');
      /** @type {{ structural: true, type: string, before: FuseSnapshot, after: FuseSnapshot, mirrorBefore?: { horizontal: boolean, vertical: boolean }, mirrorAfter?: { horizontal: boolean, vertical: boolean } }} */
      const step = { structural: true, type, before, after };
      if (type === 'mirror') {
        // 镜像步骤额外携带对比原图显示状态，撤销/重做时同步还原
        step.mirrorBefore = {
          horizontal: !!item.mirrorBefore?.horizontal,
          vertical: !!item.mirrorBefore?.vertical,
        };
        step.mirrorAfter = {
          horizontal: !!item.mirrorAfter?.horizontal,
          vertical: !!item.mirrorAfter?.vertical,
        };
      }
      out.push(step);
    } else {
      const changes = [];
      if (Array.isArray(item.changes)) {
        for (const c of item.changes) {
          if (!c || typeof c !== 'object') continue;
          const x = Number(c.x);
          const y = Number(c.y);
          const from = Number(c.from);
          const to = Number(c.to);
          if (
            Number.isInteger(x) &&
            Number.isInteger(y) &&
            Number.isInteger(from) &&
            Number.isInteger(to)
          ) {
            changes.push({ x, y, from, to });
          }
        }
      }
      if (changes.length) out.push({ changes });
    }
    if (out.length >= MAX_UNDO_STEPS) break;
  }
  return out;
}

/** @param {FuseHistory} history @param {number} id @returns {FuseHistoryItem | null} */
export function findTransaction(history, id) {
  return history.items.find((it) => it.id === id) || null;
}

/** @param {FuseHistory} history @param {FuseSnapshot} snapshot @returns {FuseHistoryItem} */
export function createTransaction(history, snapshot) {
  const id = history.nextId++;
  const item = { id, createdAt: Date.now(), label: `快照 #${id}`, snapshot };
  history.items.push(item);
  const limit = snapshotLimit(snapshot.width * snapshot.height);
  while (history.items.length > limit) history.items.shift();
  history.currentId = id;
  history.baselineId = id;
  return item;
}

// 只删除该事务节点本身（无子树）。
// 若删除的是当前节点，切到相邻节点（优先后一个，其次前一个）；没有剩余节点时 currentId 置空。
/** @param {FuseHistory} history @param {number} id @returns {{ ok: boolean, newCurrent: number | null }} */
export function deleteTransaction(history, id) {
  const idx = history.items.findIndex((it) => it.id === id);
  if (idx < 0) return { ok: false, newCurrent: history.currentId };
  history.items.splice(idx, 1);
  let newCurrent = history.currentId;
  if (history.currentId === id) {
    const next = history.items[idx] || history.items[idx - 1] || null;
    newCurrent = next ? next.id : null;
    history.currentId = newCurrent;
  }
  return { ok: true, newCurrent };
}

// ---------------- 单步撤销/重做 ----------------

/** @param {FuseStep[]} stack */
function cap(stack) {
  while (stack.length > MAX_UNDO_STEPS) stack.shift();
}

// 记录一步（一次 D 键选色，或一次画笔/橡皮按下到放开的整段修改）。
// 入栈后清空重做栈；超出 20 步时丢弃最旧的一步。
/** @param {FuseStep[]} undoStack @param {FuseStep[]} redoStack @param {FuseStepChange[]} changes @returns {FuseStep | null} */
export function recordStep(undoStack, redoStack, changes) {
  if (!changes?.length) return null;
  const step = { changes };
  undoStack.push(step);
  cap(undoStack);
  redoStack.length = 0;
  return step;
}

/** @param {FuseStep[]} undoStack @param {FuseStep[]} redoStack @returns {FuseStep | null} */
export function undoStep(undoStack, redoStack) {
  const step = undoStack.pop();
  if (!step) return null;
  redoStack.push(step);
  cap(redoStack);
  return step;
}

/** @param {FuseStep[]} undoStack @param {FuseStep[]} redoStack @returns {FuseStep | null} */
export function redoStep(undoStack, redoStack) {
  const step = redoStack.pop();
  if (!step) return null;
  undoStack.push(step);
  cap(undoStack);
  return step;
}

// mode: 'undo' 还原为修改前色号；'redo' 重新应用修改后色号
/** @param {Int16Array} grid @param {number} width @param {FuseStepChange[]} changes @param {'undo' | 'redo'} mode */
export function applyStepToGrid(grid, width, changes, mode) {
  for (const ch of changes) {
    if (!ch || !Number.isInteger(ch.x) || !Number.isInteger(ch.y)) continue;
    grid[ch.y * width + ch.x] = mode === 'undo' ? ch.from : ch.to;
  }
}

// ---------------- 结构型步骤（裁剪等改变画布尺寸的操作） ----------------

// 结构型步骤的快照：包含尺寸、网格与滑块基副本（基副本随裁剪同步变化，撤销时需一并还原）
/** @param {{ width: number, height: number, grid: Int16Array, baseGrid?: Int16Array }} projectLike @returns {FuseSnapshot} */
function snapshotOf(projectLike) {
  return {
    width: projectLike.width,
    height: projectLike.height,
    grid: Array.from(projectLike.grid),
    baseGrid: projectLike.baseGrid
      ? Array.from(projectLike.baseGrid)
      : Array.from(projectLike.grid),
  };
}

// 记录一步结构型操作（如裁剪）：尺寸变化后旧的坐标增量步骤全部失效，
// 因此清空撤销/重做栈后仅保留本步骤；之后新的增量步骤再叠加在本步骤之上。
/** @param {FuseStep[]} undoStack @param {FuseStep[]} redoStack @param {{ width: number, height: number, grid: Int16Array, baseGrid?: Int16Array }} before @param {{ width: number, height: number, grid: Int16Array, baseGrid?: Int16Array }} after @param {string} [type] @returns {FuseStep} */
export function recordStructuralStep(undoStack, redoStack, before, after, type = 'crop') {
  /** @type {FuseStep} */
  const step = { structural: true, type, before: snapshotOf(before), after: snapshotOf(after) };
  undoStack.length = 0;
  redoStack.length = 0;
  undoStack.push(step);
  return step;
}

// 记录一步镜像操作：尺寸不变，旧坐标增量步骤仍然有效，因此不清空撤销栈；
// 附带对比原图显示的镜像状态（撤销/重做时同步还原原图显示方向）。
/** @param {FuseStep[]} undoStack @param {FuseStep[]} redoStack @param {{ width: number, height: number, grid: Int16Array, baseGrid?: Int16Array }} before @param {{ width: number, height: number, grid: Int16Array, baseGrid?: Int16Array }} after @param {{ horizontal: boolean, vertical: boolean }} mirrorBefore @param {{ horizontal: boolean, vertical: boolean }} mirrorAfter @returns {FuseStep} */
export function recordMirrorStep(undoStack, redoStack, before, after, mirrorBefore, mirrorAfter) {
  /** @type {FuseStep} */
  const step = {
    structural: true,
    type: 'mirror',
    before: snapshotOf(before),
    after: snapshotOf(after),
    mirrorBefore: { horizontal: !!mirrorBefore?.horizontal, vertical: !!mirrorBefore?.vertical },
    mirrorAfter: { horizontal: !!mirrorAfter?.horizontal, vertical: !!mirrorAfter?.vertical },
  };
  undoStack.push(step);
  cap(undoStack);
  redoStack.length = 0;
  return step;
}

// 把结构型步骤应用到目标对象（{ width, height, grid, baseGrid }）；mode: 'undo' | 'redo'
/** @param {{ width: number, height: number, grid: Int16Array | null, baseGrid: Int16Array | null }} target @param {FuseStep} step @param {'undo' | 'redo'} mode */
export function applyStructuralStep(target, step, mode) {
  // 本函数只处理结构型步骤（裁剪 / 镜像）；非结构型步骤直接忽略
  if (!('structural' in step)) return;
  const snap = mode === 'undo' ? step.before : step.after;
  target.width = snap.width;
  target.height = snap.height;
  target.grid = Int16Array.from(snap.grid);
  target.baseGrid = Int16Array.from(snap.baseGrid || snap.grid);
}
