// 应用全局状态：唯一的 App 单例与拖拽状态。
// 状态归属约定：
// - 可持久化的偏好统一放在 App.settings（唯一数据源）；
// - App 统一持有领域状态与 UI 计时器句柄（toast/自动保存/配置保存/高亮闪烁），便于测试检查；
// - 各模块私有瞬态（拖拽标记、渲染缓存、节流时间戳）留在所属模块，不塞进 App。

import { CELL, DEFAULT_TARGET_PIXELS, TOOLS } from './constants.js';
import { els } from './els.js';
import { createEmptyHistory } from './history.js';

export const App = {
  configs: [],
  configName: null,
  palette: [],          // 色板配置（可编辑，重新压缩时才应用到画布）
  appliedPalette: [],   // 已应用色板：当前画布与编辑工具显示所用，重新压缩/导入时更新
  project: null,       // { width, height, grid: Int16Array }
  compressed: null,    // { rgba, width, height }
  originalFile: null,
  originalImage: null, // 用于「对比原图」的原图 HTMLImageElement
  originalUrl: null,   // 原图 object URL
  origPan: { x: 0, y: 0 },
  origZoom: 1,
  maxColors: 2,
  baseGrid: null,
  sliderN: null,
  editedSinceSlider: false,
  brushColor: null,    // 未选择颜色
  tool: TOOLS.SELECT,  // select / brush / eraser / picker / crop
  crop: null,          // 裁剪矩形 {x0,y0,x1,y1}（含端点）
  cropActiveEdge: null, // 当前选中/拖拽的边：left/right/top/bottom
  cropPreview: null,   // 裁剪预览虚线 {horizontal, pos}
  selection: new Set(), // 当前选中的像素格索引集合（p = y*width + x）
  dragPreview: null,     // 矩形拖选中的实时预览范围 {x0,y0,x1,y1}
  hoverCell: null,     // 鼠标当前指向的像素格（用于 hover 边框）
  painting: false,
  lastCell: null,
  pan: { x: 0, y: 0 },
  history: createEmptyHistory(),
  undoStack: [],
  redoStack: [],
  strokeBuffer: null,  // 一次画笔/橡皮按下到放开过程中累积的像素修改
  settings: {
    targetPixels: DEFAULT_TARGET_PIXELS,
    useLab: true,
    sharpen: true,
    showCodes: true,
    emptyStyle: 'default',
    compare: false,
    syncPan: false,
    brushSize: 1,
    sameColorSelect: false,
  },
  dirty: false,
  zoom: 1,
  screenCell: CELL,
  highlightBlink: true,
  highlightTimer: null,
  toastTimer: null,
  pickerCandidates: null,
  pickerCell: null,      // 九宫格改色的目标格 {x,y,p,original}
  pickerPreviewIndex: null, // 九宫格当前悬停预览的候选序号（null 表示未预览）
  highlightColor: null,
  saveTimer: null,
  configTimer: null,
};

// 画布拖拽交互的共享状态
export const dragState = {
  active: false,
  cropEdge: null,      // 裁剪模式当前拖拽的边
  orig: false,
  moved: false,
  panning: false,
  startX: 0,
  startY: 0,
  panStart: null,
  origPanStart: null,
  downCell: null,
  selectionAnchor: null, // 选择模式矩形拖选的起点格
  shift: false,          // 本次拖拽/单击是否按住 Shift（追加并集）
};

export function setDirty(d) {
  App.dirty = d;
  els.dirtyIndicator.classList.toggle('hidden', !d);
}

// 是否存在事务历史或单步撤销/重做记录
export function hasPendingRecords() {
  return App.history.items.length > 0 || App.undoStack.length > 0 || App.redoStack.length > 0;
}

// 清空全部事务历史与单步撤销/重做记录（导入/重压缩/滑块等重新生成图案时使用）
export function clearHistoryRecords() {
  App.history = createEmptyHistory();
  App.undoStack = [];
  App.redoStack = [];
  App.strokeBuffer = null;
}
