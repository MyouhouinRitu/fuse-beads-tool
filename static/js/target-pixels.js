// 目标像素量组合框：预设菜单渲染、↑↓ / Enter / Esc 键盘交互与 aria 同步。

import { TARGET_PIXEL_PRESETS } from './constants.js';
import { els } from './els.js';
import { setProjectDirty } from './state.js';

let targetPixelsActive = -1; // 当前高亮预设（键盘 ↑↓ / Enter 应用）

function targetPixelsOptions() {
  return Array.from(els.targetPixelsMenu.querySelectorAll('[role="option"]'));
}

function setTargetPixelsActive(index, { open = false } = {}) {
  const opts = targetPixelsOptions();
  if (!opts.length) return;
  if (open) els.targetPixelsMenu.classList.remove('hidden');
  targetPixelsActive = Math.max(0, Math.min(index, opts.length - 1));
  opts.forEach((o, i) => {
    o.setAttribute('aria-selected', String(i === targetPixelsActive));
  });
  els.targetPixels.setAttribute('aria-expanded', 'true');
  els.targetPixels.setAttribute('aria-activedescendant', opts[targetPixelsActive].id);
}

export function closeTargetPixelsMenu() {
  els.targetPixelsMenu.classList.add('hidden');
  els.targetPixels.setAttribute('aria-expanded', 'false');
  els.targetPixels.removeAttribute('aria-activedescendant');
  targetPixelsActive = -1;
}

function applyTargetPixelPreset(btn) {
  els.targetPixels.value = String(btn.dataset.value);
  closeTargetPixelsMenu();
  els.targetPixels.focus();
  setProjectDirty(true);
}

function renderTargetPixelOptions() {
  const menu = els.targetPixelsMenu;
  menu.innerHTML = '';
  TARGET_PIXEL_PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', 'false');
    btn.tabIndex = -1;
    btn.id = `target-pixels-option-${p.value}`;
    btn.dataset.value = String(p.value);
    btn.title = p.tip;
    btn.textContent = String(p.value);
    btn.addEventListener('click', () => applyTargetPixelPreset(btn));
    menu.appendChild(btn);
  });
}

export function bindTargetPixels() {
  renderTargetPixelOptions();
  // 箭头展开预设（输入框本身只编辑，光标为文本竖线）
  els.targetPixelsBtn.addEventListener('click', (e) => {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    if (els.targetPixelsMenu.classList.contains('hidden')) {
      const opts = targetPixelsOptions();
      const cur = opts.findIndex((o) => o.dataset.value === els.targetPixels.value);
      setTargetPixelsActive(cur >= 0 ? cur : 0, { open: true });
    } else {
      closeTargetPixelsMenu();
    }
  });
  els.targetPixels.addEventListener('keydown', (e) => {
    const opts = targetPixelsOptions();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (els.targetPixelsMenu.classList.contains('hidden')) {
        const cur = opts.findIndex((o) => o.dataset.value === els.targetPixels.value);
        setTargetPixelsActive(e.key === 'ArrowDown' ? Math.max(0, cur) : Math.max(0, cur), {
          open: true,
        });
      } else {
        const base = targetPixelsActive >= 0 ? targetPixelsActive : 0;
        const next =
          e.key === 'ArrowDown' ? Math.min(opts.length - 1, base + 1) : Math.max(0, base - 1);
        setTargetPixelsActive(next);
      }
      return;
    }
    if (e.key === 'Enter' && !els.targetPixelsMenu.classList.contains('hidden')) {
      if (targetPixelsActive >= 0 && opts[targetPixelsActive]) {
        e.preventDefault();
        e.stopPropagation();
        applyTargetPixelPreset(opts[targetPixelsActive]);
      }
      return;
    }
    if (e.key === 'Escape' && !els.targetPixelsMenu.classList.contains('hidden')) {
      e.preventDefault();
      e.stopPropagation();
      closeTargetPixelsMenu();
    }
  });
}
