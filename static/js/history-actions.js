// 单步撤销/重做：兼容普通增量步骤与结构性步骤（如裁剪）。

import { scheduleAutosave } from './autosave.js';
import { clearProjectEditingState } from './canvas.js';
import { applyStepToGrid, applyStructuralStep, redoStep, undoStep } from './history.js';
import { renderHistoryUI } from './history-ui.js';
import { scheduleRender } from './render-queue.js';
import { App, setDirty } from './state.js';
import { toast } from './utils.js';
import { fitViewportToCanvas } from './view.js';

// 应用一步撤销/重做（兼容普通增量步骤与结构性步骤）
function applyUndoRedoStep(step, mode) {
  if (step.structural) {
    const holder = { width: 0, height: 0, grid: null, baseGrid: null };
    applyStructuralStep(holder, step, mode);
    App.project = { width: holder.width, height: holder.height, grid: holder.grid };
    App.baseGrid = holder.baseGrid;
    App.sliderN = null;
    App.editedSinceSlider = false;
    clearProjectEditingState();
    fitViewportToCanvas(); // 尺寸变化后适应窗口
  } else {
    applyStepToGrid(App.project.grid, App.project.width, step.changes, mode);
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
