// 跨模块共享的瞬态交互状态：不持久化、不参与自动保存 / 项目文档。
// App 只保留可持久化领域状态与计时器句柄，画布拖拽之外的瞬态字段统一放这里，
// 拖拽过程本身的中间标记仍由 state.js 的 dragState 负责。

/** @type {FuseInteractionState} */
export const interactionState = {
  painting: false, // 画笔 / 橡皮是否正在连续涂色
  lastCell: null, // 画笔 / 橡皮上一次涂到的格子
  hoverCell: null, // 鼠标当前指向的像素格（用于 hover 边框）
  dragPreview: null, // 矩形拖选中的实时预览范围 {x0,y0,x1,y1}
  strokeBuffer: null, // 一次画笔/橡皮按下到放开过程中累积的像素修改
  highlightColor: null, // 颜色清单当前高亮的色号
  highlightBlink: true, // 高亮闪烁相位
  pickerCandidates: null, // 九宫格候选色
  pickerCell: null, // 九宫格改色的目标格 {x,y,p,original}
  pickerPreviewIndex: null, // 九宫格当前悬停预览的候选序号（null 表示未预览）
  crop: null, // 裁剪矩形 {x0,y0,x1,y1}（含端点）
  cropActiveEdge: null, // 当前选中的边：left/right/top/bottom（拖拽中的活动边在 dragState.cropEdge）
  cropPreview: null, // 裁剪预览虚线 {horizontal, pos}
};
