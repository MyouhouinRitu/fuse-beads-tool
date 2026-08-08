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
  fillRect(x, y, w, h) { drawLog.fills.push({ style: this._fillStyle, x, y, w, h }); },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  strokeRect() {}, fillText() {}, fill() {}, save() {}, restore() {},
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

console.log('\nDOM 行为测试全部通过');
process.exit(0);
