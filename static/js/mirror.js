// 镜像工具：进入镜像模式后，勾选水平 / 垂直即时预览（同时翻转拼豆图与对比原图显示）；
// 点击「应用」才实际提交（记入撤销 / 重做），按 ESC 或切换工具则恢复进入前状态。
// 预览通过原地变换 App.project.grid / baseGrid 实现，渲染依赖 gridRevision 失效后重建底图。

import { scheduleAutosave } from './autosave.js';
import { redrawOriginalImage } from './compare.js';
import { els } from './els.js';
import { recordMirrorStep } from './history.js';
import { touchGrid } from './mutations.js';
import { renderFullNow } from './render-queue.js';
import { App, setDirty } from './state.js';
import { toast } from './utils.js';

// 进入镜像模式时的快照：用于预览回滚与「应用」时的撤销记录（before）
let entry = null; // { grid, baseGrid, mirror }

// 水平翻转网格（原地）：把每行左右对调
function flipHorizontal(grid, width, height) {
  const half = width >> 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < half; x++) {
      const a = row + x;
      const b = row + (width - 1 - x);
      const tmp = grid[a];
      grid[a] = grid[b];
      grid[b] = tmp;
    }
  }
}

// 垂直翻转网格（原地）：把每列上下对调
function flipVertical(grid, width, height) {
  const half = height >> 1;
  for (let y = 0; y < half; y++) {
    const a = y * width;
    const b = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const pa = a + x;
      const pb = b + x;
      const tmp = grid[pa];
      grid[pa] = grid[pb];
      grid[pb] = tmp;
    }
  }
}

function gridsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isMirrorPreviewing() {
  return entry != null;
}

// 勾选框状态与当前镜像状态（App.originalMirror）保持一致：
// 已应用的镜像重新进入镜像模式时仍保持勾选。
function syncMirrorCheckboxes() {
  els.mirrorH.checked = !!App.originalMirror.horizontal;
  els.mirrorV.checked = !!App.originalMirror.vertical;
}

// 进入镜像模式：保存进入前的网格与对比原图镜像状态，勾选框反映当前已应用的镜像
export function enterMirror() {
  if (!App.project) return;
  entry = {
    grid: App.project.grid.slice(),
    baseGrid: App.baseGrid ? App.baseGrid.slice() : null,
    mirror: {
      horizontal: !!App.originalMirror.horizontal,
      vertical: !!App.originalMirror.vertical,
    },
  };
  syncMirrorCheckboxes();
}

// 勾选 / 取消勾选：即时翻转拼豆图与对比原图显示（仅预览，不写撤销记录）
export function toggleMirror(axis) {
  if (!App.project || !entry) return;
  const { width, height } = App.project;
  const grid = App.project.grid;
  const base = App.baseGrid;
  if (axis === 'horizontal') {
    flipHorizontal(grid, width, height);
    if (base) flipHorizontal(base, width, height);
    App.originalMirror.horizontal = !App.originalMirror.horizontal;
  } else {
    flipVertical(grid, width, height);
    if (base) flipVertical(base, width, height);
    App.originalMirror.vertical = !App.originalMirror.vertical;
  }
  touchGrid();
  renderFullNow();
  redrawOriginalImage();
}

// 应用镜像：保留当前翻转结果，把「进入前 → 当前」记入一步撤销 / 重做，并退出镜像模式
export function applyMirror() {
  if (!App.project || !entry) return;
  const changed = !gridsEqual(entry.grid, App.project.grid);
  if (changed) {
    const before = {
      width: App.project.width,
      height: App.project.height,
      grid: entry.grid,
      baseGrid: entry.baseGrid,
    };
    const after = {
      width: App.project.width,
      height: App.project.height,
      grid: App.project.grid.slice(),
      baseGrid: App.baseGrid ? App.baseGrid.slice() : null,
    };
    recordMirrorStep(App.undoStack, App.redoStack, before, after, entry.mirror, {
      horizontal: App.originalMirror.horizontal,
      vertical: App.originalMirror.vertical,
    });
    setDirty(true);
    scheduleAutosave();
    toast('已应用镜像');
  } else {
    toast('未做任何镜像');
  }
  // 清除预览状态：退出时 setTool 的 cancelMirror 将不再回滚；
  // 勾选框保留当前镜像状态（已应用的勾选不因退出而清空）
  entry = null;
  syncMirrorCheckboxes();
}

// 项目整体重建（导入 / 重新压缩 / 滑块 / 打开项目 / 切换快照）后清除残留预览状态
export function resetMirror() {
  entry = null;
  syncMirrorCheckboxes();
}

// 放弃镜像预览：恢复进入镜像模式前的网格与对比原图显示
export function cancelMirror() {
  if (App.project && entry) {
    App.project.grid.set(entry.grid);
    if (App.baseGrid && entry.baseGrid) App.baseGrid.set(entry.baseGrid);
    App.originalMirror.horizontal = entry.mirror.horizontal;
    App.originalMirror.vertical = entry.mirror.vertical;
    touchGrid();
    renderFullNow();
    redrawOriginalImage();
  }
  entry = null;
  syncMirrorCheckboxes();
}
