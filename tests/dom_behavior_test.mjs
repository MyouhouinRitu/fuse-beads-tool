// DOM 桩行为测试：加载真实 main.js，验证色板即时更新、扁平事务、撤销/重做、滑块清空。
// 运行：node tests/dom_behavior_test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------- 最小 DOM 桩 ----------------

const elsMap = {};
const created = [];
const windowListeners = {};
let confirmResult = true;

class ClassList {
  constructor() { this.set = new Set(); }
  add(...cs) { cs.forEach((c) => this.set.add(c)); }
  remove(...cs) { cs.forEach((c) => this.set.delete(c)); }
  toggle(c, force) {
    if (force === undefined) {
      if (this.set.has(c)) this.set.delete(c); else this.set.add(c);
    } else if (force) this.set.add(c); else this.set.delete(c);
  }
  contains(c) { return this.set.has(c); }
}

class El {
  constructor(id) {
    this.id = id || '';
    this.tagName = 'DIV';
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.classList = new ClassList();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this._innerHTML = '';
    this.title = '';
    this.href = '';
    this.download = '';
    this.type = '';
    this.className = '';
    this.files = [];
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.width = 0;
    this.height = 0;
    this.parentNode = null;
    this._rect = { left: 0, top: 0, width: 800, height: 600 };
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    if (this._innerHTML === '') this.children = [];
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  getBoundingClientRect() {
    const r = this._rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }
  emit(type, event = {}) {
    for (const fn of [...(this.listeners[type] || [])]) fn({ target: this, ...event });
  }
  focus() {}
  blur() {}
  getContext() {
    const ctx = Object.create(ctxStub);
    Object.defineProperty(ctx, 'canvas', { get: () => this, configurable: true });
    return ctx;
  }
}

const drawLog = { fills: [], strokes: [], texts: [] };
const ctxStub = {
  get canvas() { return elsMap['canvas']; },
  _fillStyle: '#000000',
  get fillStyle() { return this._fillStyle; },
  set fillStyle(v) { this._fillStyle = v; },
  _strokeStyle: '#000000',
  get strokeStyle() { return this._strokeStyle; },
  set strokeStyle(v) { this._strokeStyle = v; },
  _lineWidth: 1,
  get lineWidth() { return this._lineWidth; },
  set lineWidth(v) { this._lineWidth = v; },
  _lineDash: null,
  _lineDashOffset: 0,
  get lineDashOffset() { return this._lineDashOffset; },
  set lineDashOffset(v) { this._lineDashOffset = v; },
  fillRect(x, y, w, h) { drawLog.fills.push({ style: this._fillStyle, x, y, w, h }); },
  beginPath() {}, moveTo() {}, lineTo() {}, ellipse() {},
  stroke() {
    drawLog.strokes.push({
      rect: false,
      style: this._strokeStyle,
      lineWidth: this._lineWidth,
      dash: this._lineDash ? [...this._lineDash] : null,
      dashOffset: this._lineDashOffset,
    });
  },
  strokeRect(x, y, w, h) {
    drawLog.strokes.push({
      rect: true,
      style: this._strokeStyle,
      lineWidth: this._lineWidth,
      x, y, w, h,
      dash: this._lineDash ? [...this._lineDash] : null,
      dashOffset: this._lineDashOffset,
    });
  },
  setLineDash(v) { this._lineDash = [...v]; },
  fillText() {}, fill() {},
  save() {
    this._savedDash = this._lineDash ? [...this._lineDash] : null;
    this._savedDashOffset = this._lineDashOffset;
  },
  restore() {
    this._lineDash = this._savedDash ? [...this._savedDash] : null;
    this._lineDashOffset = this._savedDashOffset || 0;
  },
  getImageData() { return { data: new Uint8ClampedArray(0) }; },
  drawImage() {}, setTransform() {}, clearRect() {},
};

globalThis.document = {
  getElementById: (id) => { elsMap[id] ||= new El(id); return elsMap[id]; },
  createElement: (tag) => { const e = new El(); e.tagName = String(tag).toUpperCase(); created.push(e); return e; },
  querySelectorAll: () => [],
  body: new El('body'),
  activeElement: null,
};

globalThis.window = globalThis;
globalThis.addEventListener = (type, fn) => { (windowListeners[type] ||= []).push(fn); };
globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
globalThis.confirm = () => confirmResult;
globalThis.prompt = () => null;
globalThis.Image = class {
  set src(v) {
    this._src = v;
    queueMicrotask(() => this.onload && this.onload());
  }
};

// ---------------- API 桩 ----------------

let stateResponse = {};
const configs = [
  { name: 'cfg', colorCount: 3 },
  { name: 'other', colorCount: 2 },
];
const configColors = {
  cfg: [
    { index: 1, code: '001', name: '白', hex: '#FFFFFF' },
    { index: 2, code: '002', name: '红', hex: '#FF0000' },
    { index: 3, code: '003', name: '蓝', hex: '#0000FF' },
  ],
  other: [
    { index: 1, code: 'X1', name: 'A', hex: '#123456' },
    { index: 2, code: 'X2', name: 'B', hex: '#654321' },
  ],
};

globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('/api/auth/status')) return json({ authenticated: true, requiresAuth: false });
  if (u === '/api/configs' && (!options.method || options.method === 'GET')) {
    return json({ configs });
  }
  if (u.startsWith('/api/configs/') && !options.method) {
    const name = decodeURIComponent(u.split('/api/configs/')[1]);
    return json({ name, colors: configColors[name] || [] });
  }
  if (u === '/api/state' && (!options.method || options.method === 'GET')) return json(stateResponse);
  if (u === '/api/state' && options.method === 'PUT') {
    stateResponse = JSON.parse(options.body);
    return json({ ok: true });
  }
  if (u === '/api/export') {
    return json({ dataUrl: 'data:image/jpeg;base64,ZmFrZQ==' });
  }
  return json({ ok: true });
};

// ---------------- 加载 main.js ----------------

const mainUrl = pathToFileURL(path.resolve('static/js/main.js')).href;
await import(mainUrl);
await new Promise((r) => setTimeout(r, 80));

const App = globalThis.__app;
const hooks = globalThis.__testHooks;
assert.ok(App && hooks, '应暴露调试句柄');

const palette3 = configColors.cfg.map((c) => ({ ...c }));
function seedProject() {
  App.project = { width: 2, height: 2, grid: Int16Array.from([0, 1, 0, 1]) };
  App.baseGrid = Int16Array.from([0, 1, 0, 1]);
  App.palette = palette3.map((c) => ({ ...c }));
  App.appliedPalette = palette3.map((c) => ({ ...c }));
  App.configName = 'cfg';
  App.sliderN = 2;
  App.maxColors = 2;
  App.history = { items: [], currentId: null, nextId: 1 };
  App.undoStack = [];
  App.redoStack = [];
  App.strokeBuffer = null;
}

function fillStyles() {
  return new Set(drawLog.fills.map((f) => f.style.toLowerCase()));
}

function colorInputs() {
  return created.filter((e) => e.type === 'color');
}

function canvasRectForCells() {
  const cv = elsMap['canvas'];
  cv._rect = { left: 0, top: 0, width: cv.width || 800, height: cv.height || 600 };
}

function mouseAt(cellX, cellY) {
  return { clientX: (cellX + 5.5) * 26, clientY: (cellY + 5.5) * 26, button: 0, preventDefault() {} };
}

// ---------------- 1. 色板配置修改：不即时更新图片与画笔，重新压缩后才应用 ----------------
{
  seedProject();
  App.brushColor = 0;
  hooks.renderAll();
  assert.ok(fillStyles().has('#ffffff'), '初始绘制应包含白色像素');
  const fillsBefore = drawLog.fills.length;
  const brushBefore = elsMap['brush-label'].textContent;

  const input = colorInputs().find((e) => e.value === '#FFFFFF' || e.value === '#ffffff');
  assert.ok(input, '色板表应包含颜色输入控件');
  input.value = '#12AB34';
  input.emit('input', { target: input });

  assert.equal(App.palette[0].hex, '#12AB34', '修改后色板配置本身应立即更新');
  assert.equal(drawLog.fills.length, fillsBefore, '修改色板后不应重绘画布');
  assert.ok(!fillStyles().has('#12ab34'), '修改色板后画布不应出现新颜色');
  assert.equal(elsMap['brush-label'].textContent, brushBefore, `修改色板后画笔颜色不应改变，实际 ${elsMap['brush-label'].textContent}`);

  // 画布/编辑工具使用“已应用色板”：手动更新 appliedPalette 后重绘才生效
  App.appliedPalette[0].hex = '#00FF00';
  hooks.renderAll();
  assert.ok(fillStyles().has('#00ff00'), '画布应使用已应用色板渲染');
  assert.ok(!fillStyles().has('#12ab34'), '画布不应渲染待应用的色板配置');
  assert.ok(elsMap['brush-label'].textContent.includes('#00FF00'), '画笔应使用已应用色板');
  console.log('[OK] 色板配置修改不即时生效：画布/画笔保持已应用色板');
}

// ---------------- 2. 扁平事务：保存 / 只删当前节点 ----------------
{
  seedProject();
  hooks.saveTransaction();
  hooks.saveTransaction();
  assert.equal(App.history.items.length, 2, 'Ctrl+S 保存两次应有 2 个独立事务');
  assert.equal(App.history.items[1].id, App.history.items[0].id + 1);
  assert.equal(App.history.currentId, App.history.items[1].id);
  assert.ok(!('children' in App.history.items[0]) && !('parentId' in App.history.items[0]), '事务节点无父子关系');

  // 删除非当前事务：仅删除该节点，当前节点不变
  const firstId = App.history.items[0].id;
  hooks.doDeleteNode(firstId);
  assert.equal(App.history.items.length, 1, '删除应只移除一个事务节点');
  assert.equal(App.history.items[0].id, App.history.currentId, '删除非当前节点后当前节点不变');

  // 删除当前事务：切到相邻节点
  hooks.doDeleteNode(App.history.currentId);
  assert.equal(App.history.items.length, 0, '删除当前节点后历史清空');
  assert.equal(App.history.currentId, null);
  assert.equal(elsMap['tree-list'].children.length, 0, '历史面板应显示空状态');
  console.log('[OK] 扁平事务：保存、只删单个节点、切换当前节点');
}

// ---------------- 3. 单步撤销 / 重做（画笔整段一笔） ----------------
{
  seedProject();
  App.tool = 'brush';
  App.brushColor = 2; // 蓝色
  App.selectedCell = null;
  hooks.renderAll();
  canvasRectForCells();
  const grid = App.project.grid;
  assert.equal(grid[0], 0);
  assert.equal(grid[1], 1);

  const md = elsMap['canvas-scroll'].listeners['mousedown'][0];
  const mm = windowListeners['mousemove'][0];
  const mu = windowListeners['mouseup'][0];
  md(mouseAt(0, 0));
  mm({ ...mouseAt(1, 0) });
  mu({});

  assert.equal(grid[0], 2, '按下起点应涂成蓝色');
  assert.equal(grid[1], 2, '拖过格子应涂成蓝色');
  assert.equal(App.undoStack.length, 1, '一次按下到放开应只记一步');
  assert.equal(App.undoStack[0].changes.length, 2, '这一步应包含 2 个像素的增量修改');

  hooks.doUndo();
  assert.equal(grid[0], 0, '撤销后起点应恢复原色');
  assert.equal(grid[1], 1, '撤销后终点应恢复原色');
  assert.equal(App.redoStack.length, 1);

  hooks.doRedo();
  assert.equal(grid[0], 2, '重做后起点重新涂色');
  assert.equal(grid[1], 2, '重做后终点重新涂色');
  assert.equal(App.undoStack.length, 1);
  console.log('[OK] 单步撤销/重做：画笔整段一笔、增量还原');
}

// ---------------- 4. D 键九宫格选色记为一步 ----------------
{
  seedProject();
  App.tool = 'drag';
  App.selectedCell = { x: 0, y: 0 };
  App.pickerCandidates = [{ i: 2 }, { i: 0 }, { i: 1 }];
  App.brushColor = 0;
  hooks.renderAll();
  const grid = App.project.grid;
  assert.equal(grid[0], 0);
  hooks.pickQuickColor(0);
  assert.equal(App.undoStack.length, 1, 'D 键九宫格对单像素的修改应记为一步');
  assert.equal(grid[0], 2, '选色后像素应改为所选色号');
  hooks.doUndo();
  assert.equal(grid[0], 0, '撤销后应恢复原色');
  console.log('[OK] D 键九宫格单像素修改记为一步');
}

// ---------------- 5. 滑块调整：存在事务/记录时警告并清空 ----------------
{
  seedProject();
  hooks.saveTransaction();
  App.strokeBuffer = [];
  App.tool = 'brush';
  App.brushColor = 1;
  hooks.paintCell(0, 0);
  App.undoStack.push({ changes: App.strokeBuffer });
  App.strokeBuffer = null;
  assert.ok(App.history.items.length > 0 && App.undoStack.length > 0, '前置：存在事务与撤销记录');

  confirmResult = false;
  hooks.applySlider(1);
  assert.equal(App.history.items.length, 1, '取消确认后不应清空事务');
  assert.equal(App.undoStack.length, 1, '取消确认后不应清空撤销记录');

  confirmResult = true;
  hooks.applySlider(1);
  assert.equal(App.history.items.length, 0, '确认后应清空全部事务');
  assert.equal(App.undoStack.length, 0, '确认后应清空撤销记录');
  assert.equal(App.redoStack.length, 0, '确认后应清空重做记录');
  console.log('[OK] 滑块调整：有事务/记录时警告并清空');
}

// ---------------- 6. 恢复状态时以磁盘配置色板为准 ----------------
{
  seedProject();
  stateResponse = {
    settings: { targetPixels: 40000 },
    project: {
      width: 2,
      height: 2,
      grid: [0, 1, 0, 1],
      baseGrid: [0, 1, 0, 1],
      sliderN: 2,
      editedSinceSlider: false,
      paletteName: 'cfg',
      palette: [{ index: 1, code: 'OLD', name: '旧', hex: '#000000' }],
      maxColors: 2,
    },
    history: { items: [], currentId: null, nextId: 1 },
  };
  App.configs = configs;
  await hooks.restoreState();
  assert.equal(App.palette[0].hex, '#FFFFFF', '恢复后待应用的色板配置以磁盘配置为准');
  assert.equal(App.palette.length, 3);
  assert.equal(App.appliedPalette[0].hex, '#000000', '恢复后画布应使用状态里保存的已应用色板');
  console.log('[OK] 恢复状态：配置色板（待应用）与已应用色板分离');
}

// ---------------- 7. 导出预览与「有未保存的修改」提示 ----------------
{
  seedProject();
  hooks.renderAll();
  elsMap['dirty-indicator'].classList.add('hidden'); // 桩不解析 HTML 初始 class，手动补上
  assert.ok(elsMap['dirty-indicator'].classList.contains('hidden'), '初始应无未保存提示');
  App.tool = 'brush';
  App.brushColor = 1;
  hooks.paintCell(0, 0);
  assert.ok(!elsMap['dirty-indicator'].classList.contains('hidden'), '编辑后应显示未保存提示');
  hooks.saveTransaction();
  assert.ok(elsMap['dirty-indicator'].classList.contains('hidden'), '保存事务后应隐藏未保存提示');

  hooks.openExportDialog();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(elsMap['dlg-preview'].width > 0 && elsMap['dlg-preview'].height > 0, '导出对话框应显示实时预览');
  console.log('[OK] 导出预览与「有未保存的修改」提示');
}

// ---------------- 8. 侧边栏折叠 / 展开 ----------------
{
  seedProject();
  const panBefore = App.pan.x;
  for (const id of ['left-panel', 'color-highlight-panel', 'right-panel']) {
    const panel = elsMap[id];
    assert.ok(panel && !panel.classList.contains('collapsed'), `${id} 初始应处于展开状态`);
    // 左侧栏通过小按钮收起；颜色清单 / 事务历史通过点击标题栏收起
    const trigger = elsMap[id + '-toggle'] || elsMap[id + '-head'];
    const expand = elsMap[id + '-expand'];
    assert.ok(trigger && expand, `${id} 应包含可点击的收起触发与展开按钮`);

    trigger.emit('click');
    assert.ok(panel.classList.contains('collapsed'), `${id} 点击折叠按钮后应收起`);
    if (id === 'left-panel') {
      assert.equal(App.pan.x, panBefore + 288, '折叠左侧栏后应补偿画布位移，保持画面绝对位置');
    } else {
      assert.equal(App.pan.x, panBefore, '折叠右侧栏不应改变画布位置');
    }

    expand.emit('click');
    assert.ok(!panel.classList.contains('collapsed'), `${id} 点击展开按钮后应恢复展开`);
    assert.equal(App.pan.x, panBefore, `${id} 展开后画布位置应复原`);
  }
  console.log('[OK] 侧边栏折叠 / 展开');
}

// ---------------- 9. 对比原图 / 同步拖拽守卫 ----------------
{
  seedProject();
  App.originalImage = null;
  elsMap['chk-compare'].checked = true;
  elsMap['chk-compare'].emit('change');
  assert.equal(App.compareEnabled, false, '无原图时不应开启对比');
  assert.equal(elsMap['chk-compare'].checked, false, '无原图时勾选对比应被回退');

  elsMap['chk-sync-pan'].checked = true;
  elsMap['chk-sync-pan'].emit('change');
  assert.equal(App.compareEnabled, false, '无原图时同步拖拽不应自动开启对比');
  assert.equal(App.syncPan, false, '无原图时同步拖拽不应生效');
  assert.equal(elsMap['chk-sync-pan'].checked, false, '无原图时勾选同步应被回退');
  console.log('[OK] 对比原图 / 同步拖拽守卫');
}

// ---------------- 10. 同步换算：格放大 × 降采样系数，取消对比联动取消同步 ----------------
{
  seedProject();
  App.screenCell = 26;
  // 拼豆网格 48 格，原图显示宽 96px：整张网格 ↔ 整张原图，1 格对应 2 个显示像素
  App.project.width = 48;
  App.project.height = 48;
  elsMap['canvas-original'].width = 96;
  elsMap['canvas-original'].height = 96;
  App.pan = { x: 100, y: 50 };
  App.zoom = 1;

  hooks.mirrorBeadToOrig();
  assert.equal(App.origZoom, 13, '原图 zoom 应为 拼豆 zoom × 26 × (网格宽48/原图显示宽96)');
  assert.equal(App.origPan.x, 230, '原图 pan.x 应包含 5 格边距偏移（100 + 5×26×1）');
  assert.equal(App.origPan.y, 180, '原图 pan.y 应包含 5 格边距偏移（50 + 5×26×1）');

  App.origPan = { x: 230, y: 180 };
  App.origZoom = 13;
  hooks.mirrorOrigToBead();
  assert.equal(App.zoom, 1, '反向换算应还原拼豆 zoom');
  assert.equal(App.pan.x, 100, '反向换算应还原拼豆 pan.x');
  assert.equal(App.pan.y, 50, '反向换算应还原拼豆 pan.y');

  // 取消对比原图 → 同步拖拽应一并取消
  App.originalImage = { naturalWidth: 48, naturalHeight: 48 };
  App.compareEnabled = true;
  App.settings.compare = true;
  App.syncPan = true;
  App.settings.syncPan = true;
  elsMap['chk-compare'].checked = true;
  elsMap['chk-sync-pan'].checked = true;
  elsMap['chk-compare'].checked = false;
  elsMap['chk-compare'].emit('change');
  assert.equal(App.syncPan, false, '取消对比后同步拖拽应一并取消');
  assert.equal(elsMap['chk-sync-pan'].checked, false, '取消对比后同步勾选框应被取消');
  assert.equal(App.compareEnabled, false, '取消对比后对比状态应关闭');
  console.log('[OK] 同步换算含网格/原图比例 / 取消对比联动取消同步');
}

// ---------------- 11. 鼠标指向像素的 hover 边框 ----------------
{
  seedProject();
  App.tool = 'drag';
  App.hoverCell = null;
  App.selectedCell = null;
  App.highlightColor = null;
  hooks.renderAll();
  canvasRectForCells();

  // 拖拽模式：黑白相间虚线
  const mm = elsMap['canvas-scroll'].listeners['mousemove'][0];
  drawLog.strokes = [];
  mm(mouseAt(1, 1));
  assert.deepEqual(App.hoverCell, { x: 1, y: 1 }, '鼠标移动应记录指向的格子');
  const rectStrokes = drawLog.strokes.filter((s) => s.rect);
  assert.equal(rectStrokes.length, 2, '拖拽模式 hover 应绘制两遍虚线边框（黑 + 白）');
  assert.equal(rectStrokes[0].style.toLowerCase(), '#000000', '第一遍应为黑色');
  assert.equal(rectStrokes[1].style.toLowerCase(), '#ffffff', '第二遍应为白色');
  assert.ok(rectStrokes[0].dash && rectStrokes[0].dash[0] > 0, '拖拽模式应使用虚线');
  assert.ok(rectStrokes[1].dashOffset > 0, '第二遍虚线应错开半个周期');
  assert.ok(rectStrokes[0].x >= 156 && rectStrokes[0].y >= 156, 'hover 边框应位于指向格子的画布坐标');

  // 取色模式：3D 凸起效果（高光斜面 / 暗斜面 / 投影），不再使用虚线
  App.tool = 'picker';
  drawLog.strokes = [];
  hooks.renderAll();
  const picker3D = drawLog.strokes.filter((s) =>
    s.style.includes('rgba(255, 255, 255, 0.85)') ||
    s.style.includes('rgba(0, 0, 0, 0.45)') ||
    s.style.includes('rgba(0, 0, 0, 0.35)'));
  assert.ok(picker3D.length >= 3, '取色模式应绘制 3D 凸起（高光斜面 / 暗斜面 / 投影）');
  assert.equal(drawLog.strokes.filter((s) => s.rect).length, 0, '取色模式不应再绘制虚线边框');

  // 画笔模式：与取色一致的 3D 凸起（不再有内部黑实线）
  App.tool = 'brush';
  App.brushColor = 0; // 白色
  drawLog.strokes = [];
  hooks.renderAll();
  const brush3D = drawLog.strokes.filter((s) =>
    s.style.includes('rgba(255, 255, 255, 0.85)') ||
    s.style.includes('rgba(0, 0, 0, 0.45)') ||
    s.style.includes('rgba(0, 0, 0, 0.35)'));
  assert.ok(brush3D.length >= 3, '画笔模式应绘制 3D 凸起（高光斜面 / 暗斜面 / 投影）');
  assert.equal(drawLog.strokes.filter((s) => s.rect).length, 0, '画笔模式不应再有内部黑实线');

  // 橡皮模式：非空位画边框 + X，空位不画
  App.tool = 'eraser';
  App.hoverCell = null;
  drawLog.strokes = [];
  hooks.renderAll();
  const baseCount = drawLog.strokes.length;
  App.hoverCell = { x: 0, y: 0 }; // grid[0] = 白色
  hooks.renderAll();
  const added = drawLog.strokes.length - baseCount;
  assert.ok(added >= 3, `橡皮 hover 应绘制边框 + 两条对角线，实际增加 ${added} 条线`);
  App.project.grid[0] = -1; // 变空位
  App.hoverCell = { x: 0, y: 0 };
  drawLog.strokes = [];
  hooks.renderAll();
  assert.equal(drawLog.strokes.filter((s) => s.rect).length, 0, '橡皮指向空位时不应绘制 hover 边框');

  // 鼠标离开画布区应清除 hover
  App.hoverCell = { x: 1, y: 1 };
  const leave = elsMap['canvas-scroll'].listeners['mouseleave'][0];
  leave({});
  assert.equal(App.hoverCell, null, '鼠标离开画布区应清除 hover');

  // hover 线宽随缩放等比变化：画布线宽只由格尺寸决定，屏幕粗细交给 CSS 缩放
  App.tool = 'drag';
  App.hoverCell = { x: 1, y: 1 };
  App.zoom = 0.5;
  drawLog.strokes = [];
  hooks.renderAll();
  const zoomRects = drawLog.strokes.filter((s) => s.rect);
  assert.equal(zoomRects[0].lineWidth, 1, '缩放 0.5 时画布线宽应保持格尺寸比例（1px 细线）');
  App.zoom = 1;
  App.hoverCell = null;
  console.log('[OK] 鼠标 hover 边框：拖拽 / 画笔 / 取色 / 橡皮');
}

// ---------------- 12. 颜色清单高亮闪烁：重绘不应重置定时器 ----------------
{
  seedProject();
  App.highlightColor = 0;
  App.highlightBlink = true;
  hooks.renderAll();
  const timer1 = App.highlightTimer;
  assert.ok(timer1, '设置高亮后应启动闪烁定时器');
  hooks.renderAll(); // 模拟鼠标移动触发的重绘
  assert.equal(App.highlightTimer, timer1, '重复渲染不应重置闪烁定时器（否则闪烁会暂停）');
  App.highlightColor = null;
  hooks.renderAll();
  assert.equal(App.highlightTimer, null, '取消高亮后应停止闪烁定时器');
  console.log('[OK] 颜色清单高亮闪烁定时器不被重绘重置');
}

// ---------------- 13. 色号高亮连通块：相连像素描边合并为一个整块 ----------------
{
  seedProject();
  // 3x3 全同色 → 一个连通块：外轮廓 12 条边，块内不再逐格描边
  App.project = { width: 3, height: 3, grid: Int16Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]) };
  App.baseGrid = App.project.grid.slice();
  App.highlightColor = 0;
  App.highlightBlink = true;
  drawLog.strokes = [];
  hooks.renderAll();
  const frameStyle = 'rgba(0, 0, 0, 0.9)'; // 白色格（亮色）用深色描边
  const blockEdges = drawLog.strokes.filter((s) => s.style.includes(frameStyle));
  assert.equal(blockEdges.length, 12, '3x3 整块外轮廓应为 12 条边');
  assert.equal(drawLog.strokes.filter((s) => s.rect).length, 0, '连通块内部不应再逐格描边');

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

  App.highlightColor = null;
  hooks.renderAll();
  console.log('[OK] 色号高亮连通块：外轮廓合并、内部不描边');
}

// ---------------- 14. 画笔 / 橡皮尺寸：拖动条显示与矩形涂色 ----------------
{
  seedProject();
  App.brushSize = 1;
  App.selectedCell = null;
  App.highlightColor = null;

  // 拖动条仅在画笔 / 橡皮模式显示
  hooks.setTool('brush');
  assert.ok(!elsMap['brush-size-wrap'].classList.contains('hidden'), '画笔模式应显示尺寸拖动条');
  hooks.setTool('drag');
  assert.ok(elsMap['brush-size-wrap'].classList.contains('hidden'), '拖拽模式应隐藏尺寸拖动条');
  hooks.setTool('eraser');
  assert.ok(!elsMap['brush-size-wrap'].classList.contains('hidden'), '橡皮模式应显示尺寸拖动条');

  // 拖动条输入 → 更新画笔尺寸并持久化
  elsMap['brush-size'].value = '4';
  elsMap['brush-size'].emit('input');
  assert.equal(App.brushSize, 4, '拖动条输入应更新画笔尺寸');
  assert.equal(App.settings.brushSize, 4, '画笔尺寸应同步到设置以便持久化');
  assert.equal(elsMap['brush-size-value'].textContent, '4', '拖动条数值标签应同步');

  // 尺寸 3（边长 5）：在 6x6 图案中心 (2,2) 涂满 5x5
  App.project = { width: 6, height: 6, grid: Int16Array.from(Array(36).fill(0)) };
  App.baseGrid = App.project.grid.slice();
  App.tool = 'brush';
  App.brushColor = 2;
  App.brushSize = 3;
  App.strokeBuffer = [];
  hooks.paintStamp({ x: 2, y: 2 });
  assert.equal(Array.from(App.project.grid).filter((v) => v === 2).length, 25, '尺寸 3 在 (2,2) 应涂满 5x5（25 格）');
  assert.equal(App.strokeBuffer.length, 25, '一次盖章应记录 25 个像素修改');
  App.strokeBuffer = null;

  // 边缘裁剪：角落 (0,0) 盖章 → 只涂 3x3（用调色板内合法色号 1）
  App.brushColor = 1;
  App.strokeBuffer = [];
  hooks.paintStamp({ x: 0, y: 0 });
  assert.equal(Array.from(App.project.grid).filter((v) => v === 1).length, 9, '角落盖章应裁剪为 3x3（9 格）');
  App.strokeBuffer = null;

  // 橡皮尺寸：以 (3,3) 为中心擦除 5x5
  App.tool = 'eraser';
  App.strokeBuffer = [];
  hooks.paintStamp({ x: 3, y: 3 });
  const erased = Array.from(App.project.grid).filter((v) => v === -1).length;
  assert.equal(erased, 25, '橡皮尺寸 3 在 (3,3) 应擦除 5x5（25 格）');
  App.strokeBuffer = null;
  App.brushSize = 1;
  hooks.setTool('drag');
  console.log('[OK] 画笔 / 橡皮尺寸：拖动条显示与矩形涂色');
}

console.log('\nDOM 行为测试全部通过');
process.exit(0);
