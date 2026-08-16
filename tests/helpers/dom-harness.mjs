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
globalThis.__popupAutoConfirm = true;

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...cs) {
    cs.forEach((c) => this.set.add(c));
  }
  remove(...cs) {
    cs.forEach((c) => this.set.delete(c));
  }
  toggle(c, force) {
    if (force === undefined) {
      if (this.set.has(c)) this.set.delete(c);
      else this.set.add(c);
    } else if (force) this.set.add(c);
    else this.set.delete(c);
  }
  contains(c) {
    return this.set.has(c);
  }
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
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  setAttribute(name, value) {
    this[name] = String(value);
  }
  getAttribute(name) {
    return this[name] ?? null;
  }
  removeAttribute(name) {
    delete this[name];
  }
  // className 与 classList 双向同步（模拟真实 DOM）
  get className() {
    return [...this.classList.set].join(' ');
  }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get innerHTML() {
    return this._innerHTML;
  }
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
  append(...cs) {
    cs.forEach((c) => this.appendChild(c));
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  getBoundingClientRect() {
    const r = this._rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }
  emit(type, event = {}) {
    // 模拟 DOM 事件冒泡：沿 parentNode 逐级触发监听器
    let el = this;
    while (el) {
      for (const fn of [...(el.listeners[type] || [])])
        fn({ target: this, currentTarget: el, ...event });
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
  querySelectorAll(sel) {
    const out = [];
    const walk = (el) => {
      if (el !== this && matchesSelector(el, sel)) out.push(el);
      for (const c of el.children || []) walk(c);
    };
    walk(this);
    return out;
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
  if (tagM) {
    tag = tagM[0].toLowerCase();
    rest = rest.slice(tagM[0].length);
  }
  const classes = [];
  const ids = [];
  const attrs = [];
  for (;;) {
    const idM = rest.match(/^#([\w-]+)/);
    if (idM) {
      ids.push(idM[1]);
      rest = rest.slice(idM[0].length);
      continue;
    }
    const clsM = rest.match(/^\.([\w-]+)/);
    if (clsM) {
      classes.push(clsM[1]);
      rest = rest.slice(clsM[0].length);
      continue;
    }
    const attrM = rest.match(/^\[([\w-]+)(?:="([^"]*)")?\]/);
    if (attrM) {
      attrs.push([attrM[1], attrM[2] ?? null]);
      rest = rest.slice(attrM[0].length);
      continue;
    }
    break;
  }
  if (rest.trim() !== '') throw new Error(`stub 不支持的 selector: ${sel}`);
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
  get canvas() {
    return elsMap.canvas;
  },
  _fillStyle: '#000000',
  get fillStyle() {
    return this._fillStyle;
  },
  set fillStyle(v) {
    this._fillStyle = v;
  },
  _strokeStyle: '#000000',
  get strokeStyle() {
    return this._strokeStyle;
  },
  set strokeStyle(v) {
    this._strokeStyle = v;
  },
  _lineWidth: 1,
  get lineWidth() {
    return this._lineWidth;
  },
  set lineWidth(v) {
    this._lineWidth = v;
  },
  _lineDash: null,
  _lineDashOffset: 0,
  get lineDashOffset() {
    return this._lineDashOffset;
  },
  set lineDashOffset(v) {
    this._lineDashOffset = v;
  },
  fillRect(x, y, w, h) {
    drawLog.fills.push({ style: this._fillStyle, x, y, w, h });
  },
  beginPath() {},
  moveTo() {},
  lineTo() {},
  ellipse() {},
  rect() {},
  clip() {},
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
      x,
      y,
      w,
      h,
      dash: this._lineDash ? [...this._lineDash] : null,
      dashOffset: this._lineDashOffset,
    });
  },
  setLineDash(v) {
    this._lineDash = [...v];
  },
  measureText(text) {
    return { width: String(text).length * 7 };
  },
  fillText(text, x, y) {
    drawLog.texts.push({ text: String(text), x, y, fillStyle: this._fillStyle });
  },
  fill() {},
  save() {
    this._savedDash = this._lineDash ? [...this._lineDash] : null;
    this._savedDashOffset = this._lineDashOffset;
  },
  restore() {
    this._lineDash = this._savedDash ? [...this._savedDash] : null;
    this._lineDashOffset = this._savedDashOffset || 0;
  },
  getImageData() {
    return { data: new Uint8ClampedArray(0) };
  },
  drawImage() {},
  setTransform() {},
  clearRect() {},
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
  createElement: (tag) => {
    const e = new El();
    e.tagName = String(tag).toUpperCase();
    created.push(e);
    return e;
  },
  createDocumentFragment: () => new El('__fragment__'),
  querySelectorAll: () => [],
  addEventListener: (type, fn) => {
    (windowListeners[type] ||= []).push(fn);
  },
  body: new El('body'),
  activeElement: null,
};

globalThis.window = globalThis;
globalThis.addEventListener = (type, fn) => {
  (windowListeners[type] ||= []).push(fn);
};
// 模拟 rAF：同步执行回调并传入「已到动画结束」的时间戳，
// 使基于 rAF 的动画（如侧边栏位移补偿）在测试中一步完成
globalThis.requestAnimationFrame = (fn) => {
  fn(Infinity);
  return 1;
};
globalThis.confirm = () => confirmResult;
globalThis.prompt = () => null;
globalThis.Image = class {
  constructor() {
    this.width = 100;
    this.height = 80;
  }
  set src(v) {
    this._src = v;
    queueMicrotask(() => this.onload?.());
  }
};

// ---------------- API 桩 ----------------

let stateResponse = {};
let pdfPreviewResponse = { pages: [] };
let pdfPreviewFail = false;
let statePutDelayMs = 0;
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
const createdConfigs = {};

globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('/api/auth/status')) return json({ authenticated: true, requiresAuth: false });
  if (u === '/api/configs' && (!options.method || options.method === 'GET')) {
    return json({ configs });
  }
  if (u === '/api/configs' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    createdConfigs[body.name] = body.colors;
    return json({ ok: true, name: body.name, colors: body.colors });
  }
  if (u.startsWith('/api/configs/') && !options.method) {
    const name = decodeURIComponent(u.split('/api/configs/')[1]);
    return json({ name, colors: createdConfigs[name] || configColors[name] || [] });
  }
  if (u === '/api/state' && (!options.method || options.method === 'GET'))
    return json(stateResponse);
  if (u === '/api/state' && options.method === 'PUT') {
    if (statePutDelayMs > 0) {
      await new Promise((r) => setTimeout(r, statePutDelayMs));
    }
    stateResponse = JSON.parse(options.body);
    return json({ ok: true });
  }
  if (u === '/api/export-preview') {
    if (pdfPreviewFail) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'PDF 预览生成失败：boom' }),
      };
    }
    return json(pdfPreviewResponse);
  }
  if (u.startsWith('/api/originals/') && options.method === 'DELETE') {
    return json({ ok: true });
  }
  if (u.startsWith('/api/originals/')) {
    return { ok: true, status: 200, blob: async () => new Blob(['fake']) };
  }
  if (u === '/api/export') {
    return json({ dataUrl: 'data:image/jpeg;base64,ZmFrZQ==' });
  }
  if (u.includes('/static/docs/right-drag-gesture-fix.md')) {
    return {
      ok: true,
      status: 200,
      text: async () =>
        '## 问题现象\n- 画线不拖拽\n\n## 问题原因\nEdge 鼠标手势。\n\n## 问题修复方案\n1. 添加 http://127.0.0.1',
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
const interactionState = globalThis.__interactionState;
assert.ok(App && hooks, '应暴露调试句柄');
// 模板中带 hidden 类的元素在桩环境里默认是空 classList，这里补上与真实 HTML 一致的初始状态
elsMap['doc-dialog'].classList.add('hidden');
elsMap['fix-menu'].classList.add('hidden');
elsMap['target-pixels-menu'].classList.add('hidden');
elsMap['export-dialog'].classList.add('hidden');
elsMap['palette-dialog'].classList.add('hidden');
elsMap['login-mask'].classList.add('hidden');
elsMap['quick-picker'].classList.add('hidden');
elsMap['popup-dialog'].classList.add('hidden');

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
  interactionState.strokeBuffer = null;
}

function fillStyles() {
  return new Set(drawLog.fills.map((f) => f.style.toLowerCase()));
}

function colorInputs() {
  return created.filter((e) => e.type === 'color');
}

function canvasRectForCells() {
  const cv = elsMap.canvas;
  cv._rect = { left: 0, top: 0, width: cv.width || 800, height: cv.height || 600 };
}

function mouseAt(cellX, cellY) {
  return {
    clientX: (cellX + 1.5) * 28,
    clientY: (cellY + 1.5) * 28,
    button: 0,
    pointerType: 'mouse',
    preventDefault() {},
  };
}

export const testState = {
  get confirmResult() {
    return confirmResult;
  },
  set confirmResult(v) {
    confirmResult = v;
    globalThis.__popupAutoConfirm = v;
  },
  get stateResponse() {
    return stateResponse;
  },
  set stateResponse(v) {
    stateResponse = v;
  },
  get pdfPreviewResponse() {
    return pdfPreviewResponse;
  },
  set pdfPreviewResponse(v) {
    pdfPreviewResponse = v;
  },
  get pdfPreviewFail() {
    return pdfPreviewFail;
  },
  set pdfPreviewFail(v) {
    pdfPreviewFail = v;
  },
  get statePutDelayMs() {
    return statePutDelayMs;
  },
  set statePutDelayMs(v) {
    statePutDelayMs = v;
  },
};

export {
  App,
  canvasRectForCells,
  colorInputs,
  configs,
  createdConfigs,
  drawLog,
  elsMap,
  fillStyles,
  hooks,
  interactionState,
  mouseAt,
  palette3,
  seedProject,
  windowListeners,
};
