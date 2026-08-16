// 渲染层聚合出口：底图 / 覆盖层 / hover 与共用几何从拆分模块统一导出，
// 保持既有调用方（canvas / crop / export-dialog / workspace）的导入不变。

export {
  adaptiveStrokeWidth,
  canvasMetrics,
  drawCodes,
  drawGridLines,
  drawPatternBase,
  drawPatternCells,
  findConnectedComponents,
} from './render-base.js';
export {
  clearCanvas,
  drawPattern,
  drawPatternOverlay,
  strokeCropEdges,
  strokeCropPreview,
} from './render-overlay.js';
