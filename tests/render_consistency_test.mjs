// 双端渲染一致性测试：
// 用同一份网格 / 调色板分别让前端 canvas 渲染器（render.js）与后端 PIL 渲染器（export.py）出图，
// 逐像素对比，防止两边参数漂移（网格线规范、行列号条等）。
// 前端行列号条的像素断言在 ui_test 中已有，这里补充后端的结构性采样。
// 运行：node tests/render_consistency_test.mjs
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH || 'C:/Users/myouh/AppData/Local/Temp/pwauth/node_modules/playwright';
const { chromium } = require(pwPath);
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const PORT = 6000 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse_consistency_'));
const DEBUG_LOG = path.join(os.tmpdir(), 'fuse_consistency_debug.log');
const log = (msg) => {
  fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  console.log(msg);
};

// 确定性测试图：9×7，4 色 + 若干空位
const W = 9;
const H = 7;
const PALETTE = { 0: '#E23B3B', 1: '#3B7AE2', 2: '#2E7D32', 3: '#F0F0F0' };
const GRID = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    GRID.push((x + y) % 5 === 0 ? -1 : (x * 3 + y * 2) % 4);
  }
}

const server = spawn('python', ['app.py', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const errors = [];
const watchdog = setTimeout(() => { log('看门狗触发，强制退出'); process.exit(2); }, 120000);
let browser = null;

async function waitReady(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('服务启动超时');
}

function runPython(script, args = []) {
  return execFileSync('python', ['-c', script, ...args], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30000,
  });
}

const BACKEND_RENDER = `
import base64, json, sys
from bead.export import render_pattern
p = json.load(open(sys.argv[1], encoding='utf-8'))
img = render_pattern(p['w'], p['h'], p['grid'], {int(k): v for k, v in p['palette'].items()},
                     cell=p['cell'], grid_lines=p['gridLines'], outer_pad=0, hatch=True,
                     empty_style='default', codes=None, show_codes=False,
                     legend=None, show_legend=False, edge_numbers=False)
sys.stdout.buffer.write(base64.b64encode(img.tobytes()))
`;

function backendRender(gridLines) {
  const spec = path.join(TMP, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ w: W, h: H, grid: GRID, palette: PALETTE, cell: 8, gridLines }));
  return Buffer.from(runPython(BACKEND_RENDER, [spec]).toString(), 'base64');
}

// PIL RGB（3 通道）→ RGBA（补 alpha=255），与前端 canvas getImageData 对齐
function expandRgba(rgbBuf, pixelCount) {
  const out = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    out[i * 4] = rgbBuf[i * 3];
    out[i * 4 + 1] = rgbBuf[i * 3 + 1];
    out[i * 4 + 2] = rgbBuf[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

// 前端渲染：spec 带 pts 时只返回采样点颜色，否则返回整图 base64 + 尺寸
async function frontendRender(page, spec) {
  return page.evaluate(([s]) => {
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    const idx = new Int16Array(s.grid);
    const rgb = new Uint32Array(s.grid.length);
    const hexRgb = (hex) => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    for (let p = 0; p < s.grid.length; p++) {
      if (s.grid[p] < 0) continue;
      const [r, g, b] = hexRgb(s.palette[s.grid[p]]);
      rgb[p] = (r << 16) | (g << 8) | b;
    }
    window.__testHooks.drawPattern(octx, s.w, s.h, idx, rgb, {
      cell: s.cell, outerPad: 0, gridLines: s.gridLines, hatch: true, emptyStyle: 'default',
      edgeNumbers: s.edgeNumbers, showCodes: false, codes: [], legend: [], showLegend: false,
    });
    const d = octx.getImageData(0, 0, off.width, off.height).data;
    if (s.pts) {
      const out = {};
      for (const [name, [x, y]] of Object.entries(s.pts)) {
        const i = (y * off.width + x) * 4;
        out[name] = [d[i], d[i + 1], d[i + 2]];
      }
      return out;
    }
    let b64 = '';
    for (let i = 0; i < d.length; i += 65536) {
      b64 += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + 65536, d.length)));
    }
    return { w: off.width, h: off.height, b64: btoa(b64) };
  }, [spec]);
}

function compare(name, front, back, tol, maxBadRatio) {
  assert.equal(front.length, back.length, `${name}: 两端输出字节数不一致（${front.length} vs ${back.length}）`);
  let bad = 0;
  let maxDiff = 0;
  for (let i = 0; i < front.length; i++) {
    const d = Math.abs(front[i] - back[i]);
    if (d > maxDiff) maxDiff = d;
    if (d > tol) bad++;
  }
  const ratio = bad / front.length;
  console.log(`[数据] ${name}: maxDiff=${maxDiff}，超差(${tol})像素比例=${(ratio * 100).toFixed(3)}%`);
  assert.ok(ratio <= maxBadRatio, `${name}: 差异像素比例 ${(ratio * 100).toFixed(3)}% 超过 ${(maxBadRatio * 100).toFixed(2)}%`);
}

// 后端行列号条 / 网格线规范的结构性采样（前端对应断言见 ui_test）
const BACKEND_STRUCT = `
import json, sys
from bead.export import render_pattern
p = json.load(open(sys.argv[1], encoding='utf-8'))
img = render_pattern(p['w'], p['h'], p['grid'], {int(k): v for k, v in p['palette'].items()},
                     cell=p['cell'], grid_lines=True, outer_pad=0, hatch=True,
                     empty_style='default', codes=None, show_codes=False,
                     legend=None, show_legend=False, edge_numbers=True)
out = {}
for name, (x, y) in p['pts'].items():
    out[name] = list(img.getpixel((x, y)))
print(json.dumps(out, ensure_ascii=False))
`;

async function main() {
  await waitReady(BASE + '/api/configs');
  log('[步骤] 服务就绪');
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/?test=1', { waitUntil: 'networkidle' });
  log('[步骤] 页面加载完成');
  await page.waitForFunction(() => !!(window.__testHooks && window.__testHooks.drawPattern),
    null, { timeout: 5000 });
  log('[步骤] 测试钩子就绪');

  // A：无网格线 → 应几乎逐像素一致（只有空位斜线的极少量抗锯齿差异）
  const specA = { w: W, h: H, grid: GRID, palette: PALETTE, cell: 8, gridLines: false, edgeNumbers: false };
  const frontA = await frontendRender(page, specA);
  log('[步骤] 前端 A 渲染完成');
  const backA = backendRender(false);
  log('[步骤] 后端 A 渲染完成');
  log(`[数据] 前端 A 尺寸 ${frontA.w}×${frontA.h}，字节 ${frontA.b64.length}`);
  const rgbaA = expandRgba(backA, frontA.w * frontA.h);
  compare('无网格线', Buffer.from(frontA.b64, 'base64'), rgbaA, 40, 0.005);

  // B：网格线 / 行列号条规范的结构性采样。
  // canvas 的 1px 线居中绘制、PIL 按整数像素落线，栅格化约定不同，
  // 无法逐像素对比；改为在两端同一逻辑点位采样并分别断言
  // （浅蓝端帽 / 细灰 / 每 5 格粗灰 / 虚线间隔 / 每 10 格实线 / 边缘黑线）。
  const w2 = 14, h2 = 10, cell = 28;
  const grid2 = [];
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) grid2.push((x + y) % 3 === 0 ? (x * 7 + y * 5) % 6 + 1 : -1);
  }
  const palette2 = {
    1: '#E23B3B', 2: '#3B7AE2', 3: '#E2B33B', 4: '#3BE27A', 5: '#9B3BE2', 6: '#E27A3B',
  };
  const ox = cell, oy = cell, gw = w2 * cell, gh = h2 * cell;
  const pts = {
    top_bar_left_endcap: [ox, oy - cell / 2],
    top_bar_right_endcap: [ox + gw - 1, oy - cell / 2],
    left_bar_top_endcap: [ox - cell / 2, oy],
    left_bar_bottom_endcap: [ox - cell / 2, oy + gh - 1],
    pattern_left_edge: [ox, oy + cell / 2],
    pattern_top_edge: [ox + cell / 2, oy],
    top_bar_sep_1: [ox + cell, oy - cell / 2],
    top_bar_sep_5: [ox + 5 * cell, oy - cell / 2],
    pattern_5_dash_on: [ox + 5 * cell, oy + 7],
    pattern_5_dash_gap: [ox + 5 * cell, oy + 21],
    pattern_10_solid: [ox + 10 * cell, oy + 7],
    pattern_thin_1: [ox + cell, oy + 7],
  };
  const specB = { w: w2, h: h2, grid: grid2, palette: palette2, cell, gridLines: true, edgeNumbers: true, pts };
  const frontB = await frontendRender(page, specB);
  log('[步骤] 前端 B 采样完成');
  const specFile = path.join(TMP, 'struct.json');
  fs.writeFileSync(specFile, JSON.stringify(specB));
  const backB = JSON.parse(runPython(BACKEND_STRUCT, [specFile]).toString());
  log('[步骤] 后端 B 采样完成');
  console.log('[数据] 前端采样:', JSON.stringify(frontB));
  console.log('[数据] 后端采样:', JSON.stringify(backB));
  const near = (v, exp, tol = 12) => v.every((c, i) => Math.abs(c - exp[i]) <= tol);
  const nearGray = (v, tol = 60) => near(v, [154, 154, 154], tol);
  const assertBoth = (name, check, msg) => {
    assert.ok(check(frontB[name]), `前端 ${msg}（实际 ${frontB[name]}）`);
    assert.ok(check(backB[name]), `后端 ${msg}（实际 ${backB[name]}）`);
  };
  const lightBlue = [214, 230, 247];
  assertBoth('top_bar_left_endcap', (v) => near(v, lightBlue), '顶条左端帽应为浅蓝');
  assertBoth('top_bar_right_endcap', (v) => near(v, lightBlue), '顶条右端帽应为浅蓝');
  assertBoth('left_bar_top_endcap', (v) => near(v, lightBlue), '左条顶端帽应为浅蓝');
  assertBoth('left_bar_bottom_endcap', (v) => near(v, lightBlue), '左条底端帽应为浅蓝');
  assertBoth('pattern_left_edge', (v) => near(v, [0, 0, 0], 20), '图案左边缘应为黑线');
  assertBoth('pattern_top_edge', (v) => near(v, [0, 0, 0], 20), '图案上边缘应为黑线');
  assertBoth('top_bar_sep_1', nearGray, '顶条分隔应为细灰线');
  assertBoth('top_bar_sep_5', nearGray, '顶条每 5 格应为粗灰实线');
  assertBoth('pattern_5_dash_on', nearGray, '图案每 5 格虚线应有点段');
  assertBoth('pattern_5_dash_gap', (v) => v[0] > 180, '图案每 5 格虚线应有间隔');
  assertBoth('pattern_10_solid', (v) => near(v, [154, 154, 154], 30), '图案每 10 格应为粗灰实线');
  assertBoth('pattern_thin_1', nearGray, '图案格内应为细灰线');
  console.log('[OK] 两端网格线 / 行列号条规范一致：端帽、分隔线、边界、虚线、实线');

  assert.equal(errors.length, 0, '页面出现 JS 错误: ' + errors.join(' | '));
  log('\n双端渲染一致性测试全部通过');
  await browser.close();
}

main().catch((e) => {
  log('测试失败: ' + e);
  if (errors.length) log('页面错误: ' + errors.join(' | '));
  process.exitCode = 1;
}).finally(async () => {
  clearTimeout(watchdog);
  if (browser) await browser.close().catch(() => {});
  server.kill();
  try { fs.unlinkSync(DEBUG_LOG); } catch { /* ignore */ }
});
