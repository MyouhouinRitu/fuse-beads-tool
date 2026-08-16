// 通用弹层工具：模态确认 / 输入对话框。
// 统一行为：Escape = 取消；点击遮罩 = 取消；Tab 焦点圈定在弹窗内。

import { els } from './els.js';
import { hideDialog, showDialog } from './focus.js';

let state = null;
const queue = [];

function showRequest({ title, message, okText, cancelText, input, fallback = '', resolve }) {
  els.popupTitle.textContent = title;
  els.popupMessage.textContent = message;
  els.popupOk.textContent = okText;
  els.popupCancel.textContent = cancelText;
  els.popupInput.classList.toggle('hidden', !input);
  if (input) els.popupInput.value = fallback ?? '';
  els.popupError.classList.add('hidden');
  els.popupInput.removeAttribute('aria-invalid');
  state = { input, resolve };
  showDialog(els.popupDialog);
  if (input) els.popupInput.focus();
  else els.popupOk.focus();
}

function openNext() {
  if (state || !queue.length) return;
  showRequest(queue.shift());
}

function finish(result) {
  if (!state) return;
  const { resolve } = state;
  state = null;
  hideDialog(els.popupDialog);
  resolve(result);
  openNext();
}

export function isPopupOpen() {
  return !!state;
}

export function confirmPopup() {
  if (!state) return;
  if (state.input) {
    const value = els.popupInput.value;
    if (!String(value).trim()) {
      els.popupError.textContent = '不能为空';
      els.popupError.classList.remove('hidden');
      els.popupInput.setAttribute('aria-invalid', 'true');
      els.popupInput.focus();
      return;
    }
    els.popupError.classList.add('hidden');
    els.popupInput.removeAttribute('aria-invalid');
    finish(value);
    return;
  }
  finish(true);
}

export function cancelPopup() {
  finish(null);
}

export function confirmDialog(message, options = {}) {
  // 测试环境注入自动确认结果，跳过真实弹窗
  if (typeof globalThis.__popupAutoConfirm !== 'undefined') {
    return Promise.resolve(!!globalThis.__popupAutoConfirm);
  }
  return new Promise((resolve) => {
    queue.push({
      title: options.title || '确认',
      message,
      okText: options.okText || '确定',
      cancelText: options.cancelText || '取消',
      input: false,
      resolve,
    });
    openNext();
  });
}

export function promptDialog(message, fallback = '', options = {}) {
  if (typeof globalThis.__popupAutoConfirm !== 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    queue.push({
      title: options.title || '输入',
      message,
      okText: options.okText || '确定',
      cancelText: options.cancelText || '取消',
      input: true,
      fallback,
      resolve,
    });
    openNext();
  });
}

els.popupOk.addEventListener('click', confirmPopup);
els.popupCancel.addEventListener('click', cancelPopup);
els.popupInput.addEventListener('input', () => {
  els.popupError.classList.add('hidden');
  els.popupInput.removeAttribute('aria-invalid');
});
els.popupDialog.addEventListener('click', (e) => {
  if (e.target === els.popupDialog) cancelPopup();
});
els.popupDialog.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !state) return;
  e.preventDefault();
  if (document.activeElement === els.popupCancel) cancelPopup();
  else confirmPopup();
});
