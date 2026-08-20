// 单步撤销 / 重做入口：兼容普通增量步骤与结构性步骤（如裁剪）。

import { scheduleAutosave } from './autosave.js';
import { clearProjectEditingState } from './canvas.js';
import { redrawOriginalImage } from './compare.js';
import { applyStructuralStep, redoStep, undoStep } from './history.js';
import { renderHistoryUI } from './history-ui.js';
import { applyGridChanges } from './mutations.js';
import { scheduleRender } from './render-queue.js';
import { App, setDirty } from './state.js';
import { toast } from './utils.js';
import { fitViewportToCanvas } from './view.js';

// 应用一步撤销/重做（兼容普通增量步骤与结构性步骤）
/** @param {FuseStep} step @param {'undo' | 'redo'} mode */
function applyUndoRedoStep(step, mode) {
  if ('structural' in step && step.type === 'mirror') {
    // 镜像：尺寸不变，还原网格/基副本并同步对比原图显示方向（不重置滑块状态、不重适应窗口）
    /** @type {{ width: number, height: number, grid: Int16Array | null, baseGrid: Int16Array | null }} */
    const holder = { width: 0, height: 0, grid: null, baseGrid: null };
    applyStructuralStep(holder, step, mode);
    App.project = {
      width: holder.width,
      height: holder.height,
      grid: /** @type {Int16Array} */ (holder.grid),
    };
    App.baseGrid = holder.baseGrid;
    const ms = mode === 'undo' ? step.mirrorBefore : step.mirrorAfter;
    App.originalMirror.horizontal = !!ms?.horizontal;
    App.originalMirror.vertical = !!ms?.vertical;
    redrawOriginalImage();
    clearProjectEditingState();
  } else if ('structural' in step) {
    /** @type {{ width: number, height: number, grid: Int16Array | null, baseGrid: Int16Array | null }} */
    const holder = { width: 0, height: 0, grid: null, baseGrid: null };
    applyStructuralStep(holder, step, mode);
    App.project = {
      width: holder.width,
      height: holder.height,
      grid: /** @type {Int16Array} */ (holder.grid),
    };
    App.baseGrid = holder.baseGrid;
    App.sliderN = null;
    App.editedSinceSlider = false;
    clearProjectEditingState();
    fitViewportToCanvas(); // 尺寸变化后适应窗口
  } else {
    const changes = step.changes.map((ch) => ({
      x: ch.x,
      y: ch.y,
      to: mode === 'undo' ? ch.from : ch.to,
    }));
    applyGridChanges(changes);
  }
  setDirty(true);
  renderHistoryUI();
  scheduleRender();
  scheduleAutosave();
}

export function doUndo() {
  if (!App.project) return;
  const step = undoStep(App.undoStack, App.redoStack);
  if (!step) return;
  applyUndoRedoStep(step, 'undo');
  toast(`已撤销（剩余 ${App.undoStack.length} 步）`);
}

export function doRedo() {
  if (!App.project) return;
  const step = redoStep(App.undoStack, App.redoStack);
  if (!step) return;
  applyUndoRedoStep(step, 'redo');
  toast(`已重做（剩余 ${App.redoStack.length} 步）`);
}
