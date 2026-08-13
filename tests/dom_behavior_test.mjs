// DOM 桩行为测试：加载真实 main.js，验证色板即时更新、扁平事务、撤销/重做、滑块清空。
// 运行：node tests/dom_behavior_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    this.files = [];
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.width = 0;
    this.height = 0;
    this.parentNode = null;
    this._rect = { left: 0, top: 0, width: 800, height: 600 };
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // className 与 classList 双向同步（模拟真实 DOM）
  get className() { return [...this.classList.set].join(' '); }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    if (this._innerHTML === '') this.children = [];
  }
  appendChild(c) {
    // DocumentFragment：把子元素平铺进容器，模拟真实 DOM 行为
    if (c.id === '__fragment__') {
      for (const ch of [...c.children]) this.appendChild(ch);
      return c;
    }
    this.children.push(c);
    c.parentNode = this;
    return c;
  }
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
    // 模拟 DOM 事件冒泡：沿 parentNode 逐级触发监听器
    let el = this;
    while (el) {
      for (const fn of [...(el.listeners[type] || [])]) fn({ target: this, currentTarget: el, ...event });
      el = el.parentNode;
    }
  }
  focus() {}
  blur() {}
  closest(sel) {
    let el = this;
    while (el) {
      if (matchesSelector(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  querySelector(sel) {
    const walk = (el) => {
      if (el !== this && matchesSelector(el, sel)) return el;
      for (const c of el.children || []) {
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
  getContext() {
    const ctx = Object.create(ctxStub);
    Object.defineProperty(ctx, 'canvas', { get: () => this, configurable: true });
    return ctx;
  }
}

// 极简选择器匹配：仅覆盖测试用到的 class / tag / #id / [attr]（data-* 映射到 dataset）
function matchesSelector(el, sel) {
  let rest = sel.trim();
  let tag = null;
  const tagM = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagM) { tag = tagM[0].toLowerCase(); rest = rest.slice(tagM[0].length); }
  const classes = [];
  const ids = [];
  const attrs = [];
  for (;;) {
    const idM = rest.match(/^#([\w-]+)/);
    if (idM) { ids.push(idM[1]); rest = rest.slice(idM[0].length); continue; }
    const clsM = rest.match(/^\.([\w-]+)/);
    if (clsM) { classes.push(clsM[1]); rest = rest.slice(clsM[0].length); continue; }
    const attrM = rest.match(/^\[([\w-]+)(?:="([^"]*)")?\]/);
    if (attrM) { attrs.push([attrM[1], attrM[2] ?? null]); rest = rest.slice(attrM[0].length); continue; }
    break;
  }
  if (rest.trim() !== '') throw new Error('stub 不支持的 selector: ' + sel);
  if (tag && el.tagName.toLowerCase() !== tag) return false;
  for (const id of ids) if (el.id !== id) return false;
  for (const c of classes) if (!el.classList.contains(c)) return false;
  for (const [name, val] of attrs) {
    let v = null;
    const dsName = name.startsWith('data-') ? name.slice(5) : name;
    if (el.dataset && el.dataset[dsName] !== undefined) v = String(el.dataset[dsName]);
    else if (el[name] !== undefined) v = String(el[name]);
    if (v === null || (val !== null && v !== val)) return false;
  }
  return true;
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
  rect() {}, clip() {},
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
  measureText(text) { return { width: String(text).length * 7 }; },
  fillText(text, x, y) { drawLog.texts.push({ text: String(text), x, y, fillStyle: this._fillStyle }); }, fill() {},
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

// 预注册模板中真实存在的元素 id：getElementById 对未知 id 返回 null，
// 与真实浏览器一致，让 main.js 的 assertElements 在缺 id 时立即失败（fail-fast）
const templateHtml = fs.readFileSync(path.resolve('templates/index.html'), 'utf8');
for (const m of templateHtml.matchAll(/id="([^"]+)"/g)) {
  elsMap[m[1]] ||= new El(m[1]);
}

globalThis.document = {
  documentElement: { dataset: {} },
  getElementById: (id) => elsMap[id] || null,
  createElement: (tag) => { const e = new El(); e.tagName = String(tag).toUpperCase(); created.push(e); return e; },
  createDocumentFragment: () => new El('__fragment__'),
  querySelectorAll: () => [],
  addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
  body: new El('body'),
  activeElement: null,
};

globalThis.window = globalThis;
globalThis.addEventListener = (type, fn) => { (windowListeners[type] ||= []).push(fn); };
// 模拟 rAF：同步执行回调并传入「已到动画结束」的时间戳，
// 使基于 rAF 的动画（如侧边栏位移补偿）在测试中一步完成
globalThis.requestAnimationFrame = (fn) => { fn(Infinity); return 1; };
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
  if (u.includes('/static/docs/right-drag-gesture-fix.md')) {
    return {
      ok: true,
      status: 200,
      text: async () => '## 问题现象\n- 画线不拖拽\n\n## 问题原因\nEdge 鼠标手势。\n\n## 问题修复方案\n1. 添加 http://127.0.0.1',
    };
  }
  return json({ ok: true });
};

// ---------------- 加载 main.js ----------------

globalThis.__FUSE_TEST__ = true; // 测试标记：允许 main.js 暴露 __app / __testHooks
const mainUrl = pathToFileURL(path.resolve('static/js/main.js')).href;
await import(mainUrl);
await new Promise((r) => setTimeout(r, 80));

const App = globalThis.__app;
const hooks = globalThis.__testHooks;
assert.ok(App && hooks, '应暴露调试句柄');
// 模板中带 hidden 类的元素在桩环境里默认是空 classList，这里补上与真实 HTML 一致的初始状态
elsMap['doc-dialog'].classList.add('hidden');
elsMap['fix-menu'].classList.add('hidden');
elsMap['target-pixels-menu'].classList.add('hidden');
elsMap['export-dialog'].classList.add('hidden');
elsMap['login-mask'].classList.add('hidden');
elsMap['quick-picker'].classList.add('hidden');

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
  return { clientX: (cellX + 1.5) * 28, clientY: (cellY + 1.5) * 28, button: 0, preventDefault() {} };
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
  hooks.deleteHistoryItem(firstId);
  assert.equal(App.history.items.length, 1, '删除应只移除一个事务节点');
  assert.equal(App.history.items[0].id, App.history.currentId, '删除非当前节点后当前节点不变');

  // 删除当前事务：切到相邻节点
  hooks.deleteHistoryItem(App.history.currentId);
  assert.equal(App.history.items.length, 0, '删除当前节点后历史清空');
  assert.equal(App.history.currentId, null);
  assert.equal(elsMap['history-list'].children.length, 0, '历史面板应显示空状态');
  console.log('[OK] 扁平事务：保存、只删单个节点、切换当前节点');
}

// ---------------- 3. 单步撤销 / 重做（画笔整段一笔） ----------------
{
  seedProject();
  App.tool = 'brush';
  App.brushColor = 2; // 蓝色
  App.selection.clear();
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
  App.tool = 'select';
  App.selection = new Set([0]); // 选中 (0,0)
  App.brushColor = 0;
  hooks.renderAll();
  const grid = App.project.grid;
  assert.equal(grid[0], 0);

  // D 键打开九宫格
  const kd = windowListeners['keydown'][0];
  kd({ key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(!elsMap['quick-picker'].classList.contains('hidden'), 'D 键应打开九宫格');
  const btns = elsMap['quick-picker'].children
    .filter((c) => c.tagName === 'BUTTON' && !c.className.includes('qp-cancel'));
  assert.ok(btns.length > 0, '九宫格应有候选按钮');

  // 悬停候选 → 实时预览（不进撤销栈）
  const target = App.pickerCandidates[0].i;
  btns[0].emit('mouseover');
  assert.equal(grid[0], target, '悬停候选应立即预览颜色');
  assert.equal(App.undoStack.length, 0, '预览不应进入撤销栈');

  // 移出弹窗 → 还原原始颜色
  elsMap['quick-picker'].emit('mouseleave');
  assert.equal(grid[0], 0, '移出弹窗应还原原始颜色');

  // 再次悬停并点击 → 提交改色，记一步撤销
  btns[0].emit('mouseover');
  btns[0].emit('click');
  assert.equal(grid[0], target, '点击候选应提交改色');
  assert.equal(App.undoStack.length, 1, '提交应记一步撤销');
  hooks.doUndo();
  assert.equal(grid[0], 0, '撤销后应恢复原色');
  console.log('[OK] D 键九宫格：悬停预览 + 点击确认记一步');
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

  elsMap['dlg-legend'].checked = true; // 桩默认未勾选，手动开启图例
  hooks.openExportDialog();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(elsMap['dlg-preview'].width > 0 && elsMap['dlg-preview'].height > 0, '导出对话框应显示实时预览');
  assert.ok(drawLog.texts.some((t) => /^\S+ × \d+$/.test(t.text)),
    `图例文字应为「色号 × 数量」格式，实际 ${JSON.stringify(drawLog.texts.map((t) => t.text))}`);
  elsMap['export-dialog'].classList.add('hidden'); // 关闭弹窗，避免影响后续 Escape 测试
  console.log('[OK] 导出预览与「有未保存的修改」提示');
}

// ---------------- 画笔未选色：默认取调色板最暗色并进入画笔模式 ----------------
{
  seedProject();
  App.tool = 'select';
  App.brushColor = null;
  elsMap['tool-brush'].emit('click');
  assert.equal(App.brushColor, 2, '未选色按画笔应默认选调色板最暗色（蓝 #0000FF）');
  assert.equal(App.tool, 'brush', '未选色按画笔也应进入画笔模式');
  assert.ok(elsMap['brush-label'].textContent.includes('#0000FF'), '画笔标签应显示默认深色');
  console.log('[OK] 画笔未选色：默认取调色板最暗色并进入画笔模式');
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
  assert.equal(App.settings.compare, false, '无原图时不应开启对比');
  assert.equal(elsMap['chk-compare'].checked, false, '无原图时勾选对比应被回退');

  elsMap['chk-sync-pan'].checked = true;
  elsMap['chk-sync-pan'].emit('change');
  assert.equal(App.settings.compare, false, '无原图时同步拖拽不应自动开启对比');
  assert.equal(App.settings.syncPan, false, '无原图时同步拖拽不应生效');
  assert.equal(elsMap['chk-sync-pan'].checked, false, '无原图时勾选同步应被回退');
  console.log('[OK] 对比原图 / 同步拖拽守卫');
}

// ---------------- 10. 同步换算：格放大 × 降采样系数，取消对比联动取消同步 ----------------
{
  seedProject();
  App.screenCell = 28;
  // 拼豆网格 48 格，原图显示宽 96px：整张网格 ↔ 整张原图，1 格对应 2 个显示像素
  App.project.width = 48;
  App.project.height = 48;
  elsMap['canvas-original'].width = 96;
  elsMap['canvas-original'].height = 96;
  App.pan = { x: 100, y: 50 };
  App.zoom = 1;

  hooks.mirrorBeadToOrig();
  assert.equal(App.origZoom, 14, '原图 zoom 应为 拼豆 zoom × 28 × (网格宽48/原图显示宽96)');
  assert.equal(App.origPan.x, 128, '原图 pan.x 应包含 1 格行列号条偏移（100 + 1×28×1）');
  assert.equal(App.origPan.y, 78, '原图 pan.y 应包含 1 格行列号条偏移（50 + 1×28×1）');

  App.origPan = { x: 128, y: 78 };
  App.origZoom = 14;
  hooks.mirrorOrigToBead();
  assert.equal(App.zoom, 1, '反向换算应还原拼豆 zoom');
  assert.equal(App.pan.x, 100, '反向换算应还原拼豆 pan.x');
  assert.equal(App.pan.y, 50, '反向换算应还原拼豆 pan.y');

  // 取消对比原图 → 同步拖拽应一并取消
  App.originalImage = { naturalWidth: 48, naturalHeight: 48 };
  App.settings.compare = true;
  App.settings.syncPan = true;
  elsMap['chk-compare'].checked = true;
  elsMap['chk-sync-pan'].checked = true;
  elsMap['chk-compare'].checked = false;
  elsMap['chk-compare'].emit('change');
  assert.equal(App.settings.syncPan, false, '取消对比后同步拖拽应一并取消');
  assert.equal(elsMap['chk-sync-pan'].checked, false, '取消对比后同步勾选框应被取消');
  assert.equal(App.settings.compare, false, '取消对比后对比状态应关闭');
  console.log('[OK] 同步换算含网格/原图比例 / 取消对比联动取消同步');
}

// ---------------- 11. 鼠标指向像素的 hover 边框 ----------------
{
  seedProject();
  App.tool = 'select';
  App.hoverCell = null;
  App.selection.clear();
  App.highlightColor = null;
  hooks.renderAll();
  canvasRectForCells();

  // 选择模式：黑白相间虚线
  const mm = windowListeners['mousemove'][0];
  drawLog.strokes = [];
  mm(mouseAt(1, 1));
  assert.deepEqual(App.hoverCell, { x: 1, y: 1 }, '鼠标移动应记录指向的格子');
  const rectStrokes = drawLog.strokes.filter((s) => s.rect && s.dash);
  assert.equal(rectStrokes.length, 2, '选择模式 hover 应绘制两遍虚线边框（黑 + 白）');
  assert.equal(rectStrokes[0].style.toLowerCase(), '#000000', '第一遍应为黑色');
  assert.equal(rectStrokes[1].style.toLowerCase(), '#ffffff', '第二遍应为白色');
  assert.ok(rectStrokes[0].dash && rectStrokes[0].dash[0] > 0, '选择模式应使用虚线');
  assert.ok(rectStrokes[1].dashOffset > 0, '第二遍虚线应错开半个周期');
  assert.ok(rectStrokes[0].x >= 56 && rectStrokes[0].y >= 56, 'hover 边框应位于指向格子的画布坐标（含 1 格行列号条）');

  // 取色模式：3D 凸起效果（高光斜面 / 暗斜面 / 投影），不再使用虚线
  App.tool = 'picker';
  drawLog.strokes = [];
  hooks.renderAll();
  const picker3D = drawLog.strokes.filter((s) =>
    s.style.includes('rgba(255, 255, 255, 0.85)') ||
    s.style.includes('rgba(0, 0, 0, 0.45)') ||
    s.style.includes('rgba(0, 0, 0, 0.35)'));
  assert.ok(picker3D.length >= 3, '取色模式应绘制 3D 凸起（高光斜面 / 暗斜面 / 投影）');
  assert.equal(drawLog.strokes.filter((s) => s.rect && s.style.startsWith('rgba(')).length, 0,
    '取色模式不应再绘制虚线边框');

  // 画笔模式：每格颜色边框 + 外圈黑色细实线 + 右下阴影
  App.tool = 'brush';
  App.brushColor = 0; // 白色
  drawLog.strokes = [];
  hooks.renderAll();
  const brushRects = drawLog.strokes.filter((s) => s.rect
    && (s.style.toLowerCase() === 'rgb(255, 255, 255)' || s.style.toLowerCase() === '#000000'));
  assert.equal(brushRects.length, 2, '尺寸 1 画笔应绘制每格颜色边框 + 外圈黑色细实线');
  assert.ok(brushRects.some((s) => s.style.toLowerCase() === 'rgb(255, 255, 255)'), '每格边框应为画笔颜色');
  assert.ok(brushRects.some((s) => s.style.toLowerCase() === '#000000'), '外圈应为黑色细实线');
  assert.ok(drawLog.strokes.some((s) => s.style.includes('rgba(0, 0, 0, 0.35)')), '画笔模式应有右下阴影');

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
  assert.equal(drawLog.strokes.filter((s) => s.rect && s.style.startsWith('rgba(')).length, 0,
    '橡皮指向空位时不应绘制 hover 边框');

  // 鼠标离开画布区应清除 hover
  App.hoverCell = { x: 1, y: 1 };
  const leave = elsMap['canvas-scroll'].listeners['mouseleave'][0];
  leave({});
  assert.equal(App.hoverCell, null, '鼠标离开画布区应清除 hover');

  // hover 线宽随缩放等比变化：画布线宽只由格尺寸决定，屏幕粗细交给 CSS 缩放
  App.tool = 'select';
  App.hoverCell = { x: 1, y: 1 };
  App.zoom = 0.5;
  drawLog.strokes = [];
  hooks.renderAll();
  const zoomRects = drawLog.strokes.filter((s) => s.rect && s.dash);
  assert.equal(zoomRects[0].lineWidth, 1, '缩放 0.5 时画布线宽应保持格尺寸比例（1px 细线）');
  App.zoom = 1;
  App.hoverCell = null;
  console.log('[OK] 鼠标 hover 边框：选择 / 画笔 / 取色 / 橡皮');
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
  assert.ok(blockEdges.every((s) => !s.rect), '高亮外轮廓应为线条绘制而非逐格描边');

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
  App.settings.brushSize = 1;
  App.selection.clear();
  App.highlightColor = null;

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

  // 橡皮 hover：尺寸 3 在角落 (0,0) 时，边框与 X 仍按完整 5×5 绘制（不因裁剪形变）
  App.tool = 'eraser';
  App.hoverCell = { x: 0, y: 0 };
  App.settings.brushSize = 3;
  drawLog.strokes = [];
  hooks.renderAll();
  const eraserFrame = drawLog.strokes.filter((s) => s.rect && s.style.startsWith('rgba('));
  assert.equal(eraserFrame.length, 1, '橡皮 hover 应绘制一条边框');
  assert.equal(eraserFrame[0].w, 139, '橡皮 hover 边框宽度应保持完整 5×5（139px），不因角落形变');
  assert.equal(eraserFrame[0].h, 139, '橡皮 hover 边框高度应保持完整 5×5');
  App.hoverCell = null;

  // 画笔 hover 尺寸 3：5×5 共 25 个格子的颜色边框 + 1 条黑色外框（黑色最后绘制，压在最上）
  App.tool = 'brush';
  App.brushColor = 0; // 白色
  App.hoverCell = { x: 2, y: 2 };
  App.settings.brushSize = 3;
  drawLog.strokes = [];
  hooks.renderAll();
  const brushLattice = drawLog.strokes.filter((s) => s.rect);
  const colorRects = brushLattice.filter((s) => s.style.toLowerCase() === 'rgb(255, 255, 255)');
  const blackRects = brushLattice.filter((s) => s.style.toLowerCase() === '#000000');
  assert.equal(colorRects.length, 25, '尺寸 3 应绘制 25 个格子的颜色边框');
  assert.equal(blackRects.length, 1, '应绘制 1 条黑色外框');
  assert.equal(brushLattice[brushLattice.length - 1].style.toLowerCase(), '#000000', '黑色外框应最后绘制');
  App.hoverCell = null;
  App.settings.brushSize = 1;
  hooks.setTool('select');
  console.log('[OK] 画笔 / 橡皮尺寸：拖动条显示与矩形涂色');
}

// ---------------- 15. 选择模式：单击 / 矩形 / 同色 / Shift / 填充 / 取色 / 九宫格 / 高亮转选区 ----------------
{
  seedProject();
  App.selection.clear();
  App.highlightColor = null;
  App.settings.sameColorSelect = false;
  App.settings.brushSize = 1;
  hooks.setTool('brush');
  assert.ok(elsMap['selection-controls'].classList.contains('hidden'), '画笔模式应隐藏同色选区与选中高亮');
  hooks.setTool('select');
  assert.ok(!elsMap['selection-controls'].classList.contains('hidden'), '选择模式应显示选择控件');
  assert.ok(elsMap['brush-size-wrap'].classList.contains('hidden'), '选择模式应隐藏尺寸拖动条');
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners['mousedown'][0];
  const mm = windowListeners['mousemove'][0];
  const mu = windowListeners['mouseup'][0];
  const kd = windowListeners['keydown'][0];

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
  assert.equal(App.dragPreview, null, '拖拽结束后应清除实时预览');

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
  assert.equal(App.dragPreview, null, '同色选区勾选时不应出现拖拽预览');
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
  App.hoverCell = null; // 多选且无悬停格时 D 不应打开九宫格
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
  App.highlightColor = 0; // 白色
  App.highlightBlink = true;
  hooks.renderAll();
  assert.ok(App.highlightTimer, '高亮应启动闪烁定时器');
  elsMap['select-highlight'].emit('click');
  assert.equal(App.selection.size, 2, '选中高亮颜色应选中该色号全部 2 个像素');
  assert.ok(App.selection.has(0) && App.selection.has(2), '应选中两个白色格子');
  assert.equal(App.highlightColor, null, '选中后应取消高亮');
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
  App.highlightColor = null;
  App.hoverCell = null;
  hooks.renderAll();
  const kd = windowListeners['keydown'][0];
  const esc = { key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault() {} };
  const d = { key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} };

  // 单选一格时：D 作用于选中格（即使悬停其它格），目标格带浮起效果
  App.selection = new Set([0]);
  App.hoverCell = { x: 1, y: 0 };
  kd(d);
  assert.equal(App.pickerCell.p, 0, '单选一格时 D 应作用于选中格 (0,0)');
  drawLog.strokes = [];
  hooks.renderAll();
  const raised = drawLog.strokes.filter((s) =>
    s.style.includes('rgba(255, 255, 255, 0.85)') ||
    s.style.includes('rgba(0, 0, 0, 0.45)') ||
    s.style.includes('rgba(0, 0, 0, 0.35)'));
  assert.ok(raised.length >= 3, '九宫格打开时目标格应绘制浮起效果');
  kd(esc);
  assert.equal(App.pickerCell, null, '关闭九宫格后应清除目标格');

  // 未选中时：D 作用于悬停格
  App.selection.clear();
  App.hoverCell = { x: 1, y: 1 };
  kd(d);
  assert.equal(App.pickerCell.p, 3, '未选中时 D 应作用于悬停格 (1,1)');
  kd(esc);

  // 多选时：D 作用于悬停格
  App.selection = new Set([0, 1]);
  App.hoverCell = { x: 0, y: 1 };
  kd(d);
  assert.equal(App.pickerCell.p, 2, '多选时 D 应作用于悬停格 (0,1)');
  kd(esc);

  // 无悬停格时 D 无效
  App.selection.clear();
  App.hoverCell = null;
  kd(d);
  assert.equal(App.pickerCell, null, '无悬停格时 D 不应打开九宫格');
  App.selection.clear();
  App.hoverCell = null;
  console.log('[OK] D 键优先级：单选格 > 悬停格，目标格浮起效果');
}

// ---------------- 17. 回归：右键单击不触发选择；项目变化关闭九宫格 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection.clear();
  App.highlightColor = null;
  App.hoverCell = null;
  hooks.renderAll();
  canvasRectForCells();
  const md = elsMap['canvas-scroll'].listeners['mousedown'][0];
  const mu = windowListeners['mouseup'][0];

  // 先左键选中一个格子
  md(mouseAt(0, 0));
  mu({});
  assert.equal(App.selection.size, 1, '前置：左键单击应选中一格');

  // 右键单击（不拖动）不应改变选择（也不会误触发取色）
  md({ ...mouseAt(1, 1), button: 2 });
  mu({});
  assert.equal(App.selection.size, 1, '右键单击不应改变选择');

  // 打开九宫格后调整滑块 → 应关闭九宫格并清空目标格
  const kd = windowListeners['keydown'][0];
  kd({ key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(App.pickerCell, '前置：九宫格应打开并设置目标格');
  hooks.applySlider(1);
  assert.ok(elsMap['quick-picker'].classList.contains('hidden'), '调整滑块后应关闭九宫格');
  assert.equal(App.pickerCell, null, '调整滑块后应清空目标格');
  assert.equal(App.selection.size, 0, '调整滑块后应清空选区（与重新压缩一致）');
  App.selection.clear();
  console.log('[OK] 回归：右键单击不触发选择，项目变化关闭九宫格');
}

// ---------------- 18. 批量填充：整块一次提交一步撤销 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection = new Set([0, 1, 2, 3]); // 整个 2x2
  App.highlightColor = null;
  hooks.renderAll();
  elsMap['color-list'].children[2].emit('click'); // 蓝色
  assert.equal(App.undoStack.length, 1, '整块填充应记一步撤销');
  assert.equal(App.undoStack[0].changes.length, 4, '一步应包含 4 个像素的修改');
  assert.ok([0, 1, 2, 3].every((p) => App.project.grid[p] === 2), '4 格都应填成蓝色');
  assert.equal(App.selection.size, 4, '填充后选区应保留');
  hooks.doUndo();
  assert.deepEqual(Array.from(App.project.grid), [0, 1, 0, 1], '撤销后应恢复原图');
  console.log('[OK] 批量填充：整块一次提交一步撤销');
}

// ---------------- 19. 边缘行列号（常驻，四个方向） ----------------
{
  seedProject();
  App.selection.clear();
  App.highlightColor = null;
  drawLog.texts = [];
  hooks.renderAll();
  const digits = drawLog.texts.map((t) => t.text).filter((t) => /^\d$/.test(t));
  assert.equal(digits.length, 8, '2x2 图案应绘制 8 个行列号（上下左右各 1-2）');
  assert.ok(digits.includes('1') && digits.includes('2'), '行列号应包含 1 与 2');
  console.log('[OK] 边缘行列号：常驻四个方向');
}

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
  assert.ok(elsMap['doc-content'].innerHTML.includes('问题修复方案'), '文档应渲染出「问题修复方案」');
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
  const blackCornerDay = drawLog.fills.filter((f) => f.style.toLowerCase() === '#000000' && f.x === 0 && f.y === 0);
  assert.equal(blackCornerDay.length, 0, '日间模式不应绘制黑色四角');
  rootEl.dataset.theme = 'dark';
  seedProject();
  drawLog.fills = [];
  hooks.renderAll();
  const blackCornerNight = drawLog.fills.filter((f) => f.style.toLowerCase() === '#000000' && f.x === 0 && f.y === 0);
  assert.equal(blackCornerNight.length, 0, '夜间模式四角也不应绘制黑色（改为透明）');
  rootEl.dataset.theme = 'light';
  console.log('[OK] 日间/夜间模式：切换与按钮文案');
}

// ---------------- 22. 快捷键 Q/W/E 工具切换与 Delete 清除选区 ----------------
{
  const kd = windowListeners['keydown'][0];
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
  kd({ key: 'q', ctrlKey: false, metaKey: false, target: { tagName: 'INPUT' }, preventDefault: prevent });
  assert.equal(App.tool, 'select', '输入框内 Q 不应切换工具');
  // Delete：清除选中格为空位，记一步撤销且保留选区
  hooks.setTool('select');
  seedProject();
  App.selection = new Set([0, 1, 2, 3]);
  App.undoStack = [];
  App.redoStack = [];
  kd({ key: 'Delete', ctrlKey: false, metaKey: false, target: null, preventDefault: prevent });
  assert.ok([0, 1, 2, 3].every((p) => App.project.grid[p] === -1), 'Delete 应把选中格清为空位');
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
  assert.ok(globalThis.document.body.classList.contains('crop-active'), '裁剪模式应给工作区加蒙版类');
  assert.deepEqual(App.crop, { x0: 0, y0: 0, x1: 1, y1: 1 }, '初始矩形应为整图');
  hooks.moveCropEdgeTo('left', 1);
  assert.equal(App.crop.x0, 1, '左边应移动到第 1 条格线');
  hooks.moveCropEdgeTo('bottom', 1);
  assert.equal(App.crop.y1, 0, '底边应移动到第 1 条格线');
  hooks.moveCropEdgeTo('right', 0);
  assert.equal(App.crop.x1, 1, '右边不能越过左边');

  // 自动裁剪：带空位的图案 → 收缩到非空格包围盒
  App.project.grid = Int16Array.from([0, -1, -1, 2]);
  hooks.autoCrop();
  assert.deepEqual(App.crop, { x0: 0, y0: 0, x1: 1, y1: 1 }, '自动裁剪应收缩到非空格包围盒');

  // 应用：裁剪左上角 1x1（网格 [0,-1,-1,2] → [0]）
  hooks.moveCropEdgeTo('bottom', 0);
  hooks.moveCropEdgeTo('right', 0);
  hooks.applyCrop();
  assert.equal(App.tool, 'select', '应用后应回到选择模式');
  assert.ok(!globalThis.document.body.classList.contains('crop-active'), '退出裁剪后应移除工作区蒙版类');
  assert.equal(App.project.width, 1, '应用后宽度应为 1');
  assert.equal(App.project.height, 1, '应用后高度应为 1');
  assert.deepEqual(Array.from(App.project.grid), [0], '应用后网格应为裁剪结果');
  assert.equal(App.history.items.length, 1, '应生成裁剪前事务快照');
  assert.ok(App.history.items[0].label.includes('裁剪前'), '快照标签应为「裁剪前」');
  assert.equal(App.undoStack.length, 1, '应记录一步结构型撤销');
  assert.ok(elsMap['crop-controls'].classList.contains('hidden'), '退出裁剪后应隐藏自动裁剪/应用按钮');
  hooks.doUndo();
  assert.equal(App.project.width, 2, '撤销裁剪应恢复宽度');
  assert.deepEqual(Array.from(App.project.grid), [0, -1, -1, 2], '撤销应恢复网格');

  // ESC 退出裁剪不应用
  hooks.setTool('crop');
  hooks.moveCropEdgeTo('left', 1);
  const kd = windowListeners['keydown'][0];
  kd({ key: 'Escape', ctrlKey: false, metaKey: false, target: null, preventDefault: () => {} });
  assert.equal(App.tool, 'select', 'ESC 应退出裁剪模式');
  assert.equal(App.crop, null, 'ESC 退出后裁剪状态应清空');
  assert.equal(App.project.width, 2, 'ESC 不应应用裁剪');

  // 光标与预览：悬停边显示双箭头；图片之外取消选择；选中边时显示预览虚线
  hooks.setTool('crop');
  const cv = elsMap['canvas'];
  canvasRectForCells();
  const cellSz = App.screenCell;
  const scale2 = cv.getBoundingClientRect().width / cv.width;
  const edgeX = 1 * cellSz * scale2; // 左边缘格线
  const midY = 1.5 * cellSz * scale2;
  hooks.updateCropCursor({ clientX: edgeX, clientY: midY });
  assert.equal(cv.style.cursor, 'ew-resize', '悬停左边缘应显示左右调整光标');
  App.cropActiveEdge = 'left';
  drawLog.strokes = [];
  hooks.updateCropPreview({ clientX: 2 * cellSz * scale2, clientY: midY });
  assert.deepEqual(App.cropPreview, { horizontal: true, pos: 1 }, '预览应记录水平格线位置 1');
  assert.ok(drawLog.strokes.some((s) => s.style === '#ff3b30' && s.dash && s.dash.length), '应绘制红色预览虚线');
  // 选中边且鼠标在图案内（不在线上）也显示双箭头
  App.cropActiveEdge = 'bottom';
  hooks.updateCropCursor({ clientX: 1.5 * cellSz * scale2, clientY: midY });
  assert.equal(cv.style.cursor, 'ns-resize', '选中底边后鼠标在图案内应显示上下调整光标');
  // 拖拽中不显示预览虚线
  App.cropActiveEdge = 'left';
  globalThis.__dragState.cropEdge = 'left';
  App.cropPreview = { horizontal: true, pos: 1 };
  drawLog.strokes = [];
  hooks.renderAll();
  assert.ok(!drawLog.strokes.some((s) => s.style === '#ff3b30' && s.dash && s.dash.length), '拖拽中不应绘制红色预览虚线');
  globalThis.__dragState.cropEdge = null;
  // 拖拽结束后取消选中；单击（未拖拽）保持选中
  const mu = windowListeners['mouseup'][0];
  App.cropActiveEdge = 'left';
  globalThis.__dragState.active = true;
  globalThis.__dragState.cropEdge = 'left';
  globalThis.__dragState.moved = true;
  mu({});
  assert.equal(App.cropActiveEdge, null, '拖拽结束后应取消选中该边');
  App.cropActiveEdge = 'left';
  globalThis.__dragState.active = true;
  globalThis.__dragState.cropEdge = 'left';
  globalThis.__dragState.moved = false;
  mu({});
  assert.equal(App.cropActiveEdge, 'left', '单击（未拖拽）应保持边选择');
  // 鼠标在图片之外：保留边选择与预览位置并继续显示双箭头；仅点击才取消
  hooks.updateCropPreview({ clientX: 2 * cellSz * scale2, clientY: midY });
  assert.deepEqual(App.cropPreview, { horizontal: true, pos: 1 }, '前置：预览应已设置');
  hooks.updateCropCursor({ clientX: -100, clientY: -100 });
  assert.equal(App.cropActiveEdge, 'left', '鼠标在图片之外不应取消边选择');
  assert.equal(cv.style.cursor, 'ew-resize', '图片之外选中左边时应继续显示左右调整光标');
  hooks.updateCropPreview({ clientX: -100, clientY: -100 });
  assert.deepEqual(App.cropPreview, { horizontal: true, pos: 1 }, '鼠标移出图片后预览位置应保留');
  const mdOut = elsMap['canvas-scroll'].listeners['mousedown'][0];
  mdOut({ button: 0, clientX: -100, clientY: -100, target: elsMap['canvas'], shiftKey: false, preventDefault() {} });
  assert.equal(App.cropActiveEdge, null, '点击图片之外应取消边选择');

  // 拖拽移动边：按下命中边 → 拖动 → 松开
  App.crop = { x0: 0, y0: 0, x1: 1, y1: 1 };
  App.cropActiveEdge = null;
  App.cropPreview = null;
  const mdDrag = elsMap['canvas-scroll'].listeners['mousedown'][0];
  const mmDrag = windowListeners['mousemove'][0];
  const muDrag = windowListeners['mouseup'][0];
  const dragY = 1.5 * cellSz * scale2;
  mdDrag({ button: 0, clientX: edgeX, clientY: dragY, target: elsMap['canvas'], shiftKey: false, preventDefault() {} });
  assert.equal(App.cropActiveEdge, 'left', '按下左边缘应选中该边');
  assert.equal(globalThis.__dragState.cropEdge, 'left', '按下左边缘应进入拖拽状态');
  mmDrag({ clientX: 2 * cellSz * scale2, clientY: dragY, button: 0 });
  assert.equal(App.crop.x0, 1, '拖拽应把左边移动到格线');
  muDrag({});
  assert.equal(App.cropActiveEdge, null, '拖拽结束应取消边选中');
  assert.equal(App.cropPreview, null, '拖拽结束后预览应清空');

  // 放大镜：低缩放显示、正常缩放隐藏
  hooks.setTool('crop');
  App.screenCell = 8;
  App.zoom = 1;
  App.hoverCell = { x: 0, y: 0 };
  hooks.updateCropMagnifier({ clientX: 100, clientY: 100 });
  assert.ok(!elsMap['crop-magnifier'].classList.contains('hidden'), '低缩放时应显示放大镜');
  assert.equal(elsMap['crop-magnifier-canvas'].width, 11 * 20, '放大镜应为 11×11，每格 20px');
  App.zoom = 2;
  hooks.updateCropMagnifier({ clientX: 100, clientY: 100 });
  assert.ok(elsMap['crop-magnifier'].classList.contains('hidden'), '正常缩放应隐藏放大镜');
  App.zoom = 1;
  console.log('[OK] 裁剪工具：进入/移动边/自动裁剪/应用/退出与放大镜');
}

// ---------------- 25. 缩放细节阈值：细线/色号与粗虚线/实线分层隐藏 ----------------
{
  seedProject();
  hooks.setTool('select');
  App.crop = null;
  App.cropActiveEdge = null;
  App.cropPreview = null;
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
  assert.ok(gray(drawLog.strokes).some((s) => isDash(s)), '正常缩放应绘制每 5 格虚线');

  App.zoom = Math.max(0.05, 7 / baseCell); // 格屏宽 ≈ 7：细线与色号隐藏，粗线保留
  drawLog.strokes = [];
  drawLog.texts = [];
  hooks.renderAll();
  assert.equal(thinGray(gray(drawLog.strokes)).length, 0, '格屏宽 < 8 时细线应隐藏');
  assert.ok(gray(drawLog.strokes).some((s) => isDash(s)), '格屏宽 < 8 时每 5 格虚线仍应保留');
  assert.ok(!drawLog.texts.some((t) => /^0/.test(String(t.text))), '格屏宽 < 8 时色号应隐藏');

  App.zoom = Math.max(0.05, 3 / baseCell); // 格屏宽 ≈ 3：粗虚线/实线也隐藏
  drawLog.strokes = [];
  hooks.renderAll();
  assert.equal(gray(drawLog.strokes).length, 0, '格屏宽 < 4 时粗线也应隐藏');
  App.zoom = 1;
  console.log('[OK] 缩放细节阈值：细线/色号与粗虚线/实线分层隐藏');
}

// ---------------- 26. 目标像素量下拉预设 ----------------
{
  elsMap['target-pixels-menu'].classList.add('hidden');
  elsMap['target-pixels-btn'].emit('click');
  assert.ok(!elsMap['target-pixels-menu'].classList.contains('hidden'), '点击箭头应展开菜单');
  assert.equal(elsMap['target-pixels-menu'].children.length, 4, '应渲染 4 个预设项');
  const opt = elsMap['target-pixels-menu'].children[0];
  assert.equal(opt.title, '初次尝试拼豆的儿童建议不超过 500', '预设项应带悬浮提示');
  elsMap['target-pixels'].value = '';
  opt.emit('click');
  assert.equal(elsMap['target-pixels'].value, '500', '点击预设应写入输入框');
  assert.ok(elsMap['target-pixels-menu'].classList.contains('hidden'), '选择后应关闭菜单');

  // 箭头可再次展开；输入框文本区不弹菜单，仅直接编辑数值
  elsMap['target-pixels-menu'].classList.add('hidden');
  elsMap['target-pixels'].emit('mousedown', { button: 0 });
  assert.ok(elsMap['target-pixels-menu'].classList.contains('hidden'), '点击输入框文本区不应展开菜单');
  elsMap['target-pixels'].value = '1234';
  elsMap['target-pixels'].emit('input');
  assert.equal(elsMap['target-pixels'].value, '1234', '输入框应仍可直接输入数值');
  console.log('[OK] 目标像素量下拉预设');
}

console.log('\nDOM 行为测试全部通过');
process.exit(0);
