// 事务历史：独立（扁平）结构，不做树状分支。
// 每次 Ctrl+S 保存一个完整快照（所有点位的颜色），节点之间没有父子关系。
// 另提供单步撤销/重做记录：以增量方式记录（像素 x/y，从哪个色号改到哪个色号）。

export const MAX_UNDO_STEPS = 20;

export function createEmptyHistory() {
  return { items: [], currentId: null, nextId: 1 };
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
  return {
    items,
    currentId,
    nextId: items.reduce((m, it) => Math.max(m, it.id + 1), 1),
  };
}

export function findTransaction(history, id) {
  return history.items.find((it) => it.id === id) || null;
}

export function createTransaction(history, snapshot) {
  const id = history.nextId++;
  const item = { id, createdAt: Date.now(), label: `状态 #${id}`, snapshot };
  history.items.push(item);
  history.currentId = id;
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
  if (!changes || !changes.length) return null;
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
