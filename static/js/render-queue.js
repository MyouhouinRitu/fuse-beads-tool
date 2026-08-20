// 渲染入口收敛：全量刷新与仅画布重绘两个调度入口。
// 具体渲染实现由 main.js 注册（组合根），各模块只依赖这里的队列，
// 避免功能模块与主入口互相引用造成循环依赖。

/** @type {(() => void) | null} */
let fullRenderer = null;
/** @type {(() => void) | null} */
let canvasRenderer = null;
let renderQueued = false;
let canvasRenderQueued = false;

/** @param {() => void} full @param {() => void} canvas */
export function setRenderers(full, canvas) {
  fullRenderer = full;
  canvasRenderer = canvas;
}

// 立即执行一次全量刷新（面板 + 画布）
export function renderFullNow() {
  if (fullRenderer) fullRenderer();
}

// 调度一次全量刷新（rAF 合并）
export function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (fullRenderer) fullRenderer();
  });
}

// 调度一次仅画布重绘（overlay），全量刷新已排队时跳过
export function scheduleCanvasRender() {
  if (canvasRenderQueued || renderQueued) return;
  canvasRenderQueued = true;
  requestAnimationFrame(() => {
    canvasRenderQueued = false;
    if (renderQueued) return; // 全量刷新即将执行，由 renderFull 统一覆盖
    if (canvasRenderer) canvasRenderer();
  });
}
