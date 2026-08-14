// 键盘快捷键：弹窗关闭 / 保存 / 撤销重做 / 工具切换 / 选区操作。

import * as colorList from './color-list.js';
import { QUICK_PICKER_MAX, TOOLS } from './constants.js';
import { els } from './els.js';
import * as exportDialog from './export-dialog.js';
import * as historyUI from './history-ui.js';
import { interactionState } from './interaction.js';
import * as markdown from './markdown.js';
import { saveProjectFile } from './project-file.js';
import * as quickPicker from './quick-picker.js';
import * as selection from './selection.js';
import { App, dragState } from './state.js';
import * as toolState from './tool-state.js';
import * as undoRedo from './undo-redo.js';

export function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField =
      t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!els.docDialog.classList.contains('hidden')) {
        markdown.closeFixDoc();
        e.preventDefault();
        return;
      }
      if (!els.fixMenu.classList.contains('hidden')) {
        els.fixMenu.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!els.targetPixelsMenu.classList.contains('hidden')) {
        els.targetPixelsMenu.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (!els.exportDialog.classList.contains('hidden')) {
        // 导出弹窗：Escape 与「取消」一致
        exportDialog.closeExportDialog();
        e.preventDefault();
        return;
      }
      if (!els.loginMask.classList.contains('hidden')) {
        // 登录是必经门槛，Escape 仅清除错误提示，不关闭遮罩
        els.loginError.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (inField) return; // 输入框内不处理工具/选区 Escape
      if (!els.quickPicker.classList.contains('hidden')) {
        quickPicker.closeQuickPicker();
        e.preventDefault();
        return;
      }
      quickPicker.closeQuickPicker(); // 未打开时为无操作
      if (App.tool !== TOOLS.SELECT) toolState.setTool(TOOLS.SELECT);
      else selection.clearSelection();
      e.preventDefault();
      return;
    }
    // Ctrl+Shift+S 保存项目；Ctrl+S 保存事务；两者都遵循焦点守卫
    if (mod && e.shiftKey && e.key.toLowerCase() === 's' && !inField) {
      e.preventDefault();
      saveProjectFile();
      return;
    }
    if (mod && e.key.toLowerCase() === 's' && !inField) {
      e.preventDefault();
      historyUI.saveTransaction();
      return;
    }
    if (inField) return;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
      // Ctrl+Shift+Z 与 Ctrl+Y 均为重做
      e.preventDefault();
      undoRedo.doRedo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoRedo.doUndo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      undoRedo.doRedo();
      return;
    }
    const pickerOpen = !els.quickPicker.classList.contains('hidden');
    if (pickerOpen) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= QUICK_PICKER_MAX && interactionState.pickerCandidates?.[n - 1]) {
        e.preventDefault();
        quickPicker.applyQuickColor(n - 1);
      }
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.BRUSH);
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.PICKER);
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.ERASER);
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.CROP);
      return;
    }
    if (!mod && !dragState.active && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.WAND);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      selection.clearSelectionToEmpty();
      return;
    }
    if (
      e.key.toLowerCase() === 'd' &&
      App.tool === TOOLS.SELECT &&
      App.project &&
      !dragState.active
    ) {
      // 单选一格时作用于选中格，否则作用于当前悬停格（拖拽中忽略）
      let target = null;
      if (App.selection.size === 1) {
        const p = App.selection.values().next().value;
        target = { x: p % App.project.width, y: (p / App.project.width) | 0 };
      } else if (interactionState.hoverCell) {
        target = interactionState.hoverCell;
      }
      if (target) {
        e.preventDefault();
        quickPicker.openQuickPicker(target);
      }
    }
  });
}
