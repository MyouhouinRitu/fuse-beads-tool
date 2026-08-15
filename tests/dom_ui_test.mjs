// DOM 行为测试（dom_ui_test.mjs 分组）：依赖 tests/helpers/dom-harness.mjs 的共享桩。

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

// ---------------- 20. 使用问题修复下拉菜单与文档弹窗 ----------------
{
  elsMap['fix-menu'].classList.add('hidden');
  elsMap['btn-fix-menu'].emit('click');
  assert.ok(!elsMap['fix-menu'].classList.contains('hidden'), '点击下拉按钮应展开菜单');
  elsMap['fix-item-gesture'].emit('click');
  assert.ok(elsMap['fix-menu'].classList.contains('hidden'), '点击菜单项后应关闭菜单');
  await new Promise((r) => setTimeout(r, 10)); // 等待文档 fetch 完成
  assert.ok(!elsMap['doc-dialog'].classList.contains('hidden'), '点击菜单项应打开文档弹窗');
  assert.ok(elsMap['doc-content'].innerHTML.includes('问题现象'), '文档应渲染出「问题现象」');
  assert.ok(
    elsMap['doc-content'].innerHTML.includes('问题修复方案'),
    '文档应渲染出「问题修复方案」',
  );
  assert.ok(elsMap['doc-content'].innerHTML.includes('<li>'), '文档列表应被渲染');
  elsMap['doc-close'].emit('click');
  assert.ok(elsMap['doc-dialog'].classList.contains('hidden'), '点击关闭应隐藏文档弹窗');
  console.log('[OK] 使用问题修复：下拉菜单与文档弹窗');
}

// ---------------- 21. 日间 / 夜间模式切换 ----------------
{
  const rootEl = globalThis.document.documentElement;
  rootEl.dataset.theme = 'light';
  hooks.toggleTheme();
  assert.equal(rootEl.dataset.theme, 'dark', '点击后应切换为夜间模式');
  assert.ok(elsMap['btn-theme'].textContent.includes('日间'), '夜间模式下按钮应提示切换日间');
  hooks.toggleTheme();
  assert.equal(rootEl.dataset.theme, 'light', '再次点击应切回日间模式');
  assert.ok(elsMap['btn-theme'].textContent.includes('夜间'), '日间模式下按钮应提示切换夜间');

  // 行列号四角透明：日间与夜间都不填充纯黑/纯白角块（露出工作区背景）
  rootEl.dataset.theme = 'light';
  seedProject();
  drawLog.fills = [];
  hooks.renderAll();
  const blackCornerDay = drawLog.fills.filter(
    (f) => f.style.toLowerCase() === '#000000' && f.x === 0 && f.y === 0,
  );
  assert.equal(blackCornerDay.length, 0, '日间模式不应绘制黑色四角');
  rootEl.dataset.theme = 'dark';
  seedProject();
  drawLog.fills = [];
  hooks.renderAll();
  const blackCornerNight = drawLog.fills.filter(
    (f) => f.style.toLowerCase() === '#000000' && f.x === 0 && f.y === 0,
  );
  assert.equal(blackCornerNight.length, 0, '夜间模式四角也不应绘制黑色（改为透明）');
  rootEl.dataset.theme = 'light';
  console.log('[OK] 日间/夜间模式：切换与按钮文案');
}

// ---------------- 22. 快捷键 Q/W/E 工具切换与 Delete 清除选区 ----------------
{
  const kd = windowListeners.keydown[0];
  const prevent = () => {};
  seedProject();
  hooks.setTool('select');
  App.selection.clear();
  App.brushColor = null;
  kd({ key: 'q', ctrlKey: false, metaKey: false, target: null, preventDefault: prevent });
  assert.equal(App.tool, 'brush', 'Q 应切换到画笔');
  assert.equal(App.brushColor, 2, '未选色时 Q 进入画笔应默认取调色板最暗色（蓝色）');
  kd({ key: 'w', ctrlKey: false, metaKey: false, target: null, preventDefault: prevent });
  assert.equal(App.tool, 'picker', 'W 应切换到取色');
  kd({ key: 'e', ctrlKey: false, metaKey: false, target: null, preventDefault: prevent });
  assert.equal(App.tool, 'eraser', 'E 应切换到橡皮');
  // 输入框内不触发工具切换
  hooks.setTool('select');
  kd({
    key: 'q',
    ctrlKey: false,
    metaKey: false,
    target: { tagName: 'INPUT' },
    preventDefault: prevent,
  });
  assert.equal(App.tool, 'select', '输入框内 Q 不应切换工具');
  // Delete：清除选中格为空位，记一步撤销且保留选区
  hooks.setTool('select');
  seedProject();
  App.selection = new Set([0, 1, 2, 3]);
  App.undoStack = [];
  App.redoStack = [];
  kd({ key: 'Delete', ctrlKey: false, metaKey: false, target: null, preventDefault: prevent });
  assert.ok(
    [0, 1, 2, 3].every((p) => App.project.grid[p] === -1),
    'Delete 应把选中格清为空位',
  );
  assert.equal(App.undoStack.length, 1, '清除选区应记一步撤销');
  assert.equal(App.undoStack[0].changes.length, 4, '一步应包含 4 个像素的修改');
  assert.equal(App.selection.size, 4, '清除后应保留选区');
  hooks.doUndo();
  assert.deepEqual(Array.from(App.project.grid), [0, 1, 0, 1], '撤销后应恢复原图');
  // 无选区时 Delete 不产生撤销记录
  App.selection = new Set();
  App.undoStack = [];
  kd({ key: 'Delete', ctrlKey: false, metaKey: false, target: null, preventDefault: prevent });
  assert.equal(App.undoStack.length, 0, '无选区时 Delete 不应产生撤销记录');
  console.log('[OK] 快捷键 Q/W/E 工具切换与 Delete 清除选区');
}

// ---------------- 23. 结构型步骤：裁剪撤销 / 重做 ----------------
{
  seedProject();
  const before = {
    width: App.project.width,
    height: App.project.height,
    grid: App.project.grid.slice(),
    baseGrid: App.baseGrid.slice(),
  };
  App.project = { width: 1, height: 1, grid: Int16Array.from([2]) };
  App.baseGrid = Int16Array.from([2]);
  const after = {
    width: App.project.width,
    height: App.project.height,
    grid: App.project.grid.slice(),
    baseGrid: App.baseGrid.slice(),
  };
  hooks.recordCropStep(before, after);
  assert.equal(App.undoStack.length, 1, '裁剪步骤应独占撤销栈');
  hooks.doUndo();
  assert.equal(App.project.width, 2, '撤销裁剪应恢复宽度');
  assert.equal(App.project.height, 2, '撤销裁剪应恢复高度');
  assert.deepEqual(Array.from(App.project.grid), [0, 1, 0, 1], '撤销裁剪应恢复网格');
  assert.equal(App.selection.size, 0, '结构型撤销后应清空选区');
  hooks.doRedo();
  assert.equal(App.project.width, 1, '重做裁剪应恢复裁剪后宽度');
  assert.deepEqual(Array.from(App.project.grid), [2], '重做裁剪应恢复裁剪后网格');
  console.log('[OK] 结构型步骤：裁剪撤销/重做');
}

// ---------------- 24. 裁剪工具：进入 / 移动边 / 自动裁剪 / 应用 / 退出 ----------------
{
  seedProject(); // 2x2 grid [0,1,0,1]
  hooks.setTool('crop');
  assert.equal(App.tool, 'crop', '应能进入裁剪模式');
  assert.ok(
    globalThis.document.body.classList.contains('crop-active'),
    '裁剪模式应给工作区加蒙版类',
  );
  assert.deepEqual(interactionState.crop, { x0: 0, y0: 0, x1: 1, y1: 1 }, '初始矩形应为整图');
  hooks.moveCropEdgeTo('left', 1);
  assert.equal(interactionState.crop.x0, 1, '左边应移动到第 1 条格线');
  hooks.moveCropEdgeTo('bottom', 1);
  assert.equal(interactionState.crop.y1, 0, '底边应移动到第 1 条格线');
  hooks.moveCropEdgeTo('right', 0);
  assert.equal(interactionState.crop.x1, 1, '右边不能越过左边');

  // 自动裁剪：带空位的图案 → 收缩到非空格包围盒
  App.project.grid = Int16Array.from([0, -1, -1, 2]);
  hooks.autoCrop();
  assert.deepEqual(
    interactionState.crop,
    { x0: 0, y0: 0, x1: 1, y1: 1 },
    '自动裁剪应收缩到非空格包围盒',
  );

  // 应用：裁剪左上角 1x1（网格 [0,-1,-1,2] → [0]）
  hooks.moveCropEdgeTo('bottom', 0);
  hooks.moveCropEdgeTo('right', 0);
  hooks.applyCrop();
  assert.equal(App.tool, 'select', '应用后应回到选择模式');
  assert.ok(
    !globalThis.document.body.classList.contains('crop-active'),
    '退出裁剪后应移除工作区蒙版类',
  );
  assert.equal(App.project.width, 1, '应用后宽度应为 1');
  assert.equal(App.project.height, 1, '应用后高度应为 1');
  assert.deepEqual(Array.from(App.project.grid), [0], '应用后网格应为裁剪结果');
  assert.equal(App.history.items.length, 1, '应生成裁剪前事务快照');
  assert.ok(App.history.items[0].label.includes('裁剪前'), '快照标签应为「裁剪前」');
  assert.equal(App.undoStack.length, 1, '应记录一步结构型撤销');
  assert.ok(
    elsMap['crop-controls'].classList.contains('hidden'),
    '退出裁剪后应隐藏自动裁剪/应用按钮',
  );
  hooks.doUndo();
  assert.equal(App.project.width, 2, '撤销裁剪应恢复宽度');
  assert.deepEqual(Array.from(App.project.grid), [0, -1, -1, 2], '撤销应恢复网格');

  // ESC 退出裁剪不应用
  hooks.setTool('crop');
  hooks.moveCropEdgeTo('left', 1);
  const kd = windowListeners.keydown[0];
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault: () => {} });
  assert.equal(App.tool, 'select', 'ESC 应退出裁剪模式');
  assert.equal(interactionState.crop, null, 'ESC 退出后裁剪状态应清空');
  assert.equal(App.project.width, 2, 'ESC 不应应用裁剪');

  // 光标与预览：悬停边显示双箭头；图片之外取消选择；选中边时显示预览虚线
  hooks.setTool('crop');
  const cv = elsMap.canvas;
  canvasRectForCells();
  const cellSz = App.screenCell;
  const scale2 = cv.getBoundingClientRect().width / cv.width;
  const edgeX = 1 * cellSz * scale2; // 左边缘格线
  const midY = 1.5 * cellSz * scale2;
  hooks.updateCropCursor({ clientX: edgeX, clientY: midY });
  assert.equal(cv.style.cursor, 'ew-resize', '悬停左边缘应显示左右调整光标');
  interactionState.cropActiveEdge = 'left';
  drawLog.strokes = [];
  hooks.updateCropPreview({ clientX: 2 * cellSz * scale2, clientY: midY });
  assert.deepEqual(
    interactionState.cropPreview,
    { horizontal: true, pos: 1 },
    '预览应记录水平格线位置 1',
  );
  assert.ok(
    drawLog.strokes.some((s) => s.style === '#ff3b30' && s.dash && s.dash.length),
    '应绘制红色预览虚线',
  );
  // 选中边且鼠标在图案内（不在线上）也显示双箭头
  interactionState.cropActiveEdge = 'bottom';
  hooks.updateCropCursor({ clientX: 1.5 * cellSz * scale2, clientY: midY });
  assert.equal(cv.style.cursor, 'ns-resize', '选中底边后鼠标在图案内应显示上下调整光标');
  // 拖拽中不显示预览虚线
  interactionState.cropActiveEdge = 'left';
  globalThis.__dragState.cropEdge = 'left';
  interactionState.cropPreview = { horizontal: true, pos: 1 };
  drawLog.strokes = [];
  hooks.renderAll();
  assert.ok(
    !drawLog.strokes.some((s) => s.style === '#ff3b30' && s.dash && s.dash.length),
    '拖拽中不应绘制红色预览虚线',
  );
  globalThis.__dragState.cropEdge = null;
  // 拖拽结束后取消选中；单击（未拖拽）保持选中
  const mu = windowListeners.mouseup[0];
  interactionState.cropActiveEdge = 'left';
  globalThis.__dragState.active = true;
  globalThis.__dragState.cropEdge = 'left';
  globalThis.__dragState.moved = true;
  mu({});
  assert.equal(interactionState.cropActiveEdge, null, '拖拽结束后应取消选中该边');
  interactionState.cropActiveEdge = 'left';
  globalThis.__dragState.active = true;
  globalThis.__dragState.cropEdge = 'left';
  globalThis.__dragState.moved = false;
  mu({});
  assert.equal(interactionState.cropActiveEdge, 'left', '单击（未拖拽）应保持边选择');
  // 鼠标在图片之外：保留边选择与预览位置并继续显示双箭头；仅点击才取消
  hooks.updateCropPreview({ clientX: 2 * cellSz * scale2, clientY: midY });
  assert.deepEqual(
    interactionState.cropPreview,
    { horizontal: true, pos: 1 },
    '前置：预览应已设置',
  );
  hooks.updateCropCursor({ clientX: -100, clientY: -100 });
  assert.equal(interactionState.cropActiveEdge, 'left', '鼠标在图片之外不应取消边选择');
  assert.equal(cv.style.cursor, 'ew-resize', '图片之外选中左边时应继续显示左右调整光标');
  hooks.updateCropPreview({ clientX: -100, clientY: -100 });
  assert.deepEqual(
    interactionState.cropPreview,
    { horizontal: true, pos: 1 },
    '鼠标移出图片后预览位置应保留',
  );
  const mdOut = elsMap['canvas-scroll'].listeners.mousedown[0];
  mdOut({
    button: 0,
    clientX: -100,
    clientY: -100,
    target: elsMap.canvas,
    shiftKey: false,
    preventDefault() {},
  });
  assert.equal(interactionState.cropActiveEdge, null, '点击图片之外应取消边选择');

  // 拖拽移动边：按下命中边 → 拖动 → 松开
  interactionState.crop = { x0: 0, y0: 0, x1: 1, y1: 1 };
  interactionState.cropActiveEdge = null;
  interactionState.cropPreview = null;
  const mdDrag = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mmDrag = windowListeners.mousemove[0];
  const muDrag = windowListeners.mouseup[0];
  const dragY = 1.5 * cellSz * scale2;
  mdDrag({
    button: 0,
    clientX: edgeX,
    clientY: dragY,
    target: elsMap.canvas,
    shiftKey: false,
    preventDefault() {},
  });
  assert.equal(interactionState.cropActiveEdge, 'left', '按下左边缘应选中该边');
  assert.equal(globalThis.__dragState.cropEdge, 'left', '按下左边缘应进入拖拽状态');
  mmDrag({ clientX: 2 * cellSz * scale2, clientY: dragY, button: 0 });
  assert.equal(interactionState.crop.x0, 1, '拖拽应把左边移动到格线');
  muDrag({});
  assert.equal(interactionState.cropActiveEdge, null, '拖拽结束应取消边选中');
  assert.equal(interactionState.cropPreview, null, '拖拽结束后预览应清空');

  // 放大镜：低缩放显示、正常缩放隐藏
  hooks.setTool('crop');
  App.screenCell = 8;
  App.zoom = 1;
  interactionState.hoverCell = { x: 0, y: 0 };
  hooks.updateCropMagnifier({ clientX: 100, clientY: 100 });
  assert.ok(!elsMap['crop-magnifier'].classList.contains('hidden'), '低缩放时应显示放大镜');
  assert.equal(elsMap['crop-magnifier-canvas'].width, 11 * 20, '放大镜应为 11×11，每格 20px');
  App.zoom = 2;
  hooks.updateCropMagnifier({ clientX: 100, clientY: 100 });
  assert.ok(elsMap['crop-magnifier'].classList.contains('hidden'), '正常缩放应隐藏放大镜');
  App.zoom = 1;
  console.log('[OK] 裁剪工具：进入/移动边/自动裁剪/应用/退出与放大镜');
}

// ---------------- 25. 魔棒：容差 / 四向连通 / Shift 追加 / 滑块显隐 ----------------
{
  seedProject();
  App.project = {
    width: 3,
    height: 3,
    grid: Int16Array.from([0, 1, 0, 0, 1, 0, 0, 2, 3]),
  };
  App.baseGrid = App.project.grid.slice();
  App.appliedPalette = [
    { index: 1, code: 'W', name: '白', hex: '#FFFFFF' },
    { index: 2, code: 'G', name: '浅灰', hex: '#EDEDED' },
    { index: 3, code: 'R', name: '红', hex: '#FF0000' },
    { index: 4, code: 'B', name: '蓝', hex: '#0000FF' },
  ];
  App.palette = App.appliedPalette.map((c) => ({ ...c }));
  App.settings.useLab = true;
  App.settings.wandSensitivity = 0;
  App.selection.clear();
  interactionState.highlightColor = null;
  App.brushColor = 0;
  hooks.renderAll();

  hooks.setTool('select');
  assert.ok(
    elsMap['wand-sensitivity-wrap'].classList.contains('hidden'),
    '选择模式应隐藏魔棒容差滑块',
  );
  elsMap['tool-wand'].emit('click');
  assert.equal(App.tool, 'wand', '点击魔棒按钮应进入魔棒模式');
  assert.equal(elsMap['mode-label'].textContent, '魔棒模式', '魔棒模式标签应为「魔棒模式」');
  assert.ok(
    !elsMap['wand-sensitivity-wrap'].classList.contains('hidden'),
    '魔棒模式应显示容差滑块',
  );
  assert.equal(elsMap['wand-sensitivity'].value, '0', '滑块值应与当前容差设置同步');

  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners.mousedown[0];
  const mu = windowListeners.mouseup[0];
  const kd = windowListeners.keydown[0];

  // 容差 0：只选起点所在的同色四向连通块（左列 3 个白色，不跨过浅灰）
  App.selection.clear();
  md(mouseAt(0, 0));
  mu({});
  assert.equal(App.selection.size, 3, '容差 0 应只选起点所在同色连通块');
  assert.deepEqual(
    [...App.selection].sort((a, b) => a - b),
    [0, 3, 6],
    '应选中左列 3 个白色格',
  );
  assert.equal(App.tool, 'wand', '魔棒点击后应保持在魔棒模式');

  // 调高容差：浅灰作为桥接色，把左右两片白色一起选中
  elsMap['wand-sensitivity'].value = '30';
  elsMap['wand-sensitivity'].emit('input', { target: elsMap['wand-sensitivity'] });
  assert.equal(App.settings.wandSensitivity, 30, '容差滑块应更新设置');
  assert.equal(elsMap['wand-sensitivity-value'].textContent, '30', '容差数值标签应同步');
  App.selection.clear();
  md(mouseAt(0, 0));
  mu({});
  assert.equal(App.selection.size, 7, '容差 30 应把浅灰桥接的相似色一起选中');
  assert.ok(!App.selection.has(7) && !App.selection.has(8), '红色/蓝色不应被选中');

  // Shift 追加：把红色连通块并入选区
  md({ ...mouseAt(1, 2), shiftKey: true });
  mu({});
  assert.equal(App.selection.size, 8, 'Shift + 魔棒点击应追加选区');
  assert.ok(App.selection.has(7), 'Shift 后应包含红色格');

  // ESC 返回选择模式但保留选区；M 键再切回魔棒
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.equal(App.tool, 'select', 'ESC 应返回选择模式');
  assert.equal(App.selection.size, 8, '返回选择模式后应保留魔棒选区');
  kd({ key: 'm', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.equal(App.tool, 'wand', 'M 键应切换到魔棒');

  App.selection.clear();
  hooks.setTool('select');
  console.log('[OK] 魔棒：容差 / 四向连通 / Shift 追加 / 滑块显隐');
}

// ---------------- 26. 缩放细节阈值：细线/色号与粗虚线/实线分层隐藏 ----------------
{
  seedProject();
  hooks.setTool('select');
  interactionState.crop = null;
  interactionState.cropActiveEdge = null;
  interactionState.cropPreview = null;
  App.project = { width: 12, height: 12, grid: new Int16Array(144).fill(1) };
  App.baseGrid = App.project.grid.slice();
  App.zoom = 1;
  drawLog.strokes = [];
  drawLog.texts = [];
  hooks.renderAll();
  const baseCell = App.screenCell;
  const gray = (arr) => arr.filter((s) => s.style && s.style.toLowerCase() === '#9a9a9a');
  const isDash = (s) => s.dash && s.dash.length > 0;
  const thinGray = (arr) => arr.filter((s) => s.lineWidth === 1 && !isDash(s));
  assert.ok(thinGray(gray(drawLog.strokes)).length > 0, '正常缩放应绘制灰色细实线');
  assert.ok(
    gray(drawLog.strokes).some((s) => isDash(s)),
    '正常缩放应绘制每 5 格虚线',
  );

  App.zoom = Math.max(0.05, 7 / baseCell); // 格屏宽 ≈ 7：细线与色号隐藏，粗线保留
  drawLog.strokes = [];
  drawLog.texts = [];
  hooks.renderAll();
  assert.equal(thinGray(gray(drawLog.strokes)).length, 0, '格屏宽 < 8 时细线应隐藏');
  assert.ok(
    gray(drawLog.strokes).some((s) => isDash(s)),
    '格屏宽 < 8 时每 5 格虚线仍应保留',
  );
  assert.ok(!drawLog.texts.some((t) => /^0/.test(String(t.text))), '格屏宽 < 8 时色号应隐藏');

  App.zoom = Math.max(0.05, 3 / baseCell); // 格屏宽 ≈ 3：粗虚线/实线也隐藏
  drawLog.strokes = [];
  hooks.renderAll();
  assert.equal(gray(drawLog.strokes).length, 0, '格屏宽 < 4 时粗线也应隐藏');
  App.zoom = 1;
  console.log('[OK] 缩放细节阈值：细线/色号与粗虚线/实线分层隐藏');
}

// ---------------- 27. 目标像素量下拉预设 ----------------
{
  elsMap['target-pixels-menu'].classList.add('hidden');
  elsMap['target-pixels-btn'].emit('click');
  assert.ok(!elsMap['target-pixels-menu'].classList.contains('hidden'), '点击箭头应展开菜单');
  assert.equal(elsMap['target-pixels-menu'].children.length, 4, '应渲染 4 个预设项');
  const opt = elsMap['target-pixels-menu'].children[0];
  assert.equal(opt.title, '初次尝试拼豆的儿童建议不超过 500', '预设项应带悬浮提示');
  elsMap['target-pixels'].value = '';
  opt.emit('click');
  assert.equal(elsMap['target-pixels'].value, '400', '点击预设应写入输入框');
  assert.ok(elsMap['target-pixels-menu'].classList.contains('hidden'), '选择后应关闭菜单');

  // 箭头可再次展开；输入框文本区不弹菜单，仅直接编辑数值
  elsMap['target-pixels-menu'].classList.add('hidden');
  elsMap['target-pixels'].emit('mousedown', { button: 0 });
  assert.ok(
    elsMap['target-pixels-menu'].classList.contains('hidden'),
    '点击输入框文本区不应展开菜单',
  );
  elsMap['target-pixels'].value = '1234';
  elsMap['target-pixels'].emit('input');
  assert.equal(elsMap['target-pixels'].value, '1234', '输入框应仍可直接输入数值');
  elsMap['target-pixels'].value = '50';
  elsMap['target-pixels'].emit('change');
  assert.equal(elsMap['target-pixels'].value, '100', '低于 100 的目标像素量应在失焦时夹到 100');
  elsMap['target-pixels'].value = '100000';
  elsMap['target-pixels'].emit('change');
  assert.equal(elsMap['target-pixels'].value, '80000', '超过上限应在失焦时夹到 80000');
  console.log('[OK] 目标像素量下拉预设');
}

// ---------------- 28. 导出弹窗：Escape 关闭并重置状态 ----------------
{
  elsMap['export-dialog'].classList.add('hidden');
  elsMap['fix-menu'].classList.add('hidden');
  elsMap['target-pixels-menu'].classList.add('hidden');
  hooks.openExportDialog();
  assert.ok(!elsMap['export-dialog'].classList.contains('hidden'), '应能打开导出弹窗');
  elsMap['dlg-busy'].classList.remove('hidden');
  elsMap['dlg-status'].textContent = '正在导出…';
  elsMap['dlg-pdf-pages'].classList.remove('hidden');
  elsMap['dlg-preview-mask'].classList.remove('hidden');
  const kd = windowListeners.keydown[0];
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(elsMap['export-dialog'].classList.contains('hidden'), 'Escape 应关闭导出弹窗');
  assert.ok(elsMap['dlg-busy'].classList.contains('hidden'), '关闭后应重置导出中状态');
  assert.equal(elsMap['dlg-status'].textContent, '', '关闭后应清空状态文案');
  assert.ok(elsMap['dlg-pdf-pages'].classList.contains('hidden'), '关闭后应重置 PDF 页码');
  assert.ok(elsMap['dlg-preview-mask'].classList.contains('hidden'), '关闭后应重置预览遮罩');
  console.log('[OK] 导出弹窗：Escape 关闭并重置状态');
}

// ---------------- 29. 触摸拖拽：Pointer Events 涂色 ----------------
{
  seedProject();
  App.tool = 'brush';
  App.brushColor = 1;
  App.strokeBuffer = [];
  canvasRectForCells();
  const pd = elsMap['canvas-scroll'].listeners.pointerdown[0];
  const pm = elsMap['canvas-scroll'].listeners.pointermove[0];
  const pu = elsMap['canvas-scroll'].listeners.pointerup[0];
  const target = elsMap.canvas;
  pd({ ...mouseAt(0, 0), pointerType: 'touch', pointerId: 1, target });
  pm({ ...mouseAt(1, 0), pointerType: 'touch', pointerId: 1, target });
  pu({ pointerType: 'touch', pointerId: 1, target, preventDefault() {} });
  assert.equal(App.project.grid[1], 1, '触摸拖拽应涂色');
  assert.equal(App.undoStack.length, 1, '触摸拖拽结束应记一步撤销');
  console.log('[OK] 触摸拖拽：Pointer Events 涂色');
}

// ---------------- 30. ESC 取消键盘焦点 ----------------
{
  seedProject();
  let blurred = false;
  globalThis.document.activeElement = {
    blur: () => {
      blurred = true;
    },
  };
  const kd = windowListeners.keydown[0];
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.equal(blurred, true, 'ESC 应取消键盘焦点');
  globalThis.document.activeElement = null;
  console.log('[OK] ESC 取消键盘焦点');
}
