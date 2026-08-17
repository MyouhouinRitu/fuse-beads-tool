// 顶部工具栏与全局弹窗：认证、项目文件、导入压缩、比较开关、导出弹窗、历史、帮助文档、主题。

import * as api from './api.js';
import * as auth from './auth.js';
import * as compare from './compare.js';
import { els } from './els.js';
import * as exportDialog from './export-dialog.js';
import * as historyUI from './history-ui.js';
import * as markdown from './markdown.js';
import * as menu from './menu.js';
import { confirmDialog } from './popup.js';
import { openProjectViaDialog, saveProjectFile } from './project-file.js';
import { applyProjectDocument } from './restore.js';
import { App, setProjectDirty } from './state.js';
import { closeTargetPixelsMenu } from './target-pixels.js';
import * as theme from './theme.js';
import * as undoRedo from './undo-redo.js';
import * as upload from './upload.js';
import { toast, withPending } from './utils.js';

export function bindToolbar() {
  els.btnLogin.addEventListener('click', () => withPending(els.btnLogin, auth.tryLogin));
  els.loginToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') withPending(els.btnLogin, auth.tryLogin);
  });
  els.btnLogout.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch (_e) {
      /* ignore */
    }
    location.reload();
  });

  els.btnOpenProject.addEventListener('click', () =>
    withPending(els.btnOpenProject, openProjectViaDialog),
  );
  els.projectFileInput.addEventListener('change', async () => {
    const f = els.projectFileInput.files[0];
    els.projectFileInput.value = '';
    if (!f) return;
    // 确认提示由 openProjectViaDialog 在打开文件对话框前统一弹出，这里不再重复
    await withPending(els.btnOpenProject, async () => {
      try {
        const res = await api.openProjectUpload(f);
        await applyProjectDocument(res.document);
      } catch (e) {
        toast(`打开项目失败：${e.message}`, { type: 'error' });
      }
    });
  });
  els.btnSaveProject.addEventListener('click', () =>
    withPending(els.btnSaveProject, saveProjectFile),
  );
  els.btnImport.addEventListener('click', async () => {
    if (
      App.projectDirty &&
      !(await confirmDialog('当前项目有未保存的更改，导入新图片将覆盖。是否继续？'))
    )
      return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', async () => {
    const f = els.fileInput.files[0];
    if (f) {
      App.originalFile = f;
      compare.loadOriginalImage(f);
      await withPending(els.btnImport, () => upload.processUpload());
    }
    els.fileInput.value = '';
  });
  els.btnRecompress.addEventListener('click', () =>
    withPending(els.btnRecompress, upload.recompress),
  );
  els.chkCompare.addEventListener('change', () => {
    compare.setCompareEnabled(els.chkCompare.checked);
    setProjectDirty(true);
  });
  els.chkSyncPan.addEventListener('change', () => {
    compare.setSyncPan(els.chkSyncPan.checked);
    setProjectDirty(true);
  });

  els.btnExport.addEventListener('click', exportDialog.openExportDialog);
  els.dlgCancel.addEventListener('click', exportDialog.closeExportDialog);
  els.dlgOk.addEventListener('click', () => withPending(els.dlgOk, exportDialog.doExport));
  for (const [key, evt] of [
    ['dlgCell', 'input'],
    ['dlgPad', 'input'],
    ['dlgGrid', 'change'],
    ['dlgEdgeNumbers', 'change'],
    ['dlgCodes', 'change'],
    ['dlgLegend', 'change'],
    ['dlgEmptyStyle', 'change'],
    ['dlgFormat', 'change'],
  ]) {
    els[key].addEventListener(evt, exportDialog.renderExportPreview);
  }
  els.exportDialog.addEventListener('click', (e) => {
    if (e.target === els.exportDialog) exportDialog.closeExportDialog();
  });

  els.btnSaveStateSide.addEventListener('click', historyUI.saveTransaction);
  els.btnClearAll.addEventListener('click', async () => {
    await historyUI.clearAll();
  });
  els.btnUndo.addEventListener('click', undoRedo.doUndo);
  els.btnRedo.addEventListener('click', undoRedo.doRedo);

  els.btnFixMenu.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    if (els.fixMenu.classList.contains('hidden')) menu.openMenu(els.btnFixMenu, els.fixMenu);
    else menu.closeMenu(els.btnFixMenu, els.fixMenu);
  });
  els.fixMenu.addEventListener('keydown', (e) =>
    menu.handleMenuKeydown(e, els.btnFixMenu, els.fixMenu),
  );
  els.fixItemGesture.addEventListener('click', () => {
    menu.closeMenu(els.btnFixMenu, els.fixMenu);
    markdown.openFixDoc('right-drag-gesture-fix');
  });
  els.fixItemShortcuts.addEventListener('click', () => {
    menu.closeMenu(els.btnFixMenu, els.fixMenu);
    markdown.openFixDoc('shortcuts');
  });
  els.docClose.addEventListener('click', markdown.closeFixDoc);
  els.docDialog.addEventListener('click', (e) => {
    if (e.target === els.docDialog) markdown.closeFixDoc();
  });
  els.btnTheme.addEventListener('click', theme.toggleTheme);
  document.addEventListener('click', () => {
    menu.closeMenu(els.btnFixMenu, els.fixMenu, { restoreFocus: false });
    closeTargetPixelsMenu();
  });
}
