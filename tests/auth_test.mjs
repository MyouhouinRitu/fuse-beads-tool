// Token 认证端到端测试（需要 Playwright + Chromium）。
// 运行：npm run test:auth
// 覆盖：登录门禁 / 错误 Token / 正确 Token / 导入图片 / 退出重登 / 未认证 API 401 / 生产模式（waitress）。

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromium } from './helpers/playwright-loader.mjs';

const ROOT = path.dirname(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
);
const PYTHON = process.env.PYTHON || 'python';
const TOKEN = 'test-token-123';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse_auth_'));
const STATE = path.join(TMP, 'state.json');
const IMG = path.join(TMP, 't.png');
const servers = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = () => 5600 + Math.floor(Math.random() * 300);

function startServer(port, extraEnv = {}) {
  const env = { ...process.env, APP_TOKEN: TOKEN, PORT: String(port), DATA_DIR: TMP, ...extraEnv };
  const proc = spawn(PYTHON, ['app.py'], { cwd: ROOT, env, stdio: 'ignore' });
  servers.push(proc);
  return proc;
}

async function waitReady(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/auth/status`);
      if (r.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(300);
  }
  throw new Error('服务启动超时');
}

const maskHidden = (page) =>
  page.waitForFunction(
    () => document.querySelector('#login-mask').classList.contains('hidden'),
    null,
    { timeout: 6000 },
  );

function stopAllServers() {
  for (const proc of servers) {
    try {
      proc.kill();
    } catch (_e) {
      /* ignore */
    }
  }
}

let exitCode = 0;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const code = `
from PIL import Image
img = Image.new('RGB', (48, 48))
for y in range(48):
    for x in range(48):
        c = (229, 57, 53) if x < 16 else ((67, 160, 71) if x < 32 else (30, 136, 229))
        img.putpixel((x, y), c)
img.save(${JSON.stringify(IMG)})
`;
  execFileSync(PYTHON, ['-c', code]);
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE);

  const p1 = P();
  startServer(p1);
  await waitReady(p1);
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto(`http://127.0.0.1:${p1}`, { waitUntil: 'networkidle' });
  await page1.waitForSelector('#login-mask:not(.hidden)', { timeout: 5000 });
  console.log('[OK] 未登录时显示登录框');
  await page1.fill('#login-token', 'wrong-token');
  await page1.click('#btn-login');
  await page1.waitForSelector('#login-error:not(.hidden)', { timeout: 5000 });
  console.log('[OK] 错误 Token 提示错误');
  await page1.fill('#login-token', TOKEN);
  await page1.click('#btn-login');
  await maskHidden(page1);
  assert.ok(
    !(await page1.locator('#btn-logout').evaluate((el) => el.classList.contains('hidden'))),
    '登录后应显示退出按钮',
  );
  console.log('[OK] 正确 Token 登录成功');
  // 色板配置下拉在 0.5.0 起移入「色板配置」弹窗，需要先打开弹窗再选择
  await page1.click('#btn-config');
  await page1.selectOption('#config-select', 'default_48');
  await page1.click('#palette-dialog-close');
  await sleep(300);
  await page1.fill('#target-pixels', '2304');
  await page1.uncheck('#chk-sharpen');
  await page1.uncheck('#chk-codes');
  await page1.setInputFiles('#file-input', IMG);
  await page1.waitForFunction(() => document.querySelector('#canvas')?.width > 0, null, {
    timeout: 20000,
  });
  console.log('[OK] 登录后导入图片正常');
  await page1.click('#btn-logout');
  await page1.waitForSelector('#login-mask:not(.hidden)', { timeout: 8000 });
  console.log('[OK] 退出登录后重新要求 Token');
  await ctx1.close();
  await sleep(600);

  const p2 = P();
  startServer(p2);
  await waitReady(p2);
  const r = await fetch(`http://127.0.0.1:${p2}/api/configs`);
  assert.equal(r.status, 401, '未认证请求应返回 401');
  const st = await (await fetch(`http://127.0.0.1:${p2}/api/auth/status`)).json();
  assert.equal(st.authenticated, false);
  assert.equal(st.requiresAuth, true);
  console.log('[OK] 未认证 API 返回 401，status 正确');
  await sleep(600);

  const p3 = P();
  startServer(p3, { USE_WAITRESS: '1' });
  await waitReady(p3);
  const ctx3 = await browser.newContext();
  const page3 = await ctx3.newPage();
  await page3.goto(`http://127.0.0.1:${p3}`, { waitUntil: 'networkidle' });
  await page3.waitForSelector('#login-mask:not(.hidden)', { timeout: 5000 });
  await page3.fill('#login-token', TOKEN);
  await page3.click('#btn-login');
  await maskHidden(page3);
  const cfg = await page3.evaluate(() => fetch('/api/configs').then((res) => res.json()));
  assert.ok(cfg.configs && cfg.configs.length > 0, 'waitress 模式下配置接口可用');
  console.log('[OK] 生产模式（waitress）登录与接口正常');
  await ctx3.close();
  console.log('\nToken 认证全部通过（开发模式 + 生产模式）');
} catch (err) {
  exitCode = 1;
  console.error(err);
} finally {
  await browser.close().catch(() => {});
  stopAllServers();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_e) {
    /* ignore */
  }
}

process.exit(exitCode);
