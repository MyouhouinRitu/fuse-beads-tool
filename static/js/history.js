// 事务历史：独立（扁平）结构，不做树状分支。
// 每次 Ctrl+S 保存一个完整快照（所有点位的颜色），节点之间没有父子关系。
// 另提供单步撤销/重做记录：以增量方式记录（像素 x/y，从哪个色号改到哪个色号）。

export const MAX_UNDO_STEPS = 20;

export function createEmptyHistory() {
  return { items: [], currentId: null, nextId: 1, baselineId: null };
}

// 历史数据清洗：仅保留含完整快照的合法节点；
// 无法解析的旧 / 损坏数据直接返回空历史。
export function sanitizeHistory(h) {
  if (!h || typeof h !== 'object' || !Array.isArray(h.items)) return createEmptyHistory();
  const items = [];
  const ids = new Set();
  for (const it of h.items) {
    if (!it || typeof it !== 'object' || !it.snapshot || typeof it.snapshot !== 'object') continue;
    if (!Array.isArray(it.snapshot.grid)) continue;
    const id = Number(it.id);
    if (!Number.isInteger(id) || ids.has(id)) continue;
    ids.add(id);
    items.push({
      id,
      createdAt: Number(it.createdAt) || Date.now(),
      label: it.label ? String(it.label) : `状态 #${id}`,
      snapshot: it.snapshot,
    });
  }
  let currentId = h.currentId;
  if (currentId != null && !ids.has(Number(currentId))) currentId = null;
  const baselineId =
    h.baselineId != null && ids.has(Number(h.baselineId)) ? Number(h.baselineId) : null;
  return {
    items,
    currentId,
    baselineId,
    nextId: items.reduce((m, it) => Math.max(m, it.id + 1), 1),
  };
}

function sanitizeSnapshot(s) {
  if (!s || typeof s !== 'object') return null;
  const width = Number(s.width);
  const height = Number(s.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return null;
  if (!Array.isArray(s.grid) || s.grid.length !== width * height) return null;
  const norm = (arr) =>
    arr.map((v) => {
      const n = Number(v);
      return Number.isInteger(n) ? n : -1;
    });
  const grid = norm(s.grid);
  const baseGrid =
    Array.isArray(s.baseGrid) && s.baseGrid.length === width * height
      ? norm(s.baseGrid)
      : grid.slice();
  return { width, height, grid, baseGrid };
}

// 恢复单步撤销/重做栈：丢弃结构损坏、坐标/快照不完整的步骤，并限制在 MAX_UNDO_STEPS 内
export function sanitizeUndoStack(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.structural) {
      const before = sanitizeSnapshot(item.before);
      const after = sanitizeSnapshot(item.after);
      if (!before || !after) continue;
      out.push({
        structural: true,
        type: String(item.type || 'crop'),
        before,
        after,
      });
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

export function findTransaction(history, id) {
  return history.items.find((it) => it.id === id) || null;
}

export function createTransaction(history, snapshot) {
  const id = history.nextId++;
  const item = { id, createdAt: Date.now(), label: `状态 #${id}`, snapshot };
  history.items.push(item);
  history.currentId = id;
  history.baselineId = id;
  return item;
}

// 只删除该事务节点本身（无子树）。
// 若删除的是当前节点，切到相邻节点（优先后一个，其次前一个）；没有剩余节点时 currentId 置空。
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

function cap(stack) {
  while (stack.length > MAX_UNDO_STEPS) stack.shift();
}

// 记录一步（一次 D 键选色，或一次画笔/橡皮按下到放开的整段修改）。
// 入栈后清空重做栈；超出 20 步时丢弃最旧的一步。
export function recordStep(undoStack, redoStack, changes) {
  if (!changes?.length) return null;
  const step = { changes };
  undoStack.push(step);
  cap(undoStack);
  redoStack.length = 0;
  return step;
}

export function undoStep(undoStack, redoStack) {
  const step = undoStack.pop();
  if (!step) return null;
  redoStack.push(step);
  cap(redoStack);
  return step;
}

export function redoStep(undoStack, redoStack) {
  const step = redoStack.pop();
  if (!step) return null;
  undoStack.push(step);
  cap(undoStack);
  return step;
}

// mode: 'undo' 还原为修改前色号；'redo' 重新应用修改后色号
export function applyStepToGrid(grid, width, changes, mode) {
  for (const ch of changes) {
    if (!ch || !Number.isInteger(ch.x) || !Number.isInteger(ch.y)) continue;
    grid[ch.y * width + ch.x] = mode === 'undo' ? ch.from : ch.to;
  }
}

// ---------------- 结构型步骤（裁剪等改变画布尺寸的操作） ----------------

// 结构型步骤的快照：包含尺寸、网格与滑块基副本（基副本随裁剪同步变化，撤销时需一并还原）
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
export function recordStructuralStep(undoStack, redoStack, before, after, type = 'crop') {
  const step = { structural: true, type, before: snapshotOf(before), after: snapshotOf(after) };
  undoStack.length = 0;
  redoStack.length = 0;
  undoStack.push(step);
  return step;
}

// 把结构型步骤应用到目标对象（{ width, height, grid, baseGrid }）；mode: 'undo' | 'redo'
export function applyStructuralStep(target, step, mode) {
  const snap = mode === 'undo' ? step.before : step.after;
  target.width = snap.width;
  target.height = snap.height;
  target.grid = Int16Array.from(snap.grid);
  target.baseGrid = Int16Array.from(snap.baseGrid || snap.grid);
}
