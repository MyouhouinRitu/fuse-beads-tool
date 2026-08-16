// 事件绑定：工具栏 / 面板 / 画布鼠标与滚轮 / 弹窗控件；键盘快捷键统一走 shortcuts.js。

import * as api from './api.js';
import * as auth from './auth.js';
import { scheduleAutosave } from './autosave.js';
import * as canvas from './canvas.js';
import * as colorList from './color-list.js';
import * as compare from './compare.js';
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  TOOLS,
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
  ZOOM_BUTTON_FACTOR,
} from './constants.js';
import * as crop from './crop.js';
import { confirmDialog, promptDialog } from './dialog.js';
import * as drag from './drag.js';
import { els } from './els.js';
import * as exportDialog from './export-dialog.js';
import * as highlight from './highlight.js';
import * as historyUI from './history-ui.js';
import { interactionState } from './interaction.js';
import * as markdown from './markdown.js';
import * as menu from './menu.js';
import * as palette from './palette.js';
import * as paletteDialog from './palette-dialog.js';
import * as panel from './panel.js';
import { openProjectViaDialog, saveProjectFile } from './project-file.js';
import * as quickPicker from './quick-picker.js';
import { scheduleCanvasRender } from './render-queue.js';
import { applyProjectDocument } from './restore.js';
import { bindShortcuts } from './shortcuts.js';
import { applySlider } from './slider.js';
import { App, setProjectDirty } from './state.js';
import { bindTargetPixels, closeTargetPixelsMenu } from './target-pixels.js';
import * as theme from './theme.js';
import * as toolState from './tool-state.js';
import * as undoRedo from './undo-redo.js';
import * as upload from './upload.js';
import {
  clampInt,
  downloadUrl,
  getTargetPixels,
  hintDistanceDeferred,
  toast,
  withPending,
} from './utils.js';
import * as view from './view.js';

export function bindEvents() {
  panel.bindPanelToggles();
  palette.bindColorTable();
  colorList.bindColorList();
  highlight.bindHighlightList();
  historyUI.bindHistoryList();
  quickPicker.bindQuickPicker();
  bindTargetPixels();

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
    if (
      App.projectDirty &&
      !(await confirmDialog('当前项目有未保存的更改，打开新项目将覆盖。是否继续？'))
    )
      return;
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
  els.chkCodes.addEventListener('change', () => {
    App.settings.showCodes = els.chkCodes.checked;
    canvas.rebuildCanvas();
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.chkSharpen.addEventListener('change', () => {
    App.settings.sharpen = els.chkSharpen.checked;
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.targetPixels.addEventListener('input', () => {
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.targetPixels.addEventListener('change', () => {
    // 失焦时把越界值收敛到合法区间，避免显示值与实际使用值不一致
    els.targetPixels.value = String(getTargetPixels());
  });
  els.selDistance.addEventListener('change', () => {
    const useLab = els.selDistance.value === 'lab';
    if (App.settings.useLab === useLab) return;
    // 颜色距离只保存设置，不立即重算；单击「重新压缩」后按新算法生成图案
    App.settings.useLab = useLab;
    setProjectDirty(true);
    scheduleAutosave();
    hintDistanceDeferred();
  });

  els.colorSlider.addEventListener('input', async () => {
    await applySlider(parseInt(els.colorSlider.value, 10));
  });
  els.emptyStyle.addEventListener('change', () => {
    App.settings.emptyStyle = els.emptyStyle.value;
    canvas.rebuildCanvas();
    setProjectDirty(true);
    scheduleAutosave();
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
  els.exportDialog.addEventListener('click', (e) => {
    if (e.target === els.exportDialog) exportDialog.closeExportDialog();
  });
  els.btnTheme.addEventListener('click', theme.toggleTheme);
  document.addEventListener('click', () => {
    menu.closeMenu(els.btnFixMenu, els.fixMenu, { restoreFocus: false });
    closeTargetPixelsMenu();
  });

  els.configSelect.addEventListener('change', () => {
    const name = els.configSelect.value;
    if (name) {
      setProjectDirty(true);
      palette.loadConfigDetail(name);
    }
  });
  els.btnNewConfig.addEventListener('click', () =>
    withPending(els.btnNewConfig, async () => {
      const name = await promptDialog('配置名称：');
      if (!name) return;
      const colors = App.palette.length
        ? App.palette.map((c) => ({ ...c }))
        : [{ index: 1, code: '001', name: '白色', hex: '#FFFFFF' }];
      try {
        await api.createConfig(name, colors);
        await palette.selectAndLoad(name);
        setProjectDirty(true);
        toast(`已创建配置「${name}」`, { type: 'success' });
      } catch (err) {
        toast(`创建失败：${err.message}`, { type: 'error' });
      }
    }),
  );
  els.btnImportConfig.addEventListener('click', () => els.configFileInput.click());
  els.configFileInput.addEventListener('change', () => {
    const f = els.configFileInput.files[0];
    els.configFileInput.value = '';
    if (!f) return;
    return withPending(els.btnImportConfig, async () => {
      try {
        const res = await api.importConfig(f);
        await palette.selectAndLoad(res.name);
        setProjectDirty(true);
        toast(`已导入配置「${res.name}」（${res.colors.length} 色）`, { type: 'success' });
      } catch (err) {
        toast(`导入失败：${err.message}`, { type: 'error' });
      }
    });
  });
  els.btnExportConfig.addEventListener('click', () => {
    if (!App.configName) return;
    downloadUrl(
      `/api/configs/${encodeURIComponent(App.configName)}/export`,
      `${App.configName}.csv`,
    );
  });
  els.btnRenameConfig.addEventListener('click', () =>
    withPending(els.btnRenameConfig, async () => {
      if (!App.configName) return;
      const newName = await promptDialog('配置名称：', App.configName);
      if (!newName || newName === App.configName) return;
      try {
        await api.renameConfig(App.configName, newName);
        await palette.selectAndLoad(newName);
        setProjectDirty(true);
        toast('已重命名', { type: 'success' });
      } catch (err) {
        toast(`重命名失败：${err.message}`, { type: 'error' });
      }
    }),
  );
  els.btnDeleteConfig.addEventListener('click', () =>
    withPending(els.btnDeleteConfig, async () => {
      if (!App.configName) return;
      if (App.configs.length <= 1) {
        toast('至少需要保留一个配置');
        return;
      }
      if (!(await confirmDialog(`确定删除配置「${App.configName}」吗？`))) return;
      try {
        await api.deleteConfig(App.configName);
        const remaining = App.configs.filter((c) => c.name !== App.configName);
        await palette.selectAndLoad(remaining[0] ? remaining[0].name : null);
        setProjectDirty(true);
        toast('已删除配置', { type: 'success' });
      } catch (err) {
        toast(`删除失败：${err.message}`, { type: 'error' });
      }
    }),
  );
  els.btnAddColor.addEventListener('click', palette.addColor);

  // 模式按钮：画笔/橡皮/取色互斥切换（画笔未选色时先取调色板最暗色）
  for (const [btnKey, tool] of [
    ['toolBrush', TOOLS.BRUSH],
    ['toolEraser', TOOLS.ERASER],
    ['toolPicker', TOOLS.PICKER],
    ['toolCrop', TOOLS.CROP],
    ['toolWand', TOOLS.WAND],
  ]) {
    els[btnKey].addEventListener('click', () => {
      if (tool === TOOLS.BRUSH && !colorList.ensureBrushColor()) return;
      toolState.setTool(App.tool === tool ? TOOLS.SELECT : tool);
    });
  }
  els.btnAutoCrop.addEventListener('click', crop.autoCrop);
  els.btnApplyCrop.addEventListener('click', crop.applyCrop);
  els.sameColorChk.addEventListener('change', () => {
    App.settings.sameColorSelect = els.sameColorChk.checked;
    setProjectDirty(true);
    scheduleAutosave();
  });
  els.selectHighlightBtn.addEventListener('click', () => {
    // 选中高亮颜色：先取消当前选择，再选中该色号全部像素，并取消高亮显示
    if (interactionState.highlightColor == null || !App.project) return;
    const color = interactionState.highlightColor;
    const { grid } = App.project;
    const next = new Set();
    for (let p = 0; p < grid.length; p++) {
      if (grid[p] === color) next.add(p);
    }
    App.selection = next;
    interactionState.dragPreview = null;
    interactionState.highlightColor = null;
    canvas.syncHighlightBlink();
    highlight.renderHighlightColorList();
    scheduleCanvasRender();
    toolState.updateModeControls();
  });
  els.brushSize.addEventListener('input', () => {
    App.settings.brushSize = clampInt(
      els.brushSize.value,
      BRUSH_SIZE_MIN,
      BRUSH_SIZE_MAX,
      BRUSH_SIZE_MIN,
    );
    toolState.updateModeControls();
    setProjectDirty(true);
    scheduleCanvasRender();
    scheduleAutosave();
  });
  els.wandSensitivity.addEventListener('input', () => {
    App.settings.wandSensitivity = clampInt(
      els.wandSensitivity.value,
      WAND_SENSITIVITY_MIN,
      WAND_SENSITIVITY_MAX,
      WAND_SENSITIVITY_DEFAULT,
    );
    toolState.updateModeControls();
    setProjectDirty(true);
    scheduleAutosave();
  });

  // 缩放按钮：围绕工作区中心缩放
  for (const [btnKey, factor] of [
    ['zoomIn', ZOOM_BUTTON_FACTOR],
    ['zoomOut', 1 / ZOOM_BUTTON_FACTOR],
  ]) {
    els[btnKey].addEventListener('click', () => {
      const vp = els.canvasScroll;
      const r = vp.getBoundingClientRect();
      view.zoomAtCore(r.left + r.width / 2, r.top + r.height / 2, factor);
      setProjectDirty(true);
    });
  }
  els.zoomFit.addEventListener('click', () => {
    view.fitViewportToCanvas();
    setProjectDirty(true);
  });

  els.canvasScroll.addEventListener('pointerdown', drag.onCanvasPointerDown);
  window.addEventListener('pointermove', drag.onWindowPointerMove);
  window.addEventListener('pointerup', drag.onWindowPointerUp);
  els.canvasScroll.addEventListener('pointerleave', drag.onCanvasScrollPointerLeave);
  // 九宫格：鼠标移出弹窗时还原悬停预览的颜色
  els.quickPicker.addEventListener('mouseleave', quickPicker.restoreQuickPickerPreview);
  // 全域禁用右键菜单：工具不需要右键菜单，避免拖拽结束时在菜单栏等位置弹出；
  // 输入框保留原生菜单（粘贴 / 拼写检查等，登录 Token、色号、Hex 等都需要粘贴）
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t?.closest?.('input, textarea, select')) return;
    e.preventDefault();
  });

  els.canvasScroll.addEventListener('wheel', drag.onCanvasWheel, { passive: false });
  els.compareOriginal.addEventListener('pointerdown', drag.onComparePointerDown);
  els.compareOriginal.addEventListener('wheel', drag.onCompareWheel, { passive: false });

  paletteDialog.bindPaletteDialog();
  bindShortcuts();
}
