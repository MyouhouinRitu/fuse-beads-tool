// 颜色清单高亮面板：按数量列出已用色号，点击高亮对应像素。

import * as canvas from './canvas.js';
import * as C from './colors.js';
import { els } from './els.js';
import { interactionState } from './interaction.js';
import { scheduleCanvasRender } from './render-queue.js';
import { App } from './state.js';
import { updateModeControls } from './tool-state.js';
import { codeOf, countBadge, titleOf } from './utils.js';

// 工作区右侧的颜色清单：点击可高亮图片中对应色号的像素
// 事件委托：容器上只绑定一个 click
export function bindHighlightList() {
  els.highlightColorList.addEventListener('click', (e) => {
    const item = e.target.closest('.hc-item');
    if (!item) return;
    const i = Number(item.dataset.index);
    // 单选：再次点击取消，选择其它色号则替换
    interactionState.highlightColor = interactionState.highlightColor === i ? null : i;
    canvas.syncHighlightBlink();
    renderHighlightColorList();
    scheduleCanvasRender();
    updateModeControls();
  });
}

export function renderHighlightColorList(counts) {
  const list = els.highlightColorList;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  if (!counts && App.project) {
    counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  }
  const entries = [];
  App.appliedPalette.forEach((c, i) => {
    if (counts?.[i]) entries.push({ c, i, count: counts[i] });
  });
  // 按数量正序（数量少的优先，值得修改），数量相同按色号
  entries.sort(
    (a, b) => a.count - b.count || (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : 0),
  );
  for (const { c, i, count } of entries) {
    const item = document.createElement('div');
    item.className = `hc-item${interactionState.highlightColor === i ? ' active' : ''}`;
    item.dataset.index = String(i);
    item.title = `${titleOf(c)} ×${count}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c.hex;
    const code = document.createElement('span');
    code.className = 'hc-code';
    code.textContent = codeOf(c);
    const cnt = document.createElement('span');
    cnt.className = 'hc-count';
    cnt.textContent = countBadge(count);
    item.append(sw, code, cnt);
    frag.appendChild(item);
  }
  list.appendChild(frag);
}
