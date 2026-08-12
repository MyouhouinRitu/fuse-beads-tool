// 界面自动化测试（需要本机已安装 Playwright + Chromium）：
//   PLAYWRIGHT_PATH 指向 playwright 包目录；默认使用临时目录中的 playwright@1.57.0。
// 运行：node tests/ui_test.mjs
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
const PORT = 5100 + Math.floor(Math.random() * 300); // 随机端口，避免与残留服务冲突
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse_ui_'));
const IMG = path.join(TMP, 'ui_test.png');
const STATE = path.join(ROOT, 'data', 'state.json');
const OP = 0; // 工作区不再保留外部白边（导出时才使用外部白边）
const CELL = 28; // 默认格子大小（与 render.js CELL 一致）
const MARGIN = 1 * CELL; // 图案外侧 1 格行列号条（原 5 格透明边距已移除）
const ccx = (x) => OP + MARGIN + x * CELL + Math.floor(CELL / 2);
const ccy = (y) => OP + MARGIN + y * CELL + Math.floor(CELL / 2);

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h, 16);
  if (!Number.isNaN(n) && /^[0-9a-fA-F]{6}$/.test(h)) {
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = String(hex || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [0, 0, 0];
}

const serverLog = path.join(TMP, 'server.log');
const logFd = fs.openSync(serverLog, 'w');

async function waitReady(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch (e) { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('服务启动超时');
}

function makeTestImage() {
  const code = `
from PIL import Image
img = Image.new('RGB', (48, 48))
for y in range(48):
    for x in range(48):
        c = (229, 57, 53) if x < 16 else ((67, 160, 71) if x < 32 else (30, 136, 229))
        img.putpixel((x, y), c)
img.save(${JSON.stringify(IMG)})
`;
  execFileSync(process.env.PYTHON || 'python', ['-c', code]);
}

const server = spawn(process.env.PYTHON || 'python', ['app.py', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', logFd, logFd],
});

let browser;
const errors = [];

function px(page, x, y) {
  return page.evaluate(([xx, yy]) => {
    const c = document.querySelector('#canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(xx, yy, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
}

async function canvasPoint(page, cellX, cellY) {
  return page.evaluate(([cx, cy]) => {
    const canvas = document.querySelector('#canvas');
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.width;
    const cell = 28;
    return {
      x: rect.left + ((cx + 1.5) * cell) * scale,
      y: rect.top + ((cy + 1.5) * cell) * scale,
    };
  }, [cellX, cellY]);
}

async function near(actual, expected, tol = 12) {
  assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= tol), `期望 ${expected}，实际 ${actual}`);
}

async function main() {
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
  makeTestImage();
  await waitReady(BASE + '/api/configs');

  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text());
  });

  // 1. 导入图片
  await page.goto(BASE + '/?test=1', { waitUntil: 'networkidle' });
  // 本测试的断言基于 48 色示例色板，先切过去（默认色板是 221 色 MARD）
  await page.selectOption('#config-select', 'default_48');
  await page.waitForTimeout(400);
  await page.fill('#target-pixels', '2304'); // 48x48 原大小，不做缩放
  await page.uncheck('#chk-sharpen'); // 关闭锐化，避免色块边缘产生过渡色
  await page.setInputFiles('#file-input', IMG);
  await page.waitForFunction(() => document.querySelector('#canvas')?.width > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#used-colors')?.textContent.includes('3 种颜色'), null, { timeout: 5000 });
  await page.uncheck('#chk-codes'); // 关闭格内色号文字，避免干扰像素断言
  assert.equal(await page.evaluate(() => document.querySelector('#canvas').width), 1400, '画布宽应为 (48+2)*28（无外部白边）');
  assert.equal(await page.evaluate(() => document.querySelector('#canvas').height), 1400, '画布高应为 (48+2)*28（无图例区）');
  await near(await px(page, ccx(5), ccy(5)), [229, 57, 53], 14);   // 红色块
  await near(await px(page, ccx(40), ccy(5)), [30, 136, 229], 14);  // 蓝色块
  // 行列号条网格线：外圈端帽不画线，条内细灰 / 每 5 格粗灰实线，图案边缘保持黑线
  const ox = MARGIN;
  const oy = MARGIN;
  const gw = 48 * CELL;
  const gh = 48 * CELL;
  await near(await px(page, ox, oy - CELL / 2), [214, 230, 247], 8);       // 顶条左端帽：浅蓝无黑线
  await near(await px(page, ox + gw - 1, oy - CELL / 2), [214, 230, 247], 8); // 顶条右端帽
  await near(await px(page, ox - CELL / 2, oy), [214, 230, 247], 8);       // 左条顶端帽
  await near(await px(page, ox - CELL / 2, oy + gh - 1), [214, 230, 247], 8); // 左条底端帽
  await near(await px(page, ox, oy + CELL / 2), [0, 0, 0], 12);            // 图案左边缘黑线
  await near(await px(page, ox + CELL / 2, oy), [0, 0, 0], 12);            // 图案上边缘黑线
  await near(await px(page, ox + CELL, oy - CELL / 2), [184, 192, 200], 20);    // 顶条分隔细灰线（1px 居中，采样为 50% 混合）
  await near(await px(page, ox + 5 * CELL, oy - CELL / 2), [154, 154, 154], 20); // 顶条每 5 格粗灰线
  await near(await px(page, ox - CELL / 2, oy + CELL), [184, 192, 200], 20);    // 左条分隔细灰线（1px 居中，采样为 50% 混合）
  await near(await px(page, ox - CELL / 2, oy + 5 * CELL), [154, 154, 154], 20); // 左条每 5 格粗灰线
  console.log('[OK] 行列号条网格线：外圈端帽无线，条内细灰 / 每 5 格粗灰');
  console.log('[OK] 导入并显示像素网格');

  // 1.2 工具栏与右侧面板布局：无描边；显示色号/透明色在画布工具栏；记录+自动保存位于导出左侧；事务历史带未保存提示
  const layout = await page.evaluate(() => {
    const firstRow = document.querySelectorAll('header .tb-row')[0];
    const headerOrder = ['btn-undo', 'btn-redo', 'undo-info', 'autosave-indicator', 'btn-export'].map((id) => {
      const el = document.getElementById(id);
      return el ? Array.from(firstRow.children).indexOf(el) : -1;
    });
    const canvasOrder = ['zoom-fit', 'chk-codes', 'empty-style'].map((id) => {
      const el = document.getElementById(id);
      return el ? Array.from(document.querySelectorAll('#canvas-toolbar *')).indexOf(el) : -1;
    });
    return {
      outlineRemoved: !document.getElementById('chk-outline') && !document.getElementById('dlg-outline'),
      recordsBeforeAutosave: headerOrder[0] >= 0 && headerOrder[2] >= 0 && headerOrder[0] < headerOrder[2] && headerOrder[2] < headerOrder[3],
      autosaveBeforeExport: headerOrder[3] >= 0 && headerOrder[4] >= 0 && headerOrder[3] < headerOrder[4],
      codesAfterZoom: canvasOrder[0] >= 0 && canvasOrder[1] >= 0 && canvasOrder[0] < canvasOrder[1],
      emptyAfterCodes: canvasOrder[1] >= 0 && canvasOrder[2] >= 0 && canvasOrder[1] < canvasOrder[2],
      noRecordsTitle: ![...document.querySelectorAll('#right-panel .panel-title')].some((t) => t.textContent.trim() === '记录'),
      hasHistoryTitle: [...document.querySelectorAll('#right-panel .panel-title')].some((t) => t.textContent.trim() === '事务历史'),
      hasDirtyIndicator: !!document.querySelector('#right-panel #dirty-indicator'),
      hasTreeList: !!document.querySelector('#right-panel #tree-list'),
      hasExportEmptyStyle: !!document.getElementById('dlg-empty-style'),
      hasExportPreview: !!document.getElementById('dlg-preview'),
    };
  });
  assert.ok(layout.outlineRemoved, '描边控件应已整体移除');
  assert.ok(layout.recordsBeforeAutosave && layout.autosaveBeforeExport, '记录应在自动保存左侧、自动保存应在导出左侧');
  assert.ok(layout.codesAfterZoom && layout.emptyAfterCodes, '显示色号/透明色应在画布工具栏缩放按钮右侧且顺序正确');
  assert.ok(layout.noRecordsTitle && layout.hasHistoryTitle && layout.hasDirtyIndicator && layout.hasTreeList, '右侧面板应为单一事务历史块并带未保存提示');
  assert.ok(layout.hasExportEmptyStyle && layout.hasExportPreview, '导出对话框应包含独立透明色选项与预览');
  assert.ok(!(await page.textContent('#toast')).includes('重新压缩'), '首次打开网站不应弹出色板配置提示');
  console.log('[OK] 工具栏 / 画布工具栏 / 右侧面板布局');

  // 1.5 侧边栏折叠 / 展开：收起后宽度收缩、工作区变宽，展开后恢复
  {
    const panelSpec = [
      { id: 'left-panel', trigger: '#left-panel-toggle' },
      { id: 'color-highlight-panel', trigger: '#color-highlight-panel-head' },
      { id: 'right-panel', trigger: '#right-panel-head' },
    ];
    const canvasBefore = await page.evaluate(() => document.querySelector('#canvas-area').getBoundingClientRect().width);
    const panBefore = await page.evaluate(() => window.__app.pan.x);
    for (const { id, trigger } of panelSpec) {
      await page.click(trigger);
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate((pid) => document.getElementById(pid).classList.contains('collapsed'), id),
        `${id} 点击折叠按钮后应收起`);
      const w = await page.evaluate((pid) => Math.round(document.getElementById(pid).getBoundingClientRect().width), id);
      assert.equal(w, 32, `${id} 折叠后宽度应为 32px，实际 ${w}`);
      if (id === 'left-panel') {
        const panX = await page.evaluate(() => window.__app.pan.x);
        assert.ok(Math.abs(panX - (panBefore + 288)) < 2, `折叠左侧栏后画布应补偿位移保持绝对位置：${panBefore} -> ${panX}`);
      }
    }
    const canvasAfter = await page.evaluate(() => document.querySelector('#canvas-area').getBoundingClientRect().width);
    assert.ok(canvasAfter > canvasBefore, `折叠全部面板后工作区应变宽：${canvasBefore} -> ${canvasAfter}`);
    for (const { id } of panelSpec) {
      await page.click(`#${id}-expand`);
      await page.waitForTimeout(300);
      assert.ok(!(await page.evaluate((pid) => document.getElementById(pid).classList.contains('collapsed'), id)),
        `${id} 点击展开按钮后应恢复展开`);
    }
    const panAfter = await page.evaluate(() => window.__app.pan.x);
    assert.ok(Math.abs(panAfter - panBefore) < 2, `全部展开后画布位置应复原：${panBefore} -> ${panAfter}`);
    await page.evaluate(() => localStorage.removeItem('fuse-beads.panel-collapsed'));
    console.log('[OK] 侧边栏折叠 / 展开');
  }

  // 1.7 颜色距离延迟生效：修改后需「重新压缩」才重新生成图案
  {
    const gridBefore = await page.evaluate(() => Array.from(window.__app.project.grid));
    await page.selectOption('#sel-distance', 'rgb');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__app.settings.useLab), false, '修改颜色距离后应保存设置');
    const gridAfter = await page.evaluate(() => Array.from(window.__app.project.grid));
    assert.deepEqual(gridAfter, gridBefore, '修改颜色距离后不应立即重新生成图案');
    assert.ok((await page.textContent('#toast')).includes('重新压缩'), '修改颜色距离后应提示需重新压缩');
    await page.selectOption('#sel-distance', 'lab');
    await page.waitForTimeout(200);
    console.log('[OK] 颜色距离延迟生效');
  }

  // 1.6 对比原图 / 同步拖拽
  {
    await page.check('#chk-compare');
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate(() => document.querySelector('#canvas-scroll').classList.contains('compare-on')),
      '勾选对比后工作区应分为左右两块');
    assert.ok(await page.evaluate(() => document.querySelector('#canvas-original').width > 0), '左侧原图画布应有内容');

    // 画笔模式下点击左侧原图不应修改拼豆图
    const gridBefore = await page.evaluate(() => Array.from(window.__app.project.grid));
    await page.click('.tab[data-tab="edit"]');
    await page.click('#color-list .color-item:first-child');
    const origBox = await page.locator('#compare-original').boundingBox();
    await page.mouse.click(origBox.x + 60, origBox.y + 60);
    await page.waitForTimeout(200);
    const gridAfter = await page.evaluate(() => Array.from(window.__app.project.grid));
    assert.deepEqual(gridAfter, gridBefore, '点击原图不应修改拼豆图');
    await page.keyboard.press('Escape'); // 回选择模式

    // 取消对比原图时同步拖拽应一并取消；未勾选对比时勾选同步 → 自动勾选对比
    await page.check('#chk-sync-pan'); // 对比已开启，直接启用同步
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.querySelector('#chk-sync-pan').checked), '对比开启时可直接勾选同步');
    await page.uncheck('#chk-compare');
    await page.waitForTimeout(250);
    assert.ok(!(await page.evaluate(() => document.querySelector('#chk-sync-pan').checked)),
      '取消对比原图时同步拖拽应一并取消');
    await page.check('#chk-sync-pan');
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate(() => document.querySelector('#chk-compare').checked),
      '未勾选对比时勾选同步应自动勾选对比');

    // 同步换算：原图 zoom = 拼豆 zoom × CELL；原图 pan = 拼豆 pan + 1 格行列号条 × CELL × zoom
    const MARGIN = 1;
    const CELL = 28;
    const initConsistent = await page.evaluate(() => {
      const a = window.__app;
      return Math.abs(a.origPan.x - (a.pan.x + 1 * 28 * a.zoom)) < 1
        && Math.abs(a.origZoom - a.zoom * 28) < 1e-6;
    });
    assert.ok(initConsistent, '开启同步后原图坐标应包含 1 格行列号条与像素格放大换算');

    // 同步拖拽：拖动原图 → 两侧按同一屏幕位移平移
    const beforePan = await page.evaluate(() => {
      const a = window.__app;
      return { px: a.pan.x, ox: a.origPan.x, z: a.zoom, oz: a.origZoom };
    });
    const paneBox = await page.locator('#compare-original').boundingBox();
    await page.mouse.move(paneBox.x + 40, paneBox.y + 60);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(paneBox.x + 100, paneBox.y + 120, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(200);
    const afterPan = await page.evaluate(() => {
      const a = window.__app;
      return { px: a.pan.x, ox: a.origPan.x, z: a.zoom, oz: a.origZoom };
    });
    assert.ok(Math.abs(afterPan.px - beforePan.px) > 20, '拖动原图应产生平移');
    const expectOx = afterPan.px + MARGIN * CELL * afterPan.z;
    assert.ok(Math.abs(afterPan.ox - expectOx) < 1,
      `同步拖拽下原图 pan 应含边距换算：${afterPan.ox.toFixed(1)} vs ${expectOx.toFixed(1)}`);
    assert.ok(Math.abs(afterPan.oz - afterPan.z * CELL) < 1e-6,
      `同步拖拽下原图 zoom 应按像素格放大：${afterPan.oz} vs ${afterPan.z * CELL}`);

    // 同步缩放：在原图上滚轮 → 两侧 zoom 按 CELL 关系同步
    const zBefore = await page.evaluate(() => window.__app.zoom);
    const oPaneBox = await page.locator('#compare-original').boundingBox();
    await page.mouse.move(oPaneBox.x + oPaneBox.width / 2, oPaneBox.y + oPaneBox.height / 2);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(250);
    const zAfter = await page.evaluate(() => window.__app.zoom);
    const ozAfter = await page.evaluate(() => window.__app.origZoom);
    assert.ok(zAfter > zBefore, '原图滚轮应放大拼豆图');
    assert.ok(Math.abs(ozAfter - zAfter * CELL) < 1e-6, '同步缩放后原图 zoom 应保持 CELL 放大关系');

    // 恢复默认，避免影响后续用例
    await page.uncheck('#chk-sync-pan');
    await page.uncheck('#chk-compare');
    await page.waitForTimeout(250);
    console.log('[OK] 对比原图 / 同步拖拽');
  }

  // 2. 颜色简化滑块
  assert.equal(await page.inputValue('#color-slider'), '3', '使用 3 种颜色，滑块最大应为 3');
  await page.evaluate(() => {
    const s = document.querySelector('#color-slider');
    s.value = '2';
    s.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.textContent('#slider-value'), '2', '滑块值应变为 2');
  // 滑块为 2 时，列表与图例的数量应按合并簇聚合（红+绿合并，剩蓝）
  const mergedCounts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#color-list .ci-count'))
      .filter((e) => e.textContent !== '')
      .map((e) => e.textContent));
  assert.equal(mergedCounts.length, 2, '滑块为 2 时列表应只显示 2 个合并色数量');
  const totalBeads = mergedCounts.reduce((a, t) => a + parseInt(t.replace('×', ''), 10), 0);
  assert.equal(totalBeads, 2304, '合并数量总和应等于总格数');
  assert.ok((await page.textContent('#used-colors')).includes('2 种颜色'), '滑块调整后应按工作副本显示色数');
  console.log('[OK] 颜色简化滑块');
  // 涂色测试前先回到最大颜色数，避免合并色干扰判断
  await page.evaluate(() => {
    const s = document.querySelector('#color-slider');
    s.value = s.max;
    s.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(200);
  const unmergedCounts = await page.evaluate(() =>
    document.querySelectorAll('#color-list .ci-count:not(:empty)').length);
  assert.equal(unmergedCounts, 3, '滑块回到最大后应显示 3 个数量');

  // 2.5 重新压缩后默认适应窗口（居中）
  const onDlg = (d) => d.accept();
  page.on('dialog', onDlg);
  await page.click('#btn-recompress');
  await page.waitForTimeout(1500);
  page.off('dialog', onDlg);
  const fit = await page.evaluate(() => {
    const a = window.__app;
    const c = document.querySelector('#canvas');
    const vp = document.querySelector('#canvas-scroll');
    const expectX = (vp.clientWidth - c.width * a.zoom) / 2;
    return { panX: a.pan.x, expectX, zoom: a.zoom, cw: c.width };
  });
  assert.ok(fit.cw > 0 && Math.abs(fit.panX - fit.expectX) < 2,
    `重新压缩后应居中适应窗口，实际 panX=${fit.panX.toFixed(1)} 期望 ${fit.expectX.toFixed(1)}`);
  console.log('[OK] 重新压缩后适应窗口');

  // 3. 画笔涂色（选择白色后点击格子）
  await page.click('.tab[data-tab="edit"]');
  const countsBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#color-list .ci-count')).map((e) => e.textContent).join(','));
  await page.click('#color-list .color-item:first-child');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#selection-controls')).display), 'none',
    '画笔模式应隐藏同色选区与选中高亮');
  const countsAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#color-list .ci-count')).map((e) => e.textContent).join(','));
  assert.equal(countsAfter, countsBefore, '点选颜色后色号右侧的数量不应丢失');
  let pt = await canvasPoint(page, 10, 10);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  await near(await px(page, ccx(10), ccy(10)), [255, 255, 255], 10, '点击应涂成白色');
  assert.ok((await page.textContent('#used-colors')).includes('4 种颜色'), '编辑后当前使用颜色数应同步更新');
  const edge = await px(page, OP + MARGIN + 10 * CELL + 3, OP + MARGIN + 10 * CELL + Math.floor(CELL / 2));
  assert.ok(!(edge[2] > 140 && edge[0] < 120), `画笔涂色不应产生高亮，实际 ${edge}`);
  console.log('[OK] 画笔涂色');

  // 3.5 单步撤销 / 重做：Ctrl+Z 撤销涂色、Ctrl+Y 重做
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  await near(await px(page, ccx(10), ccy(10)), [229, 57, 53], 10, '撤销后应恢复原红色');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  await near(await px(page, ccx(10), ccy(10)), [255, 255, 255], 10, '重做后应恢复白色');
  assert.equal(await page.locator('#tree-list .tree-node').count(), 0, '撤销/重做不应产生事务');
  assert.ok((await page.textContent('#undo-info')).includes('1/20'), '撤销/重做后应保留这一步记录');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#dirty-indicator')).display), 'none',
    '编辑后应显示「有未保存的修改」提示');
  console.log('[OK] 单步撤销 / 重做');

  // 4. 橡皮拖拽（空位显示浅灰斜线）
  await page.click('#tool-eraser');
  pt = await canvasPoint(page, 10, 10);
  const pt2 = await canvasPoint(page, 13, 10);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt2.x, pt2.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const hatch = await px(page, OP + MARGIN + 11 * CELL + 8, OP + MARGIN + 10 * CELL + 3);
  assert.ok(Math.abs(hatch[0] - 236) < 18 && Math.abs(hatch[1] - 236) < 18 && Math.abs(hatch[2] - 236) < 18,
    `空位应为浅灰斜线底色，实际 ${hatch}`);
  console.log('[OK] 橡皮擦除（空位斜线）');

  // 5. D 键快速选色
  await page.click('#tool-brush');
  pt = await canvasPoint(page, 20, 20);
  await page.mouse.click(pt.x, pt.y);
  await page.keyboard.press('Escape'); // 画笔模式按 ESC 回选择模式，D 仅在单选一格时生效
  assert.equal(await page.textContent('#mode-label'), '选择模式', 'ESC 应返回选择模式');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#selection-controls')).display), 'none',
    '选择模式应显示同色选区与选中高亮');
  await page.mouse.click(pt.x, pt.y); // 选择模式单击 = 选中该像素
  await page.keyboard.press('d');
  await page.waitForSelector('#quick-picker:not(.hidden)', { timeout: 3000 });
  assert.equal(await page.locator('#quick-picker button:not(.qp-cancel)').count(), 9, '应弹出 9 个备选色');
  const qpBgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#quick-picker button:not(.qp-cancel)')).map((b) => b.style.background));
  assert.ok(!qpBgs.some((bg) => hexToRgb(bg).every((v, i) => v === [255, 255, 255][i])),
    '九宫格应排除自身颜色（白色）');
  const firstBtnText = await page.locator('#quick-picker button:not(.qp-cancel)').first().textContent();
  assert.ok(/×\d+/.test(firstBtnText), `九宫格候选中已使用的色号应显示数量，实际 ${firstBtnText}`);
  // 第一个候选是周围格子的颜色（绿色）；第二个是按相近度补的相近色（已排除自身白色）
  const candEl = page.locator('#quick-picker button:not(.qp-cancel)').nth(1);
  const candHex = await candEl.evaluate((el) => el.style.background);
  await candEl.click();
  await page.waitForTimeout(250);
  const picked = await px(page, ccx(20), ccy(20));
  await near(picked, hexToRgb(candHex), 12, `D 键选色应涂成所选候选色 ${candHex}`);
  console.log('[OK] D 键快速选色');

  // 5.4 九宫格打开后直接拖拽应自动关闭
  await page.keyboard.press('d');
  await page.waitForSelector('#quick-picker:not(.hidden)', { timeout: 3000 });
  const vpBox = await page.locator('#canvas-scroll').boundingBox();
  await page.mouse.move(vpBox.x + 8, vpBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(vpBox.x + 50, vpBox.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#quick-picker').evaluate((el) => el.classList.contains('hidden')),
    '九宫格打开后直接拖拽应自动关闭');
  await page.keyboard.press('Escape'); // 清除拖拽可能产生的选区，确保后续为“无选区取色”
  console.log('[OK] 九宫格拖拽自动关闭');

  // 5.5 取色工具：点击像素取色，ESC 回拖拽
  await page.click('#tool-picker');
  const pickPt = await canvasPoint(page, 5, 5); // 红色块
  await page.mouse.click(pickPt.x, pickPt.y);
  await page.waitForTimeout(200);
  const brushLabel = await page.textContent('#brush-label');
  assert.ok(brushLabel.includes('#E53935'), `取色后画笔应为红色，实际 ${brushLabel}`);
  assert.equal(await page.textContent('#mode-label'), '画笔模式', '取色后应自动切换为画笔模式');
  await page.keyboard.press('Escape');
  assert.equal(await page.textContent('#mode-label'), '选择模式', '取色模式 ESC 应返回选择模式');
  console.log('[OK] 取色工具');

  // 5.6 选择模式单击像素 = 选中（虚线选区）
  const hlPt = await canvasPoint(page, 5, 5);
  await page.mouse.click(hlPt.x, hlPt.y);
  await page.waitForTimeout(150);
  // 移开鼠标，避免 hover 虚线干扰选区像素采样
  const hlVp = await page.locator('#canvas-scroll').boundingBox();
  await page.mouse.move(hlVp.x + 8, hlVp.y + 8);
  await page.waitForTimeout(120);
  const selState = await page.evaluate(() => {
    const a = window.__app;
    return { size: a.selection.size, has: a.selection.has(5 * a.project.width + 5) };
  });
  assert.equal(selState.size, 1, '单击应选中一个格子');
  assert.equal(selState.has, true, '应选中 (5,5)');
  const selPx = await px(page, OP + MARGIN + 5 * CELL + 10, OP + MARGIN + 5 * CELL);
  assert.ok(selPx[0] < 120 || (selPx[0] > 200 && selPx[1] > 200 && selPx[2] > 200),
    `选区边框应为黑/白虚线像素，实际 ${selPx}`);
  console.log('[OK] 选择模式单击选择（虚线选区）');

  // 5.7 工作区空白处拖拽 = 平移图片
  const beforePan = await page.evaluate(() => window.__app.pan.x);
  const vp = await page.locator('#canvas-scroll').boundingBox();
  await page.mouse.move(vp.x + 8, vp.y + 8);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(vp.x + 60, vp.y + 40, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
  const afterPan = await page.evaluate(() => window.__app.pan.x);
  assert.ok(Math.abs(afterPan - beforePan) > 20, `工作区拖拽应平移图片：${beforePan} -> ${afterPan}`);
  console.log('[OK] 工作区拖拽平移');

  // 5.8 颜色清单高亮：点击色号 → 图中对应像素出现覆盖层+亮度自适应描边，再点/切换模式取消
  assert.ok(await page.locator('#highlight-color-list .hc-item').count() >= 2, '颜色清单应显示已用颜色');
  const hcCounts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#highlight-color-list .hc-count'))
      .map((e) => parseInt(e.textContent.replace('×', ''), 10)));
  assert.ok(hcCounts.every((v, i) => i === 0 || hcCounts[i - 1] <= v), '颜色清单应按数量正序排列');
  const clearPt = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas');
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.width;
    return { x: rect.left + (0.5 * 28) * scale, y: rect.top + (0.5 * 28) * scale };
  });
  await page.keyboard.press('Escape'); // 清除选区，避免与颜色高亮混叠
  await page.mouse.click(clearPt.x, clearPt.y); // 移动鼠标位置
  await page.waitForTimeout(120);
  const baseRed = await px(page, OP + MARGIN + 5 * CELL + 2, OP + MARGIN + 5 * CELL + Math.floor(CELL / 2));
  assert.ok(baseRed[0] > 150 && baseRed[1] < 130 && baseRed[2] < 130, `前置：样本点应为红色，实际 ${baseRed}`);
  // 在清单中定位红色（#E53935），红色块位于 (5,5)
  const redIdx = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#highlight-color-list .hc-item'));
    for (let i = 0; i < items.length; i++) {
      const sw = items[i].querySelector('.swatch');
      const m = String(sw && getComputedStyle(sw).backgroundColor).match(/\d+/g);
      if (m && Math.abs(+m[0] - 229) < 8 && Math.abs(+m[1] - 57) < 8 && Math.abs(+m[2] - 53) < 8) return i;
    }
    return -1;
  });
  assert.ok(redIdx >= 0, '清单中应能找到红色');
  const hcItem = page.locator('#highlight-color-list .hc-item').nth(redIdx);
  await hcItem.click();
  await page.waitForTimeout(150);
  const frame = await px(page, OP + MARGIN + 5 * CELL + 2, OP + MARGIN + 5 * CELL + Math.floor(CELL / 2));
  // 红色偏暗 → 白色覆盖层提亮 + 浅色描边：样本点应明显变亮
  assert.ok(frame[0] >= baseRed[0] - 2 && frame[1] >= baseRed[1] + 25 && frame[2] >= baseRed[2] + 25,
    `颜色高亮后暗色格子应被提亮，实际 ${frame} vs 基线 ${baseRed}`);
  assert.ok(await hcItem.evaluate((el) => el.classList.contains('active')), '清单项应显示高亮态');
  await hcItem.click(); // 再次点击取消
  await page.waitForTimeout(150);
  const frame2 = await px(page, OP + MARGIN + 5 * CELL + 2, OP + MARGIN + 5 * CELL + Math.floor(CELL / 2));
  assert.ok(Math.abs(frame2[0] - baseRed[0]) <= 12 && Math.abs(frame2[1] - baseRed[1]) <= 12 && Math.abs(frame2[2] - baseRed[2]) <= 12,
    `再次点击应取消高亮并恢复原色，实际 ${frame2} vs ${baseRed}`);
  await hcItem.click(); // 重新高亮
  await page.waitForTimeout(120);
  // 单选：选择另一种色号会替换（清除）前一种高亮
  const blueIdx = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#highlight-color-list .hc-item'));
    for (let i = 0; i < items.length; i++) {
      const sw = items[i].querySelector('.swatch');
      const m = String(sw && getComputedStyle(sw).backgroundColor).match(/\d+/g);
      if (m && Math.abs(+m[0] - 30) < 8 && Math.abs(+m[1] - 136) < 8 && Math.abs(+m[2] - 229) < 8) return i;
    }
    return -1;
  });
  assert.ok(blueIdx >= 0, '清单中应能找到蓝色');
  await page.locator('#highlight-color-list .hc-item').nth(blueIdx).click();
  await page.waitForTimeout(150);
  const frameReplace = await px(page, OP + MARGIN + 5 * CELL + 2, OP + MARGIN + 5 * CELL + Math.floor(CELL / 2));
  assert.ok(Math.abs(frameReplace[0] - baseRed[0]) <= 12 && Math.abs(frameReplace[1] - baseRed[1]) <= 12 && Math.abs(frameReplace[2] - baseRed[2]) <= 12,
    `选择另一种色号应清除前一种高亮，实际 ${frameReplace} vs ${baseRed}`);
  assert.ok(await page.locator('#highlight-color-list .hc-item').nth(blueIdx)
    .evaluate((el) => el.classList.contains('active')), '新选择的色号应处于高亮态');
  await page.click('#tool-brush'); // 切换模式后色号高亮应保留
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__app.highlightColor != null), true,
    '切换画笔模式后色号高亮应保留');
  assert.ok(await page.locator('#highlight-color-list .hc-item').nth(blueIdx)
    .evaluate((el) => el.classList.contains('active')), '切换画笔模式后清单项应保持激活态');
  await page.keyboard.press('Escape'); // 回拖拽，继续后续测试
  console.log('[OK] 颜色清单高亮 / 取消 / 模式切换保留');

  // 6. 事务历史：保存两次 -> 删除第二个状态
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#tree-list .tree-node').count(), 2, '保存两次应有 2 个状态');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#dirty-indicator')).display), 'none',
    '保存事务后应隐藏「有未保存的修改」提示');
  page.once('dialog', (d) => d.accept());
  await page.click('#tree-list .tree-node.current .tn-actions button:first-child');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#tree-list .tree-node').count(), 1, '删除后应剩 1 个状态');
  assert.match(await page.textContent('#tree-list .tn-label'), /状态 #1/, '当前应切回状态 #1');
  console.log('[OK] 事务历史保存 / 删除 / 切换');

  // 7. 导出 JPG：实时预览 + 图例开关生效
  await page.click('#btn-export');
  await page.fill('#dlg-cell-size', '10');
  await page.waitForFunction(() => document.querySelector('#dlg-preview')?.width > 0, null, { timeout: 5000 });
  const previewW = await page.evaluate(() => document.querySelector('#dlg-preview').width);
  assert.ok(previewW > 0, '导出对话框应显示实时预览');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#dlg-export-ok'),
  ]);
  assert.equal(download.suggestedFilename(), '拼豆图案.jpg');
  const dlPath = await download.path();
  if (!dlPath) throw new Error('导出下载未返回文件路径');
  const outJpg = path.join(TMP, 'exported.jpg');
  fs.copyFileSync(dlPath, outJpg);
  assert.ok(fs.statSync(outJpg).size > 1000, '导出文件过小');
  await page.waitForFunction(() => document.querySelector('#export-dialog').classList.contains('hidden'),
    null, { timeout: 5000 });
  // 取消「附带色号图例」后再次导出，输出应与带图例时不同
  await page.click('#btn-export');
  await page.fill('#dlg-cell-size', '10');
  await page.uncheck('#dlg-legend');
  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#dlg-export-ok'),
  ]);
  const dlPath2 = await download2.path();
  if (!dlPath2) throw new Error('导出下载未返回文件路径');
  const outJpgNoLegend = path.join(TMP, 'exported_nolegend.jpg');
  fs.copyFileSync(dlPath2, outJpgNoLegend);
  assert.notEqual(fs.statSync(outJpgNoLegend).size, fs.statSync(outJpg).size, '图例开关应改变导出图片');
  await page.waitForFunction(() => document.querySelector('#export-dialog').classList.contains('hidden'),
    null, { timeout: 5000 });
  // 勾选「显示行列号」后导出应与不带行列号的图片不同
  await page.click('#btn-export');
  await page.fill('#dlg-cell-size', '10');
  await page.check('#dlg-legend');
  await page.check('#dlg-edge-numbers');
  const [download3] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#dlg-export-ok'),
  ]);
  const dlPath3 = await download3.path();
  if (!dlPath3) throw new Error('导出下载未返回文件路径');
  const outJpgNumbers = path.join(TMP, 'exported_numbers.jpg');
  fs.copyFileSync(dlPath3, outJpgNumbers);
  assert.notEqual(fs.statSync(outJpgNumbers).size, fs.statSync(outJpg).size, '行列号开关应改变导出图片');
  await page.waitForFunction(() => document.querySelector('#export-dialog').classList.contains('hidden'),
    null, { timeout: 5000 });
  console.log('[OK] 导出 JPG（预览 + 图例开关 + 行列号开关生效）');

  // 8. 自动保存 + 刷新恢复
  // 等待最新状态（删除后的单节点树 + 擦除的空位）真正落盘，再刷新
  await page.waitForFunction(async () => {
    try {
      const r = await fetch('/api/state');
      if (!r.ok) return false;
      const s = await r.json();
      if (!s.history || !Array.isArray(s.history.items) || s.history.items.length !== 1) return false;
      const g = s.project && s.project.grid;
      return !!g && g[10 * 48 + 11] === -1;
    } catch (e) {
      return false;
    }
  }, null, { timeout: 8000 });
  await page.waitForTimeout(500); // 等待可能仍在途中的自动保存落盘
  const stateNow = await (await fetch(`${BASE}/api/state`)).json();
  console.log('落盘状态:', stateNow.project ? '有 project' : '无 project',
    'project.grid:', stateNow.project && Array.isArray(stateNow.project.grid)
      ? '数组长度 ' + stateNow.project.grid.length : (stateNow.project ? '缺失/非数组(' + typeof (stateNow.project.grid) + ')' : 'n/a'),
    '事务数:', stateNow.history && Array.isArray(stateNow.history.items) ? stateNow.history.items.length : 'n/a');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#config-select')?.options.length > 0, null, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('#canvas')?.width > 0, null, { timeout: 10000 });
  await page.waitForTimeout(500); // 等画布重绘稳定后再取样
  const restoredHatch = await px(page, OP + MARGIN + 11 * CELL + 8, OP + MARGIN + 10 * CELL + 3);
  const restoredGrid = await page.evaluate(() => {
    const a = window.__app;
    return a && a.project && a.project.grid ? {
      cell1010: a.project.grid[10 * 48 + 10],
      cell1110: a.project.grid[10 * 48 + 11],
      cell2020: a.project.grid[20 * 48 + 20],
    } : null;
  });
  assert.ok(restoredGrid && restoredGrid.cell1010 === -1 && restoredGrid.cell1110 === -1,
    `刷新后网格应保留擦除与涂色状态，实际 ${JSON.stringify(restoredGrid)}`);
  assert.ok(Math.abs(restoredHatch[0] - 236) < 18 && Math.abs(restoredHatch[1] - 236) < 18 && Math.abs(restoredHatch[2] - 236) < 18,
    `刷新后擦除的空位应保留，实际 ${restoredHatch}`);
  assert.equal(await page.locator('#tree-list .tree-node').count(), 1, '刷新后历史应保留');
  console.log('[OK] 自动保存与刷新恢复');

  // 8.5 刷新后原图缓存恢复：对比功能仍可用
  {
    await page.check('#chk-compare');
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate(() => document.querySelector('#canvas-scroll').classList.contains('compare-on')),
      '刷新后原图应从缓存恢复，对比可正常开启');
    assert.ok(await page.evaluate(() => document.querySelector('#canvas-original').width > 0),
      '刷新后原图画布应有内容');
    await page.uncheck('#chk-compare');
    await page.waitForTimeout(250);
    console.log('[OK] 刷新后原图缓存恢复');
  }

  // 9. 新建 / 删除配置
  await page.click('.tab[data-tab="palette"]');
  page.once('dialog', (d) => d.accept('UI测试配置'));
  await page.click('#btn-new-config');
  await page.waitForFunction(() => document.querySelector('#config-select')?.value === 'UI测试配置', null, { timeout: 5000 });
  page.once('dialog', (d) => d.accept());
  await page.click('#btn-delete-config');
  await page.waitForFunction(() => document.querySelector('#config-select')?.value !== 'UI测试配置', null, { timeout: 5000 });
  console.log('[OK] 配置新建与删除');

  // 10. 双副本：编辑后再次使用滑块 → 警告 + 清除上次滑块后的事务 + 从基副本重建
  const treeBefore = await page.locator('#tree-list .tree-node').count();
  await page.keyboard.press('Control+s'); // 保存一个“滑块之后”的事务
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#tree-list .tree-node').count(), treeBefore + 1, '应能保存出滑块后的新事务');
  // 编辑一个像素（画笔涂色），使滑块处于“编辑后”状态
  await page.click('.tab[data-tab="edit"]');
  await page.click('#color-list .color-item:first-child');
  const paintPt = await canvasPoint(page, 30, 30);
  await page.mouse.click(paintPt.x, paintPt.y);
  await page.waitForTimeout(200);
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    const s = document.querySelector('#color-slider');
    s.value = '2';
    s.dispatchEvent(new Event('input'));
  });
  await page.waitForFunction(() => document.querySelectorAll('#tree-list .tree-node').length === 0, null, { timeout: 5000 });
  assert.equal(await page.locator('#tree-list .tree-node').count(), 0,
    '编辑后再次使用滑块应清除上次滑块之后的事务');
  assert.ok((await page.textContent('#used-colors')).includes('2 种颜色'),
    '滑块重建后应基于基副本显示合并色数');
  console.log('[OK] 双副本滑块语义（警告/清事务/基副本重建）');

  // 11. 色板配置修改：不即时更新图片/画笔，重新压缩后才应用
  await page.click('.tab[data-tab="palette"]');
  // 刷新后 originalFile 已丢失，先重新导入图片（当前 staging 为 mard-221）
  await page.setInputFiles('#file-input', IMG);
  await page.waitForFunction(() => document.querySelector('#canvas')?.width > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const paletteCfgName = `UI调色板${Date.now()}`;
  // 等待新配置详情真正加载完成（下拉框会先切名字，但色板是异步加载的）
  const detailResp = page.waitForResponse(
    (r) => r.url().includes('/api/configs/' + encodeURIComponent(paletteCfgName)) && r.request().method() === 'GET',
    { timeout: 5000 },
  );
  page.once('dialog', (d) => d.accept(paletteCfgName));
  await page.click('#btn-new-config');
  await detailResp;
  // 等「色板配置修改后需重新压缩」提示的 3 秒节流过期，让后续改色能再次弹出提示
  await page.waitForTimeout(3200);
  const pixelBeforeEdit = await px(page, ccx(5), ccy(5));
  await page.evaluate(() => {
    const inp = document.querySelector('#color-table input[type="color"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '#00FF00');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const pixelAfterEdit = await px(page, ccx(5), ccy(5));
  assert.deepEqual(pixelAfterEdit, pixelBeforeEdit, '修改色板后画布不应立即变化');
  assert.equal(await page.evaluate(() => window.__app.palette[0].hex), '#00FF00', '色板配置本身应已更新');
  assert.ok((await page.textContent('#toast')).includes('重新压缩'), '修改色板后应弹出「重新压缩后生效」提示');
  page.on('dialog', onDlg);
  await page.click('#btn-recompress');
  await page.waitForTimeout(1500);
  page.off('dialog', onDlg);
  assert.equal(await page.evaluate(() => window.__app.appliedPalette[0].hex), '#00FF00', '重新压缩后应应用新的色板配置');
  assert.ok((await page.textContent('#brush-label')).includes('#00FF00'), '重新压缩后画笔颜色应同步更新');
  page.once('dialog', (d) => d.accept());
  await page.click('#btn-delete-config');
  await page.waitForFunction((n) => document.querySelector('#config-select')?.value !== n, paletteCfgName, { timeout: 5000 });
  console.log('[OK] 色板配置修改不即时生效，重新压缩后应用');

  // 12. 大图：同步换算应包含「网格宽 / 原图显示宽」比例
  {
    const LARGE_IMG = path.join(TMP, 'ui_test_large.png');
    const largeCode = `
from PIL import Image, ImageDraw
img = Image.new('RGB', (4000, 3000), (229, 57, 53))
d = ImageDraw.Draw(img)
d.rectangle([1333, 0, 2665, 2999], fill=(67, 160, 71))
d.rectangle([2666, 0, 3999, 2999], fill=(30, 136, 229))
img.save(${JSON.stringify(LARGE_IMG)})
`;
    execFileSync(process.env.PYTHON || 'python', ['-c', largeCode]);
    await page.setInputFiles('#file-input', LARGE_IMG);
    await page.waitForFunction(() => document.querySelector('#canvas')?.width > 0, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.check('#chk-compare');
    await page.waitForTimeout(400);
    await page.check('#chk-sync-pan');
    await page.waitForTimeout(400);
    const kCheck = await page.evaluate(() => {
      const a = window.__app;
      return {
        gridW: a.project.width,
        dispW: document.querySelector('#canvas-original').width,
        zoom: a.zoom,
        origZoom: a.origZoom,
        origPanX: a.origPan.x,
        panX: a.pan.x,
      };
    });
    assert.ok(Math.abs(kCheck.origZoom - kCheck.zoom * 28 * (kCheck.gridW / kCheck.dispW)) < 1e-6,
      `原图 zoom 应 = 拼豆 zoom × 28 × (网格宽/原图显示宽)，实际 ${kCheck.origZoom} vs ${kCheck.zoom * 28 * (kCheck.gridW / kCheck.dispW)}`);
    assert.ok(Math.abs(kCheck.origPanX - (kCheck.panX + 1 * 28 * kCheck.zoom)) < 1,
      '原图 pan 应含 1 格行列号条偏移');
    await page.uncheck('#chk-sync-pan');
    await page.uncheck('#chk-compare');
    await page.waitForTimeout(250);
    console.log('[OK] 大图网格/原图比例同步换算');
  }

  // 截图留档
  const shot = 'C:/Users/myouh/.codex/visualizations/2026/08/06/019fd4fd-4c9a-7042-9fe1-6e52067cbf05/ui_screenshot.png';
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await page.screenshot({ path: shot, fullPage: false });
  console.log('截图:', shot);

  assert.equal(errors.length, 0, '页面出现 JS 错误: ' + errors.join(' | '));
  console.log('\n界面自动化测试全部通过');
  console.log('导出文件:', outJpg);
  await browser.close();
}

main()
  .catch((e) => {
    console.error('测试失败:', e);
    if (errors.length) console.error('页面错误:', errors.join(' | '));
    try {
      console.error('--- 服务端日志尾部 ---');
      console.error(fs.readFileSync(serverLog, 'utf-8').split('\n').slice(-60).join('\n'));
    } catch (err) { /* ignore */ }
    if (browser) browser.close().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
    try { fs.closeSync(logFd); } catch (e) { /* ignore */ }
    try { if (fs.existsSync(STATE)) fs.unlinkSync(STATE); } catch (e) { /* ignore */ }
    try {
      // 清理测试过程中创建的临时配置，避免失败运行留下残留 CSV
      for (const fn of fs.readdirSync(path.join(ROOT, 'data', 'configs'))) {
        if (/^(UI测试配置|UI调色板)/.test(fn)) {
          fs.unlinkSync(path.join(ROOT, 'data', 'configs', fn));
        }
      }
    } catch (e) { /* ignore */ }
  });
