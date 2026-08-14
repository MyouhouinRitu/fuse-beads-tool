// 自动化测试挂钩（稳定契约）。
//
// 本模块是测试（tests/dom_behavior_test.mjs、tests/ui_test.mjs、
// tests/render_consistency_test.mjs）与内部实现之间的唯一契约面：
// - 只有 main.js 调用 installTestHooks 装配；
// - 仅在 URL 带 ?test=1 或预设 __FUSE_TEST__ 全局标记时暴露，
//   避免生产页面被任意脚本读取内部状态；
// - 重构内部实现时需保持这里的暴露面不变，或同步更新上述测试。
//   测试还会直接读写 window.__app / window.__dragState，
//   修改 App / dragState 的字段结构前需先确认测试用法。

import { drawPattern } from './render.js';
import { buildProjectDocument } from './autosave.js';
import { App, dragState } from './state.js';
import * as canvas from './canvas.js';
import * as crop from './crop.js';
import * as exportDialog from './export-dialog.js';
import * as historyActions from './history-actions.js';
import * as historyUI from './history-ui.js';
import * as markdown from './markdown.js';
import * as quickPicker from './quick-picker.js';
import * as theme from './theme.js';
import * as toolState from './tool-state.js';
import * as view from './view.js';
import * as workspace from './workspace.js';
import { getToastQueue } from './utils.js';

export function installTestHooks({ renderAll, applySlider, restoreState }) {
  const expose = (
    (typeof window !== 'undefined' && window.__FUSE_TEST__ === true)
    || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test'))
  );
  if (!expose) return;

  window.__app = App;
  window.__dragState = dragState;

  // 自动化测试用：暴露需要直接驱动的内部函数
  window.__testHooks = {
    renderAll,
    redrawCanvas: canvas.redrawCanvas,
    drawPattern,
    setTool: toolState.setTool,
    updateBrush: workspace.updateBrush,
    paintCell: workspace.paintCell,
    paintStamp: workspace.paintStamp,
    applyQuickColor: quickPicker.applyQuickColor,
    doUndo: historyActions.doUndo,
    doRedo: historyActions.doRedo,
    openFixDoc: markdown.openFixDoc,
    closeFixDoc: markdown.closeFixDoc,
    toggleTheme: theme.toggleTheme,
    recordCropStep: crop.recordCropStep,
    moveCropEdgeTo: crop.moveCropEdgeTo,
    updateCropCursor: crop.updateCropCursor,
    updateCropPreview: crop.updateCropPreview,
    autoCrop: crop.autoCrop,
    applyCrop: crop.applyCrop,
    updateCropMagnifier: crop.updateCropMagnifier,
    applySlider,
    saveTransaction: historyUI.saveTransaction,
    switchHistoryItem: historyUI.switchHistoryItem,
    deleteHistoryItem: historyUI.deleteHistoryItem,
    clearAll: historyUI.clearAll,
    restoreState,
    renderHistoryUI: historyUI.renderHistoryUI,
    openExportDialog: exportDialog.openExportDialog,
    renderExportPreview: exportDialog.renderExportPreview,
    mirrorBeadToOrig: view.mirrorBeadToOrig,
    mirrorOrigToBead: view.mirrorOrigToBead,
    getToastQueue,
    buildProjectDocument,
  };
}
