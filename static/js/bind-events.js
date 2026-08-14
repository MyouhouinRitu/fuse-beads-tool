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
  TARGET_PIXEL_PRESETS,
  TOOLS,
  WAND_SENSITIVITY_DEFAULT,
  WAND_SENSITIVITY_MAX,
  WAND_SENSITIVITY_MIN,
  ZOOM_BUTTON_FACTOR,
} from './constants.js';
import * as crop from './crop.js';
import * as drag from './drag.js';
import { els } from './els.js';
import * as exportDialog from './export-dialog.js';
import * as highlight from './highlight.js';
import * as historyUI from './history-ui.js';
import { interactionState } from './interaction.js';
import * as markdown from './markdown.js';
import * as palette from './palette.js';
import * as panel from './panel.js';
import { openProjectViaDialog, saveProjectFile } from './project-file.js';
import * as quickPicker from './quick-picker.js';
import { scheduleCanvasRender } from './render-queue.js';
import { applyProjectDocument } from './restore.js';
import { bindShortcuts } from './shortcuts.js';
import { applySlider } from './slider.js';
import { App, setProjectDirty } from './state.js';
import * as theme from './theme.js';
import * as toolState from './tool-state.js';
import * as undoRedo from './undo-redo.js';
import * as upload from './upload.js';
import { clampInt, downloadUrl, getTargetPixels, hintDistanceDeferred, toast } from './utils.js';
import * as view from './view.js';

function renderTargetPixelOptions() {
  const menu = els.targetPixelsMenu;
  menu.innerHTML = '';
  TARGET_PIXEL_PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item';
    btn.dataset.value = String(p.value);
    btn.title = p.tip;
    btn.textContent = String(p.value);
    btn.addEventListener('click', () => {
      els.targetPixels.value = String(p.value);
      els.targetPixelsMenu.classList.add('hidden');
      setProjectDirty(true);
    });
    menu.appendChild(btn);
  });
}

export function bindEvents() {
  panel.bindPanelToggles();
  palette.bindColorTable();
  colorList.bindColorList();
  highlight.bindHighlightList();
  historyUI.bindHistoryList();
  quickPicker.bindQuickPicker();
  renderTargetPixelOptions();
  // 箭头展开预设（输入框本身只编辑，光标为文本竖线）
  els.targetPixelsBtn.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    // 控件包在 <label> 内：不 preventDefault 时浏览器会把点击转发给输入框，
    // 再冒泡到 document 的「点击关闭菜单」处理器，导致菜单刚展开就被收起
    if (e.preventDefault) e.preventDefault();
    els.targetPixelsMenu.classList.toggle('hidden');
  });

  els.btnLogin.addEventListener('click', auth.tryLogin);
  els.loginToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') auth.tryLogin();
  });
  els.btnLogout.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch (_e) {
      /* ignore */
    }
    location.reload();
  });

  els.btnOpenProject.addEventListener('click', openProjectViaDialog);
  els.projectFileInput.addEventListener('change', async () => {
    const f = els.projectFileInput.files[0];
    els.projectFileInput.value = '';
    if (!f) return;
    if (App.projectDirty && !confirm('当前项目有未保存的更改，打开新项目将覆盖。是否继续？'))
      return;
    try {
      const res = await api.openProjectUpload(f);
      await applyProjectDocument(res.document);
    } catch (e) {
      toast(`打开项目失败：${e.message}`);
    }
  });
  els.btnSaveProject.addEventListener('click', saveProjectFile);
  els.btnImport.addEventListener('click', () => {
    if (App.projectDirty && !confirm('当前项目有未保存的更改，导入新图片将覆盖。是否继续？'))
      return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', () => {
    const f = els.fileInput.files[0];
    if (f) {
      historyUI.clearAll({ silent: true });
      App.originalFile = f;
      compare.loadOriginalImage(f);
      upload.processUpload();
    }
    els.fileInput.value = '';
  });
  els.btnRecompress.addEventListener('click', upload.recompress);
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
    canvas.redrawCanvas();
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

  els.colorSlider.addEventListener('input', () => {
    applySlider(parseInt(els.colorSlider.value, 10));
  });
  els.emptyStyle.addEventListener('change', () => {
    App.settings.emptyStyle = els.emptyStyle.value;
    canvas.redrawCanvas();
    setProjectDirty(true);
    scheduleAutosave();
  });

  els.btnExport.addEventListener('click', exportDialog.openExportDialog);
  els.dlgCancel.addEventListener('click', exportDialog.closeExportDialog);
  els.dlgOk.addEventListener('click', exportDialog.doExport);
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
  els.btnClearAll.addEventListener('click', () => historyUI.clearAll());
  els.btnUndo.addEventListener('click', undoRedo.doUndo);
  els.btnRedo.addEventListener('click', undoRedo.doRedo);
  els.btnFixMenu.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    els.fixMenu.classList.toggle('hidden');
  });
  els.fixItemGesture.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    markdown.openFixDoc('right-drag-gesture-fix');
  });
  els.fixItemShortcuts.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    markdown.openFixDoc('shortcuts');
  });
  els.docClose.addEventListener('click', markdown.closeFixDoc);
  els.btnTheme.addEventListener('click', theme.toggleTheme);
  document.addEventListener('click', () => {
    els.fixMenu.classList.add('hidden');
    els.targetPixelsMenu.classList.add('hidden');
  });

  els.configSelect.addEventListener('change', () => {
    const name = els.configSelect.value;
    if (name) {
      setProjectDirty(true);
      palette.loadConfigDetail(name);
    }
  });
  els.btnNewConfig.addEventListener('click', async () => {
    const name = prompt('新配置名称：');
    if (!name) return;
    const colors = App.palette.length
      ? App.palette.map((c) => ({ ...c }))
      : [{ index: 1, code: '001', name: '白色', hex: '#FFFFFF' }];
    try {
      await api.createConfig(name, colors);
      await palette.selectAndLoad(name);
      setProjectDirty(true);
      toast(`已创建配置「${name}」`);
    } catch (err) {
      toast(`创建失败：${err.message}`);
    }
  });
  els.btnImportConfig.addEventListener('click', () => els.configFileInput.click());
  els.configFileInput.addEventListener('change', async () => {
    const f = els.configFileInput.files[0];
    els.configFileInput.value = '';
    if (!f) return;
    try {
      const res = await api.importConfig(f);
      await palette.selectAndLoad(res.name);
      setProjectDirty(true);
      toast(`已导入配置「${res.name}」（${res.colors.length}色）`);
    } catch (err) {
      toast(`导入失败：${err.message}`);
    }
  });
  els.btnExportConfig.addEventListener('click', () => {
    if (!App.configName) return;
    downloadUrl(
      `/api/configs/${encodeURIComponent(App.configName)}/export`,
      `${App.configName}.csv`,
    );
  });
  els.btnRenameConfig.addEventListener('click', async () => {
    if (!App.configName) return;
    const newName = prompt('新的配置名称：', App.configName);
    if (!newName || newName === App.configName) return;
    try {
      await api.renameConfig(App.configName, newName);
      await palette.selectAndLoad(newName);
      setProjectDirty(true);
      toast('已重命名');
    } catch (err) {
      toast(`重命名失败：${err.message}`);
    }
  });
  els.btnDeleteConfig.addEventListener('click', async () => {
    if (!App.configName) return;
    if (App.configs.length <= 1) {
      toast('至少保留一个配置');
      return;
    }
    if (!confirm(`确定删除配置「${App.configName}」吗？`)) return;
    try {
      await api.deleteConfig(App.configName);
      const remaining = App.configs.filter((c) => c.name !== App.configName);
      await palette.selectAndLoad(remaining[0] ? remaining[0].name : null);
      setProjectDirty(true);
      toast('已删除配置');
    } catch (err) {
      toast(`删除失败：${err.message}`);
    }
  });
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

  els.canvasScroll.addEventListener('mousedown', drag.onCanvasScrollMouseDown);
  window.addEventListener('mousemove', drag.onWindowMouseMove);
  window.addEventListener('mouseup', drag.onWindowMouseUp);
  els.canvasScroll.addEventListener('mouseleave', drag.onCanvasScrollMouseLeave);
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
  els.compareOriginal.addEventListener('mousedown', drag.onCompareMouseDown);
  els.compareOriginal.addEventListener('wheel', drag.onCompareWheel, { passive: false });

  const tabs = document.querySelectorAll('.tabs .tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      els.tabPalette.classList.toggle('hidden', tab !== 'palette');
      els.tabEdit.classList.toggle('hidden', tab !== 'edit');
    });
  });

  bindShortcuts();
}
