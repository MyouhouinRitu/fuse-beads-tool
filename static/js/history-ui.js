// 事务历史面板：保存快照、切换/删除节点、清空、历史列表渲染与撤销按钮状态。

import * as api from './api.js';
import * as C from './colors.js';
import { els } from './els.js';
import { paletteHash } from './hash.js';
import {
  createEmptyHistory,
  createTransaction,
  deleteTransaction,
  findTransaction,
  MAX_UNDO_STEPS,
} from './history.js';
import { App, clearHistoryRecords, hasPendingRecords, setDirty, setProjectDirty } from './state.js';
import { toast } from './utils.js';
import { resetProjectEditingState } from './canvas.js';
import { ensurePaletteConfig, renderColorTable } from './palette.js';
import { renderAllNow } from './render-queue.js';
import { scheduleAutosave } from './autosave.js';

export function updateUndoUI() {
  els.btnUndo.disabled = App.undoStack.length === 0;
  els.btnRedo.disabled = App.redoStack.length === 0;
  els.undoInfo.textContent = `单步记录：${App.undoStack.length}/${MAX_UNDO_STEPS}`;
}

export function saveTransaction() {
  if (!App.project) { toast('请先导入图片'); return; }
  const snapshot = {
    grid: Array.from(App.project.grid),
    width: App.project.width,
    height: App.project.height,
    paletteName: App.configName,
    palette: App.appliedPalette.map((c) => ({ ...c })),
    paletteHash: paletteHash(App.appliedPalette),
    maxColors: App.maxColors,
  };
  const item = createTransaction(App.history, snapshot);
  setProjectDirty(true);
  setDirty(false);
  renderHistoryUI();
  toast(`已保存状态#${item.id}（Ctrl+S）`);
  scheduleAutosave();
}

export async function switchHistoryItem(id) {
  const node = findTransaction(App.history, id);
  if (!node) return;
  const snap = node.snapshot;
  App.project = { width: snap.width, height: snap.height, grid: Int16Array.from(snap.grid) };
  App.baseGrid = App.project.grid.slice();
  App.maxColors = snap.maxColors || C.countUsedColors(App.project.grid, snap.width, snap.height) || 2;
  App.sliderN = null;
  App.editedSinceSlider = false;
  App.history.currentId = id;
  App.history.baselineId = id;
  setProjectDirty(true);
  // 切换到其它事务后，以该事务快照中的色板作为已应用色板渲染画布
  App.appliedPalette = (snap.palette || []).map((c) => ({ ...c }));
  // 切换到其它事务后，工作网格整体被替换，旧的单步记录不再有效
  resetProjectEditingState();

  const snapPalette = snap.palette && snap.palette.length ? snap.palette : null;
  if (snapPalette) {
    try {
      const preferred = snap.paletteName || App.configName || '恢复色板';
      const { name } = await ensurePaletteConfig(snapPalette, preferred);
      snap.paletteName = name;
      const res = await api.getConfig(name);
      App.palette = res.colors;
      App.configName = res.name;
      els.configSelect.value = res.name;
      renderColorTable();
    } catch (e) {
      App.palette = (snap.palette || []).map((c) => ({ ...c }));
    }
  } else if (snap.paletteName && App.configs.some((c) => c.name === snap.paletteName)) {
    try {
      const res = await api.getConfig(snap.paletteName);
      App.palette = res.colors;
      App.configName = res.name;
      els.configSelect.value = res.name;
      renderColorTable();
    } catch (e) {
      App.palette = [];
    }
  } else {
    App.palette = [];
  }
  renderAllNow();
  renderHistoryUI();
  toast(`已切换到状态#${id}`);
  scheduleAutosave();
}

export function deleteHistoryItem(id) {
  const node = findTransaction(App.history, id);
  if (!node) return;
  if (!confirm(`确定删除事务「${node.label}」吗？此操作不可恢复。`)) return;
  const prev = App.history.currentId;
  const { newCurrent } = deleteTransaction(App.history, id);
  setProjectDirty(true);
  if (App.history.baselineId === id) App.history.baselineId = null;
  if (newCurrent != null && newCurrent !== prev) {
    switchHistoryItem(newCurrent);
  } else {
    if (prev === id) {
      // 删除了当前事务：工作网格失去锚点，单步记录一并清空
      App.undoStack = [];
      App.redoStack = [];
      App.strokeBuffer = null;
    }
    renderHistoryUI();
  }
  scheduleAutosave();
}

export function clearAll({ silent = false } = {}) {
  if (!App.project && App.history.items.length === 0) {
    if (!silent) toast('当前没有可清空的内容');
    return;
  }
  if (!silent && !confirm('确定要清空所有状态吗？\n将清空画布并删除全部事务历史，此操作不可恢复。')) return;
  App.project = null;
  App.baseGrid = null;
  App.compressed = null;
  App.originalFile = null;
  const oldOriginalId = App.originalId;
  App.originalId = null;
  App.originalName = null;
  App.originalSha256 = null;
  App.originalSize = null;
  App.projectName = null;
  if (oldOriginalId) api.deleteOriginal(oldOriginalId).catch(() => {});
  setProjectDirty(false);
  App.history = createEmptyHistory();
  App.maxColors = 2;
  App.sliderN = null;
  App.editedSinceSlider = false;
  resetProjectEditingState();
  renderHistoryUI();
  renderAllNow();
  scheduleAutosave();
  toast('已清空所有状态');
}

export function renderHistoryUI() {
  const list = els.historyList;
  list.innerHTML = '';
  els.historyEmpty.style.display = App.history.items.length ? 'none' : '';
  // 扁平显示：没有子树，所有事务节点按保存顺序排列在同一层
  const frag = document.createDocumentFragment();
  for (const item of App.history.items) frag.appendChild(renderHistoryItem(item));
  list.appendChild(frag);
  updateUndoUI();
}

// 历史列表事件委托：容器上只绑定一个 click（节点切换 / 删除按钮）
export function bindHistoryList() {
  els.historyList.addEventListener('click', (e) => {
    const del = e.target.closest('.hi-del');
    if (del) {
      deleteHistoryItem(Number(del.dataset.id));
      return;
    }
    const node = e.target.closest('.history-item');
    if (!node) return;
    const id = Number(node.dataset.id);
    if (App.history.currentId !== id) switchHistoryItem(id);
  });
}

function renderHistoryItem(item) {
  const { id } = item;
  const div = document.createElement('div');
  div.className = 'history-item' + (App.history.currentId === id ? ' current' : '');
  div.dataset.id = String(id);

  const head = document.createElement('div');
  head.className = 'hi-head';
  const label = document.createElement('span');
  label.className = 'hi-label';
  label.textContent = item.label;
  const time = document.createElement('span');
  time.className = 'hi-time';
  time.textContent = new Date(item.createdAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  head.append(label, time);

  const actions = document.createElement('div');
  actions.className = 'hi-actions';
  const del = document.createElement('button');
  del.className = 'hi-del';
  del.dataset.id = String(id);
  del.textContent = '删除';
  del.title = '仅删除该事务节点';
  actions.append(del);
  div.append(head, actions);
  if (App.history.baselineId === id) {
    const dot = document.createElement('span');
    dot.className = 'hi-baseline-dot';
    dot.title = '当前修改基于此事务';
    div.appendChild(dot);
  }
  return div;
}

// 有事务/撤销记录时弹确认并清空；无记录或用户取消时返回 false
export function confirmClearRecords(message) {
  if (!hasPendingRecords()) return true;
  if (!confirm(message)) return false;
  clearHistoryRecords();
  renderHistoryUI();
  return true;
}
