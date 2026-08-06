import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/myouh/AppData/Local/Temp/pwauth/node_modules/playwright');
const ROOT = 'C:/Users/myouh/Documents/fuse-beads-tool';
const STATE = path.join(ROOT, 'data', 'state.json');
const TOKEN = 'test-token-123';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse_auth_'));
const IMG = path.join(TMP, 't.png');
const code = `
from PIL import Image
img = Image.new('RGB', (48, 48))
for y in range(48):
    for x in range(48):
        c = (229, 57, 53) if x < 16 else ((67, 160, 71) if x < 32 else (30, 136, 229))
        img.putpixel((x, y), c)
img.save(${JSON.stringify(IMG)})
`;
execFileSync('python', ['-c', code]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function startServer(port, extraEnv = {}) {
  const env = { ...process.env, APP_TOKEN: TOKEN, PORT: String(port), ...extraEnv };
  return spawn('python', ['app.py'], { cwd: ROOT, env, stdio: 'ignore' });
}
async function waitReady(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/status`); if (r.ok) return; } catch {}
    await sleep(300);
  }
  throw new Error('服务启动超时');
}
const maskHidden = (page) => page.waitForFunction(() => document.querySelector('#login-mask').classList.contains('hidden'), null, { timeout: 6000 });
const P = () => 5600 + Math.floor(Math.random() * 300);

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
  const p1 = P();
  const s1 = startServer(p1);
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
  assert.ok(!(await page1.locator('#btn-logout').evaluate((el) => el.classList.contains('hidden'))), '登录后应显示退出按钮');
  console.log('[OK] 正确 Token 登录成功');
  await page1.selectOption('#config-select', 'default_48');
  await sleep(300);
  await page1.fill('#target-pixels', '2304');
  await page1.uncheck('#chk-sharpen');
  await page1.uncheck('#chk-codes');
  await page1.setInputFiles('#file-input', IMG);
  await page1.waitForFunction(() => document.querySelector('#canvas')?.width > 0, null, { timeout: 20000 });
  console.log('[OK] 登录后导入图片正常');
  await page1.click('#btn-logout');
  await page1.waitForSelector('#login-mask:not(.hidden)', { timeout: 8000 });
  console.log('[OK] 退出登录后重新要求 Token');
  await ctx1.close();
  s1.kill();
  await sleep(600);

  const p2 = P();
  const s2 = startServer(p2);
  await waitReady(p2);
  const r = await fetch(`http://127.0.0.1:${p2}/api/configs`);
  assert.equal(r.status, 401, '未认证请求应返回 401');
  const st = await (await fetch(`http://127.0.0.1:${p2}/api/auth/status`)).json();
  assert.equal(st.authenticated, false);
  assert.equal(st.requiresAuth, true);
  console.log('[OK] 未认证 API 返回 401，status 正确');
  s2.kill();
  await sleep(600);

  const p3 = P();
  const s3 = startServer(p3, { USE_WAITRESS: '1' });
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
  s3.kill();
  await sleep(500);
  console.log('\nToken 认证全部通过（开发模式 + 生产模式）');
} finally {
  await browser.close();
  try { if (fs.existsSync(STATE)) fs.unlinkSync(STATE); } catch {}
}
