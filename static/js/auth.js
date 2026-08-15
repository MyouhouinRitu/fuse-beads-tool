// Token 认证：登录/登出与启动时的认证守卫。

import * as api from './api.js';
import { els } from './els.js';
import { closeDialog, openDialog } from './focus.js';

let authResolve = null;

function showLoginError(msg) {
  els.loginError.textContent = msg;
  els.loginError.classList.remove('hidden');
}

export async function tryLogin() {
  const token = els.loginToken.value.trim();
  if (!token) {
    showLoginError('请输入 Token');
    return;
  }
  try {
    await api.login(token);
  } catch (e) {
    showLoginError(e.message || 'Token 不正确');
    return;
  }
  els.loginError.classList.add('hidden');
  els.loginToken.value = '';
  els.loginMask.classList.add('hidden');
  els.btnLogout.classList.remove('hidden');
  closeDialog();
  const resolve = authResolve;
  authResolve = null;
  if (resolve) resolve();
}

export async function ensureAuth() {
  let status = { authenticated: true, requiresAuth: false };
  try {
    status = await api.authStatus();
  } catch (_e) {
    // 后端不可用时按需展示登录框，由后续请求报错
  }
  if (status.authenticated) {
    els.btnLogout.classList.toggle('hidden', !status.requiresAuth);
    return;
  }
  return new Promise((resolve) => {
    authResolve = resolve;
    els.loginMask.classList.remove('hidden');
    openDialog(els.loginMask);
    els.loginToken.focus();
  });
}
