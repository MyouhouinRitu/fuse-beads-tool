// DOM 行为测试（dom_editor_test.mjs 分组）：依赖 tests/helpers/dom-harness.mjs 的共享桩。

import assert from 'node:assert/strict';
import {
  App,
  canvasRectForCells,
  drawLog,
  elsMap,
  hooks,
  interactionState,
  mouseAt,
  seedProject,
  windowListeners,
} from './helpers/dom-harness.mjs';

// ---------------- 11. 鼠标指向像素的 hover 边框 ----------------
{
  seedProject();
  App.tool = 'select';
  interactionState.hoverCell = null;
  App.selection.clear();
  interactionState.highlightColor = null;
  hooks.renderAll();
  canvasRectForCells();

  // 选择模式：黑白相间虚线
  const mm = windowListeners.mousemove[0];
  drawLog.strokes = [];
  mm(mouseAt(1, 1));
  assert.deepEqual(interactionState.hoverCell, { x: 1, y: 1 }, '鼠标移动应记录指向的格子');
  const rectStrokes = drawLog.strokes.filter((s) => s.rect && s.dash);
  assert.equal(rectStrokes.length, 2, '选择模式 hover 应绘制两遍虚线边框（黑 + 白）');
  assert.equal(rectStrokes[0].style.toLowerCase(), '#000000', '第一遍应为黑色');
  assert.equal(rectStrokes[1].style.toLowerCase(), '#ffffff', '第二遍应为白色');
  assert.ok(rectStrokes[0].dash && rectStrokes[0].dash[0] > 0, '选择模式应使用虚线');
  assert.ok(rectStrokes[1].dashOffset > 0, '第二遍虚线应错开半个周期');
  assert.ok(
    rectStrokes[0].x >= 56 && rectStrokes[0].y >= 56,
    'hover 边框应位于指向格子的画布坐标（含 1 格行列号条）',
  );

  // 取色模式：3D 凸起效果（高光斜面 / 暗斜面 / 投影），不再使用虚线
  App.tool = 'picker';
  drawLog.strokes = [];
  hooks.renderAll();
  const picker3D = drawLog.strokes.filter(
    (s) =>
      s.style.includes('rgba(255, 255, 255, 0.85)') ||
      s.style.includes('rgba(0, 0, 0, 0.45)') ||
      s.style.includes('rgba(0, 0, 0, 0.35)'),
  );
  assert.ok(picker3D.length >= 3, '取色模式应绘制 3D 凸起（高光斜面 / 暗斜面 / 投影）');
  assert.equal(
    drawLog.strokes.filter((s) => s.rect && s.style.startsWith('rgba(')).length,
    0,
    '取色模式不应再绘制虚线边框',
  );

  // 画笔模式：每格颜色边框 + 外圈黑色细实线 + 右下阴影
  App.tool = 'brush';
  App.brushColor = 0; // 白色
  drawLog.strokes = [];
  hooks.renderAll();
  const brushRects = drawLog.strokes.filter(
    (s) =>
      s.rect &&
      (s.style.toLowerCase() === 'rgb(255, 255, 255)' || s.style.toLowerCase() === '#000000'),
  );
  assert.equal(brushRects.length, 2, '尺寸 1 画笔应绘制每格颜色边框 + 外圈黑色细实线');
  assert.ok(
    brushRects.some((s) => s.style.toLowerCase() === 'rgb(255, 255, 255)'),
    '每格边框应为画笔颜色',
  );
  assert.ok(
    brushRects.some((s) => s.style.toLowerCase() === '#000000'),
    '外圈应为黑色细实线',
  );
  assert.ok(
    drawLog.strokes.some((s) => s.style.includes('rgba(0, 0, 0, 0.35)')),
    '画笔模式应有右下阴影',
  );

  // 橡皮模式：非空位画边框 + X，空位不画
  App.tool = 'eraser';
  interactionState.hoverCell = null;
  drawLog.strokes = [];
  hooks.renderAll();
  const baseCount = drawLog.strokes.length;
  interactionState.hoverCell = { x: 0, y: 0 }; // grid[0] = 白色
  hooks.renderAll();
  const added = drawLog.strokes.length - baseCount;
  assert.ok(added >= 3, `橡皮 hover 应绘制边框 + 两条对角线，实际增加 ${added} 条线`);
  App.project.grid[0] = -1; // 变空位
  interactionState.hoverCell = { x: 0, y: 0 };
  drawLog.strokes = [];
  hooks.renderAll();
  assert.equal(
    drawLog.strokes.filter((s) => s.rect && s.style.startsWith('rgba(')).length,
    0,
    '橡皮指向空位时不应绘制 hover 边框',
  );

  // 鼠标离开画布区应清除 hover
  interactionState.hoverCell = { x: 1, y: 1 };
  const leave = elsMap['canvas-scroll'].listeners.mouseleave[0];
  leave({});
  assert.equal(interactionState.hoverCell, null, '鼠标离开画布区应清除 hover');

  // hover 线宽随缩放等比变化：画布线宽只由格尺寸决定，屏幕粗细交给 CSS 缩放
  App.tool = 'select';
  interactionState.hoverCell = { x: 1, y: 1 };
  App.zoom = 0.5;
  drawLog.strokes = [];
  hooks.renderAll();
  const zoomRects = drawLog.strokes.filter((s) => s.rect && s.dash);
  assert.equal(zoomRects[0].lineWidth, 1, '缩放 0.5 时画布线宽应保持格尺寸比例（1px 细线）');
  App.zoom = 1;
  interactionState.hoverCell = null;
  console.log('[OK] 鼠标 hover 边框：选择 / 画笔 / 取色 / 橡皮');
}

// ---------------- 12. 颜色清单高亮闪烁：重绘不应重置定时器 ----------------
{
  seedProject();
  interactionState.highlightColor = 0;
  interactionState.highlightBlink = true;
  hooks.renderAll();
  const timer1 = App.highlightTimer;
  assert.ok(timer1, '设置高亮后应启动闪烁定时器');
  hooks.renderAll(); // 模拟鼠标移动触发的重绘
  assert.equal(App.highlightTimer, timer1, '重复渲染不应重置闪烁定时器（否则闪烁会暂停）');
  interactionState.highlightColor = null;
  hooks.renderAll();
  assert.equal(App.highlightTimer, null, '取消高亮后应停止闪烁定时器');
  console.log('[OK] 颜色清单高亮闪烁定时器不被重绘重置');
}

// ---------------- 12.5 点击颜色清单：应启动闪烁定时器，再次点击取消 ----------------
{
  seedProject();
  interactionState.highlightColor = null;
  App.highlightTimer = null;
  hooks.renderAll();
  assert.equal(App.highlightTimer, null, '未点击前不应有闪烁定时器');
  const item = elsMap['highlight-color-list'].children[0];
  item.emit('click');
  assert.equal(
    interactionState.highlightColor,
    Number(item.dataset.index),
    '点击颜色清单应选中该色号',
  );
  assert.ok(App.highlightTimer, '点击颜色清单应启动闪烁定时器');
  item.emit('click');
  assert.equal(interactionState.highlightColor, null, '再次点击应取消高亮');
  assert.equal(App.highlightTimer, null, '取消高亮后应停止闪烁定时器');
  console.log('[OK] 点击颜色清单：启动/停止闪烁定时器');
}

// ---------------- 12.6 高亮闪烁不随减少动效偏好关闭 ----------------
{
  seedProject();
  App.tool = 'select';
  interactionState.highlightColor = null;
  interactionState.highlightBlink = true;
  App.highlightTimer = null;
  const realMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    interactionState.highlightColor = 0;
    hooks.renderAll();
    assert.ok(App.highlightTimer != null, '即使系统开启减少动效，高亮闪烁定时器也应启动');
  } finally {
    globalThis.matchMedia = realMatchMedia;
    interactionState.highlightColor = null;
    hooks.renderAll();
  }
  console.log('[OK] 高亮闪烁不随减少动效偏好关闭');
}

// ---------------- 13. 色号高亮连通块：相连像素描边合并为一个整块 ----------------
{
  seedProject();
  // 3x3 全同色 → 一个连通块：外轮廓 12 条边，块内不再逐格描边
  App.project = { width: 3, height: 3, grid: Int16Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]) };
  App.baseGrid = App.project.grid.slice();
  interactionState.highlightColor = 0;
  interactionState.highlightBlink = true;
  drawLog.strokes = [];
  hooks.renderAll();
  const frameStyle = 'rgba(0, 0, 0, 0.9)'; // 白色格（亮色）用深色描边
  const blockEdges = drawLog.strokes.filter((s) => s.style.includes(frameStyle));
  assert.equal(blockEdges.length, 12, '3x3 整块外轮廓应为 12 条边');
  assert.ok(
    blockEdges.every((s) => !s.rect),
    '高亮外轮廓应为线条绘制而非逐格描边',
  );

  // 孤立单格 → 只有 4 条边
  App.project = { width: 3, height: 3, grid: Int16Array.from([0, -1, -1, -1, -1, -1, -1, -1, -1]) };
  App.baseGrid = App.project.grid.slice();
  drawLog.strokes = [];
  hooks.renderAll();
  const singleEdges = drawLog.strokes.filter((s) => s.style.includes(frameStyle));
  assert.equal(singleEdges.length, 4, '孤立单格应只有 4 条边');

  // 两个水平相邻格 + 一个对角孤立格 → 2 个连通块：水平块 6 条边 + 对角块 4 条边
  App.project = { width: 3, height: 2, grid: Int16Array.from([0, 0, -1, -1, -1, 0]) };
  App.baseGrid = App.project.grid.slice();
  drawLog.strokes = [];
  hooks.renderAll();
  const mixedEdges = drawLog.strokes.filter((s) => s.style.includes(frameStyle));
  assert.equal(mixedEdges.length, 10, '水平相邻块（6 边）+ 对角孤立格（4 边）应共 10 条边');

  interactionState.highlightColor = null;
  hooks.renderAll();
  console.log('[OK] 色号高亮连通块：外轮廓合并、内部不描边');
}

// ---------------- 14. 画笔 / 橡皮尺寸：拖动条显示与矩形涂色 ----------------
{
  seedProject();
  App.settings.brushSize = 1;
  App.selection.clear();
  interactionState.highlightColor = null;

  // 拖动条仅在画笔 / 橡皮模式显示
  hooks.setTool('brush');
  assert.ok(!elsMap['brush-size-wrap'].classList.contains('hidden'), '画笔模式应显示尺寸拖动条');
  hooks.setTool('select');
  assert.ok(elsMap['brush-size-wrap'].classList.contains('hidden'), '选择模式应隐藏尺寸拖动条');
  hooks.setTool('eraser');
  assert.ok(!elsMap['brush-size-wrap'].classList.contains('hidden'), '橡皮模式应显示尺寸拖动条');

  // 拖动条输入 → 更新画笔尺寸并持久化
  elsMap['brush-size'].value = '4';
  elsMap['brush-size'].emit('input');
  assert.equal(App.settings.brushSize, 4, '拖动条输入应更新画笔尺寸');
  assert.equal(App.settings.brushSize, 4, '画笔尺寸应同步到设置以便持久化');
  assert.equal(elsMap['brush-size-value'].textContent, '4', '拖动条数值标签应同步');

  // 尺寸 3（边长 5）：在 6x6 图案中心 (2,2) 涂满 5x5
  App.project = { width: 6, height: 6, grid: Int16Array.from(Array(36).fill(0)) };
  App.baseGrid = App.project.grid.slice();
  App.tool = 'brush';
  App.brushColor = 2;
  App.settings.brushSize = 3;
  interactionState.strokeBuffer = [];
  hooks.paintStamp({ x: 2, y: 2 });
  assert.equal(
    Array.from(App.project.grid).filter((v) => v === 2).length,
    25,
    '尺寸 3 在 (2,2) 应涂满 5x5（25 格）',
  );
  assert.equal(interactionState.strokeBuffer.length, 25, '一次盖章应记录 25 个像素修改');
  interactionState.strokeBuffer = null;

  // 边缘裁剪：角落 (0,0) 盖章 → 只涂 3x3（用调色板内合法色号 1）
  App.brushColor = 1;
  interactionState.strokeBuffer = [];
  hooks.paintStamp({ x: 0, y: 0 });
  assert.equal(
    Array.from(App.project.grid).filter((v) => v === 1).length,
    9,
    '角落盖章应裁剪为 3x3（9 格）',
  );
  interactionState.strokeBuffer = null;

  // 橡皮尺寸：以 (3,3) 为中心擦除 5x5
  App.tool = 'eraser';
  interactionState.strokeBuffer = [];
  hooks.paintStamp({ x: 3, y: 3 });
  const erased = Array.from(App.project.grid).filter((v) => v === -1).length;
  assert.equal(erased, 25, '橡皮尺寸 3 在 (3,3) 应擦除 5x5（25 格）');
  interactionState.strokeBuffer = null;

  // 橡皮 hover：尺寸 3 在角落 (0,0) 时，边框与 X 仍按完整 5×5 绘制（不因裁剪形变）
  App.tool = 'eraser';
  interactionState.hoverCell = { x: 0, y: 0 };
  App.settings.brushSize = 3;
  drawLog.strokes = [];
  hooks.renderAll();
  const eraserFrame = drawLog.strokes.filter((s) => s.rect && s.style.startsWith('rgba('));
  assert.equal(eraserFrame.length, 1, '橡皮 hover 应绘制一条边框');
  assert.equal(eraserFrame[0].w, 139, '橡皮 hover 边框宽度应保持完整 5×5（139px），不因角落形变');
  assert.equal(eraserFrame[0].h, 139, '橡皮 hover 边框高度应保持完整 5×5');
  interactionState.hoverCell = null;

  // 画笔 hover 尺寸 3：5×5 共 25 个格子的颜色边框 + 1 条黑色外框（黑色最后绘制，压在最上）
  App.tool = 'brush';
  App.brushColor = 0; // 白色
  interactionState.hoverCell = { x: 2, y: 2 };
  App.settings.brushSize = 3;
  drawLog.strokes = [];
  hooks.renderAll();
  const brushLattice = drawLog.strokes.filter((s) => s.rect);
  const colorRects = brushLattice.filter((s) => s.style.toLowerCase() === 'rgb(255, 255, 255)');
  const blackRects = brushLattice.filter((s) => s.style.toLowerCase() === '#000000');
  assert.equal(colorRects.length, 25, '尺寸 3 应绘制 25 个格子的颜色边框');
  assert.equal(blackRects.length, 1, '应绘制 1 条黑色外框');
  assert.equal(
    brushLattice[brushLattice.length - 1].style.toLowerCase(),
    '#000000',
    '黑色外框应最后绘制',
  );
  interactionState.hoverCell = null;
  App.settings.brushSize = 1;
  hooks.setTool('select');
  console.log('[OK] 画笔 / 橡皮尺寸：拖动条显示与矩形涂色');
}

// ---------------- 14.5 画笔 / 橡皮 Shift 直线 ----------------
{
  seedProject();
  App.project = { width: 3, height: 3, grid: Int16Array.from(Array(9).fill(0)) };
  App.baseGrid = App.project.grid.slice();
  App.tool = 'brush';
  App.brushColor = 2;
  App.settings.brushSize = 1;
  App.selection.clear();
  interactionState.strokeBuffer = null;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mm = windowListeners.mousemove[0];
  const mu = windowListeners.mouseup[0];

  md({ ...mouseAt(0, 0), shiftKey: true });
  mm({ ...mouseAt(0, 2), shiftKey: true });
  mm({ ...mouseAt(2, 2), shiftKey: true });
  mu({});
  assert.equal(App.project.grid[3], 2, 'Shift 直线应约束为横平竖直，先画水平线到 (1,0)');
  assert.notEqual(App.project.grid[4], 2, 'Shift 直线不应画对角中间格 (1,1)');
  assert.notEqual(App.project.grid[5], 2, 'Shift 直线不应沿鼠标经过的横向路径画出 (1,2)');
  console.log('[OK] 画笔 / 橡皮 Shift 直线');
}

// ---------------- 14.6 选择模式 Ctrl 反选当前格 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection.clear();
  App.settings.sameColorSelect = false;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mu = windowListeners.mouseup[0];

  md(mouseAt(0, 0));
  mu({});
  assert.ok(App.selection.has(0), '普通单击应选中 (0,0)');

  md({ ...mouseAt(0, 0), ctrlKey: true });
  mu({});
  assert.ok(!App.selection.has(0), 'Ctrl 单击已选中格应取消选中');

  md({ ...mouseAt(0, 0), metaKey: true });
  mu({});
  assert.ok(App.selection.has(0), 'Cmd/Ctrl 单击未选中格应重新选中');
  console.log('[OK] 选择模式 Ctrl 反选当前格');
}

// ---------------- 14.7 选择模式 Ctrl 拖拽：批量反选经过的格子 ----------------
{
  seedProject();
  App.project = { width: 3, height: 3, grid: Int16Array.from(Array(9).fill(0)) };
  App.baseGrid = App.project.grid.slice();
  App.tool = 'select';
  App.selection.clear();
  App.settings.sameColorSelect = false;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mm = windowListeners.mousemove[0];
  const mu = windowListeners.mouseup[0];

  md({ ...mouseAt(0, 0), ctrlKey: true });
  mm({ ...mouseAt(2, 0), ctrlKey: true });
  mm({ ...mouseAt(2, 2), ctrlKey: true });
  mu({});
  assert.deepEqual(
    [...App.selection].sort((a, b) => a - b),
    [0, 1, 2, 5, 8],
    'Ctrl 拖拽应反选鼠标经过的格子，拐点只经过一次应保持选中',
  );
  console.log('[OK] 选择模式 Ctrl 拖拽批量反选');
}

// ---------------- 14.8 选择模式 Ctrl 连续拖拽：每格只反选一次 ----------------
{
  seedProject();
  App.project = { width: 5, height: 1, grid: Int16Array.from(Array(5).fill(0)) };
  App.baseGrid = App.project.grid.slice();
  App.tool = 'select';
  App.selection.clear();
  App.settings.sameColorSelect = false;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mm = windowListeners.mousemove[0];
  const mu = windowListeners.mouseup[0];

  md({ ...mouseAt(0, 0), ctrlKey: true });
  for (let x = 1; x <= 4; x++) mm({ ...mouseAt(x, 0), ctrlKey: true });
  mu({});
  assert.deepEqual(
    [...App.selection].sort((a, b) => a - b),
    [0, 1, 2, 3, 4],
    'Ctrl 连续拖拽逐格经过时，每个格子应恰好反选一次',
  );
  console.log('[OK] 选择模式 Ctrl 连续拖拽逐格反选');
}

// ---------------- 14.9 选择模式 Ctrl 往返拖拽：重新经过的格子再次反选 ----------------
{
  seedProject();
  App.project = { width: 3, height: 1, grid: Int16Array.from(Array(3).fill(0)) };
  App.baseGrid = App.project.grid.slice();
  App.tool = 'select';
  App.selection.clear();
  App.settings.sameColorSelect = false;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mm = windowListeners.mousemove[0];
  const mu = windowListeners.mouseup[0];

  md({ ...mouseAt(0, 0), ctrlKey: true });
  mm({ ...mouseAt(2, 0), ctrlKey: true });
  mm({ ...mouseAt(0, 0), ctrlKey: true });
  mu({});
  assert.deepEqual(
    [...App.selection].sort((a, b) => a - b),
    [2],
    'Ctrl 往返拖拽时重新经过的格子应再次反选',
  );
  console.log('[OK] 选择模式 Ctrl 往返拖拽重新反选');
}

// ---------------- 15. 选择模式：单击 / 矩形 / 同色 / Shift / 填充 / 取色 / 九宫格 / 高亮转选区 ----------------
{
  seedProject();
  App.selection.clear();
  interactionState.highlightColor = null;
  App.settings.sameColorSelect = false;
  App.settings.brushSize = 1;
  hooks.setTool('brush');
  assert.ok(
    elsMap['selection-controls'].classList.contains('hidden'),
    '画笔模式应隐藏同色选区与选中高亮',
  );
  hooks.setTool('select');
  assert.ok(!elsMap['selection-controls'].classList.contains('hidden'), '选择模式应显示选择控件');
  assert.ok(elsMap['brush-size-wrap'].classList.contains('hidden'), '选择模式应隐藏尺寸拖动条');
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mm = windowListeners.mousemove[0];
  const mu = windowListeners.mouseup[0];
  const kd = windowListeners.keydown[0];

  // 单击选择单格
  md(mouseAt(1, 1));
  mu({});
  assert.equal(App.selection.size, 1, '单击应选中一个格子');
  assert.ok(App.selection.has(3), '应选中 (1,1)（索引 3）');

  // Shift 单击追加并集
  md({ ...mouseAt(0, 0), shiftKey: true });
  mu({});
  assert.equal(App.selection.size, 2, 'Shift 单击应追加并集');

  // 非 Shift 单击替换
  md(mouseAt(1, 0));
  mu({});
  assert.equal(App.selection.size, 1, '非 Shift 单击应替换选择');

  // 矩形拖选（同色选区关闭）：非 Shift 时选区开始即清空旧选区
  App.selection.clear();
  App.selection.add(3); // 预置旧选区
  md(mouseAt(0, 0));
  assert.equal(App.selection.size, 0, '非 Shift 选区开始时应立即清空旧选区');
  mm({ ...mouseAt(1, 1) });
  mu({});
  assert.equal(App.selection.size, 4, '拖拽应选中 2x2 矩形');
  assert.equal(interactionState.dragPreview, null, '拖拽结束后应清除实时预览');

  // 同色选区：单击选四方向连通块（网格 [0,1,0,1]：白色 (0,0)(0,1) 相连、红色 (1,0)(1,1) 相连）
  App.settings.sameColorSelect = true;
  App.selection.clear();
  md(mouseAt(0, 0));
  mu({});
  assert.equal(App.selection.size, 2, '同色选区应选中相连的 2 个白色格子');
  assert.ok(App.selection.has(0) && App.selection.has(2), '应选中 (0,0) 与 (0,1)');
  md({ ...mouseAt(1, 0), shiftKey: true });
  mu({});
  assert.equal(App.selection.size, 4, 'Shift + 同色单击应追加红色连通块');

  // 同色选区勾选时拖拽无效
  md(mouseAt(0, 0));
  mm({ ...mouseAt(1, 1) });
  mu({});
  assert.equal(App.selection.size, 4, '同色选区勾选时拖拽不应改变选择');
  assert.equal(interactionState.dragPreview, null, '同色选区勾选时不应出现拖拽预览');
  App.settings.sameColorSelect = false;

  // ESC 清除选择
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.equal(App.selection.size, 0, 'ESC 应清除选择');

  // 选择模式下单击颜色 → 填充选区并保持选择模式，记一步撤销
  App.selection.clear();
  App.selection.add(0); // (0,0) 白色
  hooks.renderAll();
  elsMap['color-list'].children[1].emit('click'); // 红色
  assert.equal(App.project.grid[0], 1, '选区应填充为红色');
  assert.equal(App.tool, 'select', '填充后应保持在选择模式');
  assert.equal(App.selection.size, 1, '填充后选区应保留');
  assert.equal(App.undoStack.length, 1, '填充应记一步撤销');
  hooks.doUndo();
  assert.equal(App.project.grid[0], 0, '撤销应恢复填充前颜色');

  // 取色：有选区 → 取色后回选择模式且选区保留；无选区 → 取色后切画笔
  App.selection.clear();
  App.selection.add(0);
  hooks.setTool('picker');
  md(mouseAt(1, 1)); // (1,1) 红色
  mu({});
  assert.equal(App.tool, 'select', '有选区时取色后应回选择模式');
  assert.equal(App.selection.size, 1, '取色不应影响选区');
  assert.equal(App.brushColor, 1, '取色应更新画笔颜色');
  assert.equal(App.project.grid[0], 1, '取色后选区应立即填充为取到的颜色');
  assert.equal(App.undoStack.length, 1, '取色填充应记一步撤销');
  App.selection.clear();
  hooks.setTool('picker');
  md(mouseAt(0, 0)); // (0,0) 白色
  mu({});
  assert.equal(App.tool, 'brush', '无选区时取色后应切画笔模式');
  hooks.setTool('select');

  // D 键九宫格：仅单选一格时可用
  App.selection.clear();
  App.selection.add(0);
  App.selection.add(1);
  interactionState.hoverCell = null; // 多选且无悬停格时 D 不应打开九宫格
  kd({ key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(elsMap['quick-picker'].classList.contains('hidden'), '多选时 D 键不应打开九宫格');
  App.selection.clear();
  App.selection.add(0);
  kd({ key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(!elsMap['quick-picker'].classList.contains('hidden'), '单选一格时 D 键应打开九宫格');
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(elsMap['quick-picker'].classList.contains('hidden'), 'ESC 应关闭九宫格');

  // 选中高亮颜色：把高亮色号全部像素转成选区并取消高亮
  App.project = { width: 2, height: 2, grid: Int16Array.from([0, 1, 0, 1]) };
  App.baseGrid = App.project.grid.slice();
  App.selection.clear();
  interactionState.highlightColor = 0; // 白色
  interactionState.highlightBlink = true;
  hooks.renderAll();
  assert.ok(App.highlightTimer, '高亮应启动闪烁定时器');
  elsMap['select-highlight'].emit('click');
  assert.equal(App.selection.size, 2, '选中高亮颜色应选中该色号全部 2 个像素');
  assert.ok(App.selection.has(0) && App.selection.has(2), '应选中两个白色格子');
  assert.equal(interactionState.highlightColor, null, '选中后应取消高亮');
  assert.equal(App.highlightTimer, null, '取消高亮后应停止闪烁定时器');

  App.settings.sameColorSelect = false;
  App.selection.clear();
  console.log('[OK] 选择模式：单击 / 矩形 / 同色 / Shift / 填充 / 取色 / 九宫格 / 高亮转选区');
}

// ---------------- 16. D 键优先级（单选格 > 悬停格）与目标格浮起效果 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection.clear();
  interactionState.highlightColor = null;
  interactionState.hoverCell = null;
  hooks.renderAll();
  const kd = windowListeners.keydown[0];
  const esc = { key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} };
  const d = { key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} };

  // 单选一格时：D 作用于选中格（即使悬停其它格），目标格带浮起效果
  App.selection = new Set([0]);
  interactionState.hoverCell = { x: 1, y: 0 };
  kd(d);
  assert.equal(interactionState.pickerCell.p, 0, '单选一格时 D 应作用于选中格 (0,0)');
  drawLog.strokes = [];
  hooks.renderAll();
  const raised = drawLog.strokes.filter(
    (s) =>
      s.style.includes('rgba(255, 255, 255, 0.85)') ||
      s.style.includes('rgba(0, 0, 0, 0.45)') ||
      s.style.includes('rgba(0, 0, 0, 0.35)'),
  );
  assert.ok(raised.length >= 3, '九宫格打开时目标格应绘制浮起效果');
  kd(esc);
  assert.equal(interactionState.pickerCell, null, '关闭九宫格后应清除目标格');

  // 未选中时：D 作用于悬停格
  App.selection.clear();
  interactionState.hoverCell = { x: 1, y: 1 };
  kd(d);
  assert.equal(interactionState.pickerCell.p, 3, '未选中时 D 应作用于悬停格 (1,1)');
  kd(esc);

  // 多选时：D 作用于悬停格
  App.selection = new Set([0, 1]);
  interactionState.hoverCell = { x: 0, y: 1 };
  kd(d);
  assert.equal(interactionState.pickerCell.p, 2, '多选时 D 应作用于悬停格 (0,1)');
  kd(esc);

  // 无悬停格时 D 无效
  App.selection.clear();
  interactionState.hoverCell = null;
  kd(d);
  assert.equal(interactionState.pickerCell, null, '无悬停格时 D 不应打开九宫格');
  App.selection.clear();
  interactionState.hoverCell = null;
  console.log('[OK] D 键优先级：单选格 > 悬停格，目标格浮起效果');
}

// ---------------- 17. 回归：右键单击不触发选择；项目变化关闭九宫格 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection.clear();
  interactionState.highlightColor = null;
  interactionState.hoverCell = null;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mu = windowListeners.mouseup[0];

  // 先左键选中一个格子
  md(mouseAt(0, 0));
  mu({});
  assert.equal(App.selection.size, 1, '前置：左键单击应选中一格');

  // 右键单击（不拖动）不应改变选择（也不会误触发取色）
  md({ ...mouseAt(1, 1), button: 2 });
  mu({});
  assert.equal(App.selection.size, 1, '右键单击不应改变选择');

  // 打开九宫格后调整滑块 → 应关闭九宫格并清空目标格
  const kd = windowListeners.keydown[0];
  kd({ key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(interactionState.pickerCell, '前置：九宫格应打开并设置目标格');
  hooks.applySlider(1);
  assert.ok(elsMap['quick-picker'].classList.contains('hidden'), '调整滑块后应关闭九宫格');
  assert.equal(interactionState.pickerCell, null, '调整滑块后应清空目标格');
  assert.equal(App.selection.size, 0, '调整滑块后应清空选区（与重新压缩一致）');
  App.selection.clear();
  console.log('[OK] 回归：右键单击不触发选择，项目变化关闭九宫格');
}

// ---------------- 18. 批量填充：整块一次提交一步撤销 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection = new Set([0, 1, 2, 3]); // 整个 2x2
  interactionState.highlightColor = null;
  hooks.renderAll();
  elsMap['color-list'].children[2].emit('click'); // 蓝色
  assert.equal(App.undoStack.length, 1, '整块填充应记一步撤销');
  assert.equal(App.undoStack[0].changes.length, 4, '一步应包含 4 个像素的修改');
  assert.ok(
    [0, 1, 2, 3].every((p) => App.project.grid[p] === 2),
    '4 格都应填成蓝色',
  );
  assert.equal(App.selection.size, 4, '填充后选区应保留');
  hooks.doUndo();
  assert.deepEqual(Array.from(App.project.grid), [0, 1, 0, 1], '撤销后应恢复原图');
  console.log('[OK] 批量填充：整块一次提交一步撤销');
}

// ---------------- 19. 边缘行列号（常驻，四个方向） ----------------
{
  seedProject();
  App.selection.clear();
  interactionState.highlightColor = null;
  drawLog.texts = [];
  hooks.renderAll();
  const digits = drawLog.texts.map((t) => t.text).filter((t) => /^\d$/.test(t));
  assert.equal(digits.length, 8, '2x2 图案应绘制 8 个行列号（上下左右各 1-2）');
  assert.ok(digits.includes('1') && digits.includes('2'), '行列号应包含 1 与 2');
  console.log('[OK] 边缘行列号：常驻四个方向');
}
