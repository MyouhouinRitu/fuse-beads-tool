// 日间/夜间模式：读取偏好、应用主题并持久化。

import { redrawCanvas } from './canvas.js';
import { THEME_STORAGE_KEY } from './constants.js';
import { refreshCropMagnifier } from './crop.js';
import { els } from './els.js';
import { App } from './state.js';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.btnTheme.textContent = theme === 'dark' ? '☀ 日间模式' : '🌙 夜间模式';
  els.btnTheme.title =
    theme === 'dark' ? '当前为夜间模式，点击切换为日间' : '当前为日间模式，点击切换为夜间';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_e) {
    // localStorage 不可用时（如隐私模式）忽略，仅本次会话生效
  }
  if (App.project) redrawCanvas(); // 工作区四角颜色随主题重绘
  refreshCropMagnifier();
}

export function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}
