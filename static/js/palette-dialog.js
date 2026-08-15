// 色板配置弹窗：由工具栏「色板配置」按钮打开，内容与原先侧边栏的色板配置一致。

import { els } from './els.js';
import { hideDialog, showDialog } from './focus.js';

export function openPaletteDialog() {
  showDialog(els.paletteDialog);
  els.configSelect.focus();
}

export function closePaletteDialog() {
  hideDialog(els.paletteDialog);
}

export function bindPaletteDialog() {
  els.btnConfig.addEventListener('click', openPaletteDialog);
  els.paletteDialogClose.addEventListener('click', closePaletteDialog);
  els.paletteDialog.addEventListener('click', (e) => {
    if (e.target === els.paletteDialog) closePaletteDialog();
  });
}
