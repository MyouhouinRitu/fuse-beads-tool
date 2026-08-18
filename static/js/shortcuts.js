// 键盘快捷键：按优先级注册的快捷键表，避免单个巨型 keydown 分支链。
// 每个条目：test(e, ctx) 判断是否命中；run(e, ctx) 执行并返回 true 表示已处理（停止后续匹配）。

import * as colorList from './color-list.js';
import { QUICK_PICKER_MAX, TOOLS } from './constants.js';
import { els } from './els.js';
import * as exportDialog from './export-dialog.js';
import * as historyUI from './history-ui.js';
import { interactionState } from './interaction.js';
import * as markdown from './markdown.js';
import * as menu from './menu.js';
import * as paletteDialog from './palette-dialog.js';
import * as popup from './popup.js';
import { saveProjectFile } from './project-file.js';
import * as quickPicker from './quick-picker.js';
import * as selection from './selection.js';
import { App, dragState } from './state.js';
import { closeTargetPixelsMenu } from './target-pixels.js';
import * as toolState from './tool-state.js';
import * as undoRedo from './undo-redo.js';
import { blurActive } from './utils.js';

function handleEscape(e, ctx) {
  if (popup.isPopupOpen()) {
    popup.cancelPopup();
    blurActive();
    e.preventDefault();
    return true;
  }
  if (!els.paletteDialog.classList.contains('hidden')) {
    paletteDialog.closePaletteDialog();
    blurActive();
    e.preventDefault();
    return true;
  }
  if (!els.docDialog.classList.contains('hidden')) {
    markdown.closeFixDoc();
    blurActive();
    e.preventDefault();
    return true;
  }
  if (!els.fixMenu.classList.contains('hidden')) {
    menu.closeMenu(els.btnFixMenu, els.fixMenu);
    e.preventDefault();
    return true;
  }
  if (!els.targetPixelsMenu.classList.contains('hidden')) {
    closeTargetPixelsMenu();
    e.preventDefault();
    return true;
  }
  if (!els.exportDialog.classList.contains('hidden')) {
    // 导出弹窗：Escape 与「取消」一致
    exportDialog.closeExportDialog();
    blurActive();
    e.preventDefault();
    return true;
  }
  if (!els.loginMask.classList.contains('hidden')) {
    // 登录是必经门槛，Escape 仅清除错误提示，不关闭遮罩
    els.loginError.classList.add('hidden');
    blurActive();
    e.preventDefault();
    return true;
  }
  // 镜像模式：勾选框聚焦时也响应 ESC（需求：ESC 放弃预览并返回选择模式）
  if (App.tool === TOOLS.MIRROR) {
    toolState.setTool(TOOLS.SELECT);
    blurActive();
    e.preventDefault();
    return true;
  }
  if (ctx.inField) return false; // 输入框内不处理工具/选区 Escape
  if (!els.quickPicker.classList.contains('hidden')) {
    quickPicker.closeQuickPicker();
    e.preventDefault();
    return true;
  }
  quickPicker.closeQuickPicker(); // 未打开时为无操作
  if (App.tool !== TOOLS.SELECT) toolState.setTool(TOOLS.SELECT);
  else selection.clearSelection();
  blurActive();
  e.preventDefault();
  return true;
}

const SHORTCUTS = [
  { test: (e) => e.key === 'Escape', run: handleEscape },
  // Ctrl+Shift+S 保存项目；Ctrl+S 保存快照；两者都遵循焦点守卫
  {
    test: (e, ctx) => ctx.mod && e.shiftKey && e.key.toLowerCase() === 's' && !ctx.inField,
    run: (e) => {
      e.preventDefault();
      saveProjectFile();
      return true;
    },
  },
  {
    test: (e, ctx) => ctx.mod && e.key.toLowerCase() === 's' && !ctx.inField,
    run: (e) => {
      e.preventDefault();
      historyUI.saveTransaction();
      return true;
    },
  },
  // 输入框内：保存类快捷键已在上方处理，其余快捷键一律不触发
  { test: (_e, ctx) => ctx.inField, run: () => true },
  {
    // Ctrl+Shift+Z 与 Ctrl+Y 均为重做
    test: (e, ctx) => ctx.mod && e.shiftKey && e.key.toLowerCase() === 'z',
    run: (e) => {
      e.preventDefault();
      undoRedo.doRedo();
      return true;
    },
  },
  {
    test: (e, ctx) => ctx.mod && e.key.toLowerCase() === 'z',
    run: (e) => {
      e.preventDefault();
      undoRedo.doUndo();
      return true;
    },
  },
  {
    test: (e, ctx) => ctx.mod && e.key.toLowerCase() === 'y',
    run: (e) => {
      e.preventDefault();
      undoRedo.doRedo();
      return true;
    },
  },
  {
    // 九宫格打开期间：数字键选色，其余按键不再触发工具/选区快捷键
    test: () => !els.quickPicker.classList.contains('hidden'),
    run: (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= QUICK_PICKER_MAX && interactionState.pickerCandidates?.[n - 1]) {
        e.preventDefault();
        quickPicker.applyQuickColor(n - 1);
      }
      return true;
    },
  },
  {
    test: (e, ctx) => !ctx.mod && !dragState.active && e.key.toLowerCase() === 'q',
    run: (e) => {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.BRUSH);
      return true;
    },
  },
  {
    test: (e, ctx) => !ctx.mod && !dragState.active && e.key.toLowerCase() === 'w',
    run: (e) => {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.PICKER);
      return true;
    },
  },
  {
    test: (e, ctx) => !ctx.mod && !dragState.active && e.key.toLowerCase() === 'e',
    run: (e) => {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.ERASER);
      return true;
    },
  },
  {
    test: (e, ctx) => !ctx.mod && !dragState.active && e.key.toLowerCase() === 'r',
    run: (e) => {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.CROP);
      return true;
    },
  },
  {
    test: (e, ctx) => !ctx.mod && !dragState.active && e.key.toLowerCase() === 't',
    run: (e) => {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.WAND);
      return true;
    },
  },
  {
    test: (e, ctx) => !ctx.mod && !dragState.active && e.key.toLowerCase() === 'g',
    run: (e) => {
      e.preventDefault();
      colorList.switchToolShortcut(TOOLS.MIRROR);
      return true;
    },
  },
  {
    test: (e) => e.key === 'Delete',
    run: (e) => {
      e.preventDefault();
      selection.clearSelectionToEmpty();
      return true;
    },
  },
  {
    // 单选一格时作用于选中格，否则作用于当前悬停格（拖拽中忽略）
    test: (e, ctx) =>
      !ctx.mod &&
      e.key.toLowerCase() === 'd' &&
      App.tool === TOOLS.SELECT &&
      App.project &&
      !dragState.active,
    run: (e) => {
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
        return true;
      }
      return false;
    },
  },
];

export function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const ctx = {
      inField: t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'),
      mod: e.ctrlKey || e.metaKey,
    };
    for (const entry of SHORTCUTS) {
      if (entry.test(e, ctx) && entry.run(e, ctx)) break;
    }
  });
}
