// DOM 元素引用：与 templates/index.html 中的 id 一一对应。
// 所有模块统一从这里取元素，避免散落的 document.getElementById。

/**
 * 统一 DOM 查询入口（仅 els.js 内部使用）：默认返回 HTMLElement，
 * 具体元素类型由各键上的类型注解约束（泛型 T 由上下文推断），避免 any 逃生口。
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} id
 * @returns {T}
 */
export const $ = (id) => /** @type {T} */ (document.getElementById(id));

export const els = {
  toast: $('toast'),
  /** @type {HTMLButtonElement} */
  btnOpenProject: $('btn-open-project'),
  /** @type {HTMLButtonElement} */
  btnSaveProject: $('btn-save-project'),
  /** @type {HTMLInputElement} */
  projectFileInput: $('project-file-input'),
  /** @type {HTMLInputElement} */
  fileInput: $('file-input'),
  /** @type {HTMLButtonElement} */
  btnImport: $('btn-import'),
  /** @type {HTMLInputElement} */
  targetPixels: $('target-pixels'),
  /** @type {HTMLButtonElement} */
  targetPixelsBtn: $('target-pixels-btn'),
  targetPixelsMenu: $('target-pixels-menu'),
  /** @type {HTMLButtonElement} */
  btnRecompress: $('btn-recompress'),
  /** @type {HTMLButtonElement} */
  btnConfig: $('btn-config'),
  /** @type {HTMLInputElement} */
  chkSharpen: $('chk-sharpen'),
  /** @type {HTMLInputElement} */
  chkCodes: $('chk-codes'),
  /** @type {HTMLSelectElement} */
  selDistance: $('sel-distance'),
  /** @type {HTMLButtonElement} */
  btnExport: $('btn-export'),
  /** @type {HTMLButtonElement} */
  btnTheme: $('btn-theme'),
  projectNameLabel: $('project-name-label'),
  /** @type {HTMLButtonElement} */
  btnSaveStateSide: $('btn-save-state-side'),
  /** @type {HTMLButtonElement} */
  btnClearAll: $('btn-clear-all'),
  /** @type {HTMLButtonElement} */
  btnLogout: $('btn-logout'),
  autosave: $('autosave-indicator'),
  /** @type {HTMLInputElement} */
  colorSlider: $('color-slider'),
  sliderValue: $('slider-value'),
  /** @type {HTMLSelectElement} */
  emptyStyle: $('empty-style'),
  usedColors: $('used-colors'),
  /** @type {HTMLSelectElement} */
  configSelect: $('config-select'),
  /** @type {HTMLButtonElement} */
  btnNewConfig: $('btn-new-config'),
  /** @type {HTMLButtonElement} */
  btnImportConfig: $('btn-import-config'),
  /** @type {HTMLButtonElement} */
  btnExportConfig: $('btn-export-config'),
  /** @type {HTMLButtonElement} */
  btnRenameConfig: $('btn-rename-config'),
  /** @type {HTMLButtonElement} */
  btnDeleteConfig: $('btn-delete-config'),
  /** @type {HTMLInputElement} */
  configFileInput: $('config-file-input'),
  colorTable: $('color-table'),
  /** @type {HTMLButtonElement} */
  btnAddColor: $('btn-add-color'),
  tabEdit: $('tab-edit'),
  leftPanel: $('left-panel'),
  leftPanelHead: $('left-panel-head'),
  leftPanelBody: $('left-panel-body'),
  leftPanelExpand: $('left-panel-expand'),
  colorHighlightPanel: $('color-highlight-panel'),
  colorHighlightPanelHead: $('color-highlight-panel-head'),
  colorHighlightPanelBody: $('color-highlight-panel-body'),
  colorHighlightPanelExpand: $('color-highlight-panel-expand'),
  rightPanel: $('right-panel'),
  rightPanelHead: $('right-panel-head'),
  rightPanelBody: $('right-panel-body'),
  rightPanelExpand: $('right-panel-expand'),
  /** @type {HTMLButtonElement} */
  toolBrush: $('tool-brush'),
  /** @type {HTMLButtonElement} */
  toolPicker: $('tool-picker'),
  /** @type {HTMLButtonElement} */
  toolEraser: $('tool-eraser'),
  /** @type {HTMLButtonElement} */
  toolCrop: $('tool-crop'),
  /** @type {HTMLButtonElement} */
  toolWand: $('tool-wand'),
  modeLabel: $('mode-label'),
  selectionControls: $('selection-controls'),
  /** @type {HTMLInputElement} */
  sameColorChk: $('same-color-select'),
  /** @type {HTMLButtonElement} */
  selectHighlightBtn: $('select-highlight'),
  cropControls: $('crop-controls'),
  /** @type {HTMLButtonElement} */
  btnAutoCrop: $('btn-auto-crop'),
  /** @type {HTMLButtonElement} */
  btnApplyCrop: $('btn-apply-crop'),
  /** @type {HTMLInputElement} */
  brushSize: $('brush-size'),
  brushSizeValue: $('brush-size-value'),
  brushSizeWrap: $('brush-size-wrap'),
  /** @type {HTMLInputElement} */
  wandSensitivity: $('wand-sensitivity'),
  wandSensitivityValue: $('wand-sensitivity-value'),
  wandSensitivityWrap: $('wand-sensitivity-wrap'),
  brushSwatch: $('brush-swatch'),
  brushLabel: $('brush-label'),
  colorList: $('color-list'),
  /** @type {HTMLCanvasElement} */
  canvas: $('canvas'),
  canvasScroll: $('canvas-scroll'),
  cropMagnifier: $('crop-magnifier'),
  /** @type {HTMLCanvasElement} */
  cropMagnifierCanvas: $('crop-magnifier-canvas'),
  /** @type {HTMLCanvasElement} */
  canvasOriginal: $('canvas-original'),
  compareOriginal: $('compare-original'),
  beadPane: $('bead-pane'),
  emptyHint: $('empty-hint'),
  /** @type {HTMLButtonElement} */
  zoomIn: $('zoom-in'),
  /** @type {HTMLButtonElement} */
  zoomOut: $('zoom-out'),
  /** @type {HTMLButtonElement} */
  zoomFit: $('zoom-fit'),
  zoomLabel: $('zoom-label'),
  /** @type {HTMLInputElement} */
  chkCompare: $('chk-compare'),
  /** @type {HTMLInputElement} */
  chkSyncPan: $('chk-sync-pan'),
  cellInfo: $('cell-info'),
  quickPicker: $('quick-picker'),
  highlightColorList: $('highlight-color-list'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
  /** @type {HTMLButtonElement} */
  btnUndo: $('btn-undo'),
  /** @type {HTMLButtonElement} */
  btnRedo: $('btn-redo'),
  undoInfo: $('undo-info'),
  /** @type {HTMLButtonElement} */
  btnFixMenu: $('btn-fix-menu'),
  fixMenu: $('fix-menu'),
  /** @type {HTMLButtonElement} */
  fixItemGesture: $('fix-item-gesture'),
  /** @type {HTMLButtonElement} */
  fixItemShortcuts: $('fix-item-shortcuts'),
  docDialog: $('doc-dialog'),
  docContent: $('doc-content'),
  /** @type {HTMLButtonElement} */
  docClose: $('doc-close'),
  exportDialog: $('export-dialog'),
  paletteDialog: $('palette-dialog'),
  /** @type {HTMLButtonElement} */
  paletteDialogClose: $('palette-dialog-close'),
  /** @type {HTMLInputElement} */
  dlgCell: $('dlg-cell-size'),
  /** @type {HTMLInputElement} */
  dlgGrid: $('dlg-grid-lines'),
  /** @type {HTMLInputElement} */
  dlgPad: $('dlg-pad'),
  /** @type {HTMLInputElement} */
  dlgEdgeNumbers: $('dlg-edge-numbers'),
  /** @type {HTMLInputElement} */
  dlgCodes: $('dlg-codes'),
  /** @type {HTMLInputElement} */
  dlgLegend: $('dlg-legend'),
  /** @type {HTMLSelectElement} */
  dlgEmptyStyle: $('dlg-empty-style'),
  /** @type {HTMLSelectElement} */
  dlgFormat: $('dlg-format'),
  /** @type {HTMLButtonElement} */
  dlgOk: $('dlg-export-ok'),
  /** @type {HTMLButtonElement} */
  dlgCancel: $('dlg-export-cancel'),
  /** @type {HTMLCanvasElement} */
  dlgPreview: $('dlg-preview'),
  dlgPdfPages: $('dlg-pdf-pages'),
  dlgPreviewMask: $('dlg-preview-mask'),
  dlgBusy: $('dlg-busy'),
  dlgStatus: $('dlg-status'),
  dirtyIndicator: $('dirty-indicator'),
  loginMask: $('login-mask'),
  /** @type {HTMLInputElement} */
  loginToken: $('login-token'),
  /** @type {HTMLButtonElement} */
  btnLogin: $('btn-login'),
  loginError: $('login-error'),
  popupDialog: $('popup-dialog'),
  popupTitle: $('popup-title'),
  popupMessage: $('popup-message'),
  popupInput: $('popup-input'),
  popupError: $('popup-error'),
  popupOk: $('popup-ok'),
  popupCancel: $('popup-cancel'),
};

// 启动时校验关键 DOM 元素，缺 id 时立即报错，避免运行到一半才崩溃
export function assertElements() {
  const missing = Object.entries(els)
    .filter(([, el]) => !el)
    .map(([k]) => k);
  if (missing.length) throw new Error(`缺少页面元素：${missing.join(', ')}`);
}
