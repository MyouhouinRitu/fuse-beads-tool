// 侧边栏折叠/展开：偏好持久化、画布位移补偿与过渡动画。

import {
  PANEL_ANIMATION_MS,
  PANEL_COLLAPSED_WIDTH,
  PANEL_FULL_WIDTH,
  PANEL_IDS,
  PANEL_STORAGE_KEY,
} from './constants.js';
import { $ } from './els.js';
import { App, setProjectDirty } from './state.js';
import { applyOriginalTransform, applyTransform } from './view.js';

// 面板 DOM 集中引用：与 els.js 一致，避免散落的 document.getElementById
const PANEL_DOM = {
  'left-panel': {
    panel: $('left-panel'),
    toggle: $('left-panel-toggle'),
    head: $('left-panel-head'),
    expand: $('left-panel-expand'),
  },
  'color-highlight-panel': {
    panel: $('color-highlight-panel'),
    toggle: null,
    head: $('color-highlight-panel-head'),
    expand: $('color-highlight-panel-expand'),
  },
  'right-panel': {
    panel: $('right-panel'),
    toggle: null,
    head: $('right-panel-head'),
    expand: $('right-panel-expand'),
  },
};

function readPanelPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || '{}');
  } catch (_e) {
    return {};
  }
}

function writePanelPrefs(prefs) {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(prefs));
  } catch (_e) {
    // localStorage 不可用时（如隐私模式）忽略，仅本次会话生效
  }
}

export function setPanelCollapsed(id, collapsed) {
  const panel = PANEL_DOM[id]?.panel;
  if (!panel) return;
  let panDelta = 0;
  if (id === 'left-panel' && App.project) {
    // 左侧栏收起/展开会平移整个工作区视口；
    // 反向补偿画布位移，让图案保持在屏幕上的绝对位置不变
    const current = panel.classList.contains('collapsed')
      ? PANEL_COLLAPSED_WIDTH
      : PANEL_FULL_WIDTH[id];
    const target = collapsed ? PANEL_COLLAPSED_WIDTH : PANEL_FULL_WIDTH[id];
    panDelta = current - target;
  }
  panel.classList.toggle('collapsed', collapsed);
  if (panDelta) {
    setProjectDirty(true);
    animatePanCompensation(panDelta);
  }
  const prefs = readPanelPrefs();
  prefs[id] = collapsed;
  writePanelPrefs(prefs);
}

// 与侧边栏宽度过渡同步地平移画布，保证画面在屏幕上保持绝对位置
function animatePanCompensation(delta) {
  const panTo = App.pan.x + delta;
  const origTo = App.originalImage ? App.origPan.x + delta : null;
  const panFrom = App.pan.x;
  const origFrom = App.originalImage ? App.origPan.x : null;
  const start = performance.now();
  const dur = PANEL_ANIMATION_MS;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const k = ease(t);
    App.pan.x = panFrom + (panTo - panFrom) * k;
    if (origFrom != null) App.origPan.x = origFrom + (origTo - origFrom) * k;
    applyTransform();
    applyOriginalTransform();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function togglePanel(id) {
  const dom = PANEL_DOM[id];
  if (!dom) return;
  setPanelCollapsed(id, !dom.panel.classList.contains('collapsed'));
}

export function applyPanelPrefs() {
  const prefs = readPanelPrefs();
  for (const id of PANEL_IDS) {
    const dom = PANEL_DOM[id];
    if (dom && prefs[id]) dom.panel.classList.add('collapsed');
  }
}

export function bindPanelToggles() {
  for (const id of PANEL_IDS) {
    const dom = PANEL_DOM[id];
    if (dom.toggle) dom.toggle.addEventListener('click', () => togglePanel(id));
    // 颜色清单/事务历史：点击整个标题栏即可收起/展开
    if (dom.head) dom.head.addEventListener('click', () => togglePanel(id));
    if (dom.expand) dom.expand.addEventListener('click', () => togglePanel(id));
  }
}
