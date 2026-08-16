// 事件绑定聚合入口：各领域绑定拆分到 bind-* 模块；
// 键盘快捷键统一走 shortcuts.js。

import { bindCanvas } from './bind-canvas.js';
import { bindConfigs } from './bind-configs.js';
import { bindSettings } from './bind-settings.js';
import { bindToolbar } from './bind-toolbar.js';
import { bindTools } from './bind-tools.js';
import * as colorList from './color-list.js';
import * as highlight from './highlight.js';
import * as historyUI from './history-ui.js';
import * as palette from './palette.js';
import * as paletteDialog from './palette-dialog.js';
import * as panel from './panel.js';
import * as quickPicker from './quick-picker.js';
import { bindShortcuts } from './shortcuts.js';
import { bindTargetPixels } from './target-pixels.js';

export function bindEvents() {
  panel.bindPanelToggles();
  palette.bindColorTable();
  colorList.bindColorList();
  highlight.bindHighlightList();
  historyUI.bindHistoryList();
  quickPicker.bindQuickPicker();
  bindTargetPixels();

  bindToolbar();
  bindSettings();
  bindConfigs();
  bindTools();
  bindCanvas();

  paletteDialog.bindPaletteDialog();
  bindShortcuts();
}
