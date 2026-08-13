// 跨语言常量同步测试：
// 前端 constants.js 与 style.css、后端 bead/export.py 之间存在跨语言重复的
// 布局/渲染参数（面板宽度、九宫格尺寸、图例/网格线/色号/空位样式等），
// 本测试在任一侧漂移时立即失败，把「靠注释约定同步」变成可执行的契约。
// 有意保留的行为差异集中在 EXCEPTIONS 中并锁定当前值，改动任一侧需同步更新。
//
// 运行：node tests/constants_sync_test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as K from '../static/js/constants.js';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------------- CSS 布局参数 ----------------

const cssText = read('static/css/style.css');

function cssVar(name) {
  const m = cssText.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
const px = (v) => parseInt(v, 10);

assert.equal(px(cssVar('panel-left-width')), K.PANEL_FULL_WIDTH['left-panel'],
  '--panel-left-width 应与 PANEL_FULL_WIDTH 一致');
assert.equal(px(cssVar('panel-highlight-width')), K.PANEL_FULL_WIDTH['color-highlight-panel'],
  '--panel-highlight-width 应与 PANEL_FULL_WIDTH 一致');
assert.equal(px(cssVar('panel-right-width')), K.PANEL_FULL_WIDTH['right-panel'],
  '--panel-right-width 应与 PANEL_FULL_WIDTH 一致');
assert.equal(px(cssVar('panel-collapsed-width')), K.PANEL_COLLAPSED_WIDTH,
  '--panel-collapsed-width 应与 PANEL_COLLAPSED_WIDTH 一致');

{
  const m = cssText.match(/transition:\s*width\s+([\d.]+)s\s+ease/);
  assert.ok(m, 'style.css 应包含 aside 宽度过渡 transition: width 0.18s ease');
  assert.equal(Math.round(parseFloat(m[1]) * 1000), K.PANEL_ANIMATION_MS,
    'aside 宽度过渡时长应与 PANEL_ANIMATION_MS 一致');
}

{
  const m = cssText.match(/grid-template-columns:\s*repeat\((\d+),\s*(\d+)px\)/);
  assert.ok(m, 'style.css 应包含 #quick-picker 的 grid-template-columns');
  assert.equal(Number(m[1]), K.QUICK_PICKER_COLS, '九宫格列数应与 QUICK_PICKER_COLS 一致');
  assert.equal(Number(m[2]), K.QUICK_PICKER_CELL, '九宫格格宽应与 QUICK_PICKER_CELL 一致');
}

console.log('[OK] CSS 布局参数与 constants.js 一致（面板宽度 / 折叠宽度 / 动画时长 / 九宫格）');

// ---------------- 后端渲染参数 ----------------

const pyText = read('bead/export.py');

function pyConst(text, name) {
  // 只取值 token：双/单引号字符串或数字，避免被颜色值里的 # 与行尾注释干扰
  const m = text.match(new RegExp(`^${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[\\d.]+)`, 'm'));
  if (!m) return undefined;
  const raw = m[1];
  if (raw.startsWith('"') || raw.startsWith("'")) return raw.slice(1, -1);
  if (raw.includes('.')) return parseFloat(raw);
  return parseInt(raw, 10);
}

// 共享参数表：JS 常量名 → Python 常量名（值必须一致）
const SHARED = {
  EXPORT_CELL_DEFAULT: 'DEFAULT_CELL',
  EXPORT_QUALITY: 'DEFAULT_QUALITY',
  LEGEND_ENTRY_W: 'LEGEND_ENTRY_W',
  LEGEND_PAD_RATIO: 'LEGEND_PAD_RATIO',
  LEGEND_ROW_HEIGHT_CELLS: 'LEGEND_ROW_HEIGHT_CELLS',
  LEGEND_ROW_GAP: 'LEGEND_ROW_GAP',
  LEGEND_BOTTOM_GAP_RATIO: 'LEGEND_BOTTOM_GAP_RATIO',
  LEGEND_TOP_OFFSET_RATIO: 'LEGEND_TOP_OFFSET_RATIO',
  LEGEND_FONT_RATIO: 'LEGEND_FONT_RATIO',
  LEGEND_SWATCH_RATIO: 'LEGEND_SWATCH_RATIO',
  LEGEND_SWATCH_MIN: 'LEGEND_SWATCH_MIN',
  LEGEND_ROW_EXTRA_H: 'LEGEND_ROW_EXTRA_H',
  LEGEND_ROW_FONT_EXTRA: 'LEGEND_ROW_FONT_EXTRA',
  LEGEND_TEXT_GAP: 'LEGEND_TEXT_GAP',
  LEGEND_SWATCH_BORDER: 'LEGEND_SWATCH_BORDER',
  LEGEND_TEXT_COLOR: 'LEGEND_TEXT_COLOR',
  GRID_LINE_THIN_RATIO: 'GRID_LINE_THIN_RATIO',
  GRID_LINE_THICK_RATIO: 'GRID_LINE_THICK_RATIO',
  GRID_DASH_RATIO: 'GRID_DASH_RATIO',
  GRID_LINE_COLOR: 'GRID_LINE_COLOR',
  GRID_BOUNDARY_COLOR: 'GRID_BOUNDARY_COLOR',
  CODE_MIN_CELL: 'CODE_MIN_CELL',
  CODE_FONT_RATIO: 'CODE_FONT_RATIO',
  EDGE_NUMBER_BG: 'EDGE_NUMBER_BG',
  EDGE_NUMBER_FONT_RATIO: 'EDGE_NUMBER_FONT_RATIO',
  EDGE_NUMBER_MIN_CELL: 'EDGE_NUMBER_MIN_CELL',
};

for (const [jsName, pyName] of Object.entries(SHARED)) {
  const jsVal = K[jsName];
  const pyVal = pyConst(pyText, pyName);
  assert.ok(jsVal !== undefined, `constants.js 缺少 ${jsName}`);
  assert.ok(pyVal !== undefined, `bead/export.py 缺少 ${pyName}`);
  assert.equal(jsVal, pyVal, `${jsName}（前端 constants.js）应与 ${pyName}（后端 export.py）保持一致`);
}

// 有意保留的差异：行为/实现不同，锁定当前值防止意外漂移
const EXCEPTIONS = [
  { jsName: 'LEGEND_TEXT_DESCENT', js: 3, pyName: 'LEGEND_TEXT_DESCENT', py: 2,
    reason: 'JS 用 alphabetic 基线、PIL 用 mm 锚点，垂直定位公式不同' },
  { jsName: 'LEGEND_FONT_MIN', js: 12, pyName: 'FONT_MIN', py: 8,
    reason: 'PIL 侧图例与格内色号共用 FONT_MIN=8，前端图例下限更大' },
  { jsName: 'CODE_FONT_MIN', js: 8, pyName: 'FONT_MIN', py: 8,
    reason: 'PIL 侧与图例共用 FONT_MIN' },
  { jsName: null, js: 1, pyName: 'EMPTY_LINE_DIVISOR', py: 16,
    reason: '前端空位斜线固定 1px，PIL 按格尺寸缩放（cell//16）' },
];
for (const e of EXCEPTIONS) {
  const jsVal = e.jsName ? K[e.jsName] : e.js;
  const pyVal = pyConst(pyText, e.pyName);
  assert.equal(jsVal, e.js, `${e.jsName || '（空位斜线）'} 例外值变化，需同步更新测试`);
  assert.equal(pyVal, e.py, `${e.pyName} 例外值变化，需同步更新测试`);
}

// 空位样式（底色 + 斜线色）
{
  const m = pyText.match(/EMPTY_STYLES\s*=\s*\{(.+?)\}/s);
  assert.ok(m, 'bead/export.py 应包含 EMPTY_STYLES');
  const py = {};
  for (const [, key, bg, line] of m[1].matchAll(/"?(\w+)"?\s*:\s*\(\s*("[^"]+")\s*,\s*("[^"]+")/g)) {
    py[key] = { bg: bg.slice(1, -1), line: line.slice(1, -1) };
  }
  assert.deepEqual(py, K.EMPTY_STYLES, 'EMPTY_STYLES 应与后端保持一致');
}

// app.py 与 constants.js 的默认目标像素量
{
  const appText = read('app.py');
  assert.equal(pyConst(appText, 'DEFAULT_TARGET_PIXELS'), K.DEFAULT_TARGET_PIXELS,
    'app.py DEFAULT_TARGET_PIXELS 应与 constants.js 保持一致');
}

console.log('[OK] 渲染参数与 bead/export.py 一致（图例 / 网格线 / 色号 / 空位样式 / 导出默认值）');
console.log('[OK] app.py 与 constants.js 的默认目标像素量一致');
console.log('\n常量同步测试全部通过');
