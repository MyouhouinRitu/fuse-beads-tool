// 跨语言常量同步测试：
// 前端 constants.js 与 style.css、后端 bead/export.py 之间存在跨语言重复的
// 布局/渲染参数（面板宽度、九宫格尺寸、图例/网格线/色号/空位样式等），
// 本测试在任一侧漂移时立即失败，把「靠注释约定同步」变成可执行的契约。
// 有意保留的行为差异集中在 EXCEPTIONS 中并锁定当前值，改动任一侧需同步更新。
//
// 运行：node tests/constants_sync_test.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { colorDist2, hexToRgb, isLightColor, rgbToLab } from '../static/js/colors.js';
import * as K from '../static/js/constants.js';
import { paletteHash } from '../static/js/hash.js';

const ROOT = path.dirname(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------------- CSS 布局参数 ----------------

const cssText = read('static/css/style.css');

function cssVar(name) {
  const m = cssText.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
const px = (v) => parseInt(v, 10);

assert.equal(
  px(cssVar('panel-left-width')),
  K.PANEL_FULL_WIDTH['left-panel'],
  '--panel-left-width 应与 PANEL_FULL_WIDTH 一致',
);
assert.equal(
  px(cssVar('panel-highlight-width')),
  K.PANEL_FULL_WIDTH['color-highlight-panel'],
  '--panel-highlight-width 应与 PANEL_FULL_WIDTH 一致',
);
assert.equal(
  px(cssVar('panel-right-width')),
  K.PANEL_FULL_WIDTH['right-panel'],
  '--panel-right-width 应与 PANEL_FULL_WIDTH 一致',
);
assert.equal(
  px(cssVar('panel-collapsed-width')),
  K.PANEL_COLLAPSED_WIDTH,
  '--panel-collapsed-width 应与 PANEL_COLLAPSED_WIDTH 一致',
);

{
  const m = cssText.match(/transition:\s*width\s+([\d.]+)s\s+ease/);
  assert.ok(m, 'style.css 应包含 aside 宽度过渡 transition: width 0.18s ease');
  assert.equal(
    Math.round(parseFloat(m[1]) * 1000),
    K.PANEL_ANIMATION_MS,
    'aside 宽度过渡时长应与 PANEL_ANIMATION_MS 一致',
  );
}

{
  const m = cssText.match(/grid-template-columns:\s*repeat\((\d+),\s*(\d+)px\)/);
  assert.ok(m, 'style.css 应包含 #quick-picker 的 grid-template-columns');
  assert.equal(Number(m[1]), K.QUICK_PICKER_COLS, '九宫格列数应与 QUICK_PICKER_COLS 一致');
  assert.equal(Number(m[2]), K.QUICK_PICKER_CELL, '九宫格格宽应与 QUICK_PICKER_CELL 一致');
}

// 提示条淡出时长：JS 常量（utils.js 的 toast 队列）与 CSS #toast 过渡保持一致
{
  const m = cssText.match(/transition:\s*opacity\s+([\d.]+)s/);
  assert.ok(m, 'style.css 应包含 #toast 的 transition: opacity 0.25s');
  assert.equal(
    Math.round(parseFloat(m[1]) * 1000),
    K.TOAST_FADE_MS,
    '#toast 淡出过渡时长应与 TOAST_FADE_MS 一致',
  );
}

console.log('[OK] CSS 布局参数与 constants.js 一致（面板宽度 / 折叠宽度 / 动画时长 / 九宫格）');

// 裁剪蒙版：JS 常量与 CSS 变量保持同一份 40% 黑
assert.equal(
  cssVar('crop-mask-rgba').replace(/\s+/g, ''),
  K.CROP_MASK_RGBA.replace(/\s+/g, ''),
  '--crop-mask-rgba 应与 CROP_MASK_RGBA 一致',
);

// 主题启动 bootstrap：index.html 内联脚本与 theme.js 共用同一个存储 key
{
  const htmlText = read('templates/index.html');
  assert.ok(
    htmlText.includes(`localStorage.getItem('${K.THEME_STORAGE_KEY}')`),
    'index.html 内联主题脚本应使用与 THEME_STORAGE_KEY 相同的 key',
  );
}

// ---------------- 后端渲染参数 ----------------

const pyText = read('bead/export.py');

function pyConst(text, name) {
  // 只取值 token：双/单引号字符串或数字，避免被颜色值里的 # 与行尾注释干扰
  const m = text.match(
    new RegExp(`^${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[\\d.]+)`, 'm'),
  );
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
  ATTRIBUTION_FONT_RATIO: 'ATTRIBUTION_FONT_RATIO',
  ATTRIBUTION_FONT_MIN: 'ATTRIBUTION_FONT_MIN',
  ATTRIBUTION_TOP_GAP_RATIO: 'ATTRIBUTION_TOP_GAP_RATIO',
  ATTRIBUTION_BOTTOM_GAP_RATIO: 'ATTRIBUTION_BOTTOM_GAP_RATIO',
  ATTRIBUTION_TEXT_COLOR: 'ATTRIBUTION_TEXT_COLOR',
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
  assert.equal(
    jsVal,
    pyVal,
    `${jsName}（前端 constants.js）应与 ${pyName}（后端 export.py）保持一致`,
  );
}

// 导出署名文案：前端与后端共用（后端定义于 bead/meta.py，经 export.py 引用）
{
  const metaText = read('bead/meta.py');
  const pyAttr = pyConst(metaText, 'ATTRIBUTION_TEXT');
  assert.ok(pyAttr !== undefined, 'bead/meta.py 应包含 ATTRIBUTION_TEXT');
  assert.equal(
    K.ATTRIBUTION_TEXT,
    pyAttr,
    'ATTRIBUTION_TEXT（前端 constants.js）应与 bead/meta.py 保持一致',
  );
}

// 有意保留的差异：行为/实现不同，锁定当前值防止意外漂移
const EXCEPTIONS = [
  {
    jsName: 'LEGEND_FONT_MIN',
    js: 12,
    pyName: 'FONT_MIN',
    py: 8,
    reason: 'PIL 侧图例与格内色号共用 FONT_MIN=8，前端图例下限更大',
  },
  {
    jsName: 'CODE_FONT_MIN',
    js: 8,
    pyName: 'FONT_MIN',
    py: 8,
    reason: 'PIL 侧与图例共用 FONT_MIN',
  },
  {
    jsName: null,
    js: 1,
    pyName: 'EMPTY_LINE_DIVISOR',
    py: 16,
    reason: '前端空位斜线固定 1px，PIL 按格尺寸缩放（cell//16）',
  },
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
  for (const [, key, bg, line] of m[1].matchAll(
    /"?(\w+)"?\s*:\s*\(\s*("[^"]+")\s*,\s*("[^"]+")/g,
  )) {
    py[key] = { bg: bg.slice(1, -1), line: line.slice(1, -1) };
  }
  assert.deepEqual(py, K.EMPTY_STYLES, 'EMPTY_STYLES 应与后端保持一致');
}

// bead/web/common.py / compress.py / 模板表单 与 constants.js 的目标像素量约束
{
  const appText = read('bead/web/common.py');
  assert.equal(
    pyConst(appText, 'DEFAULT_TARGET_PIXELS'),
    K.DEFAULT_TARGET_PIXELS,
    'bead/web/common.py DEFAULT_TARGET_PIXELS 应与 constants.js 保持一致',
  );
  const compressText = read('bead/compress.py');
  assert.equal(
    pyConst(compressText, 'MIN_TARGET_PIXELS'),
    K.TARGET_PIXELS_MIN,
    'bead/compress.py MIN_TARGET_PIXELS 应与 constants.js 保持一致',
  );
  assert.equal(
    pyConst(compressText, 'HARD_CAP_PIXELS'),
    K.TARGET_PIXELS_MAX,
    'bead/compress.py HARD_CAP_PIXELS 应与 constants.js TARGET_PIXELS_MAX 保持一致',
  );
  const htmlInput = read('templates/index.html').match(
    /<input type="number" id="target-pixels"[^>]*>/,
  );
  assert.ok(htmlInput, 'index.html 应包含 #target-pixels 输入框');
  const attr = (name) => htmlInput[0].match(new RegExp(`${name}="([^"]*)"`))?.[1];
  assert.equal(
    attr('min'),
    String(K.TARGET_PIXELS_MIN),
    'index.html #target-pixels min 应与 TARGET_PIXELS_MIN 保持一致',
  );
  assert.equal(
    attr('max'),
    String(K.TARGET_PIXELS_MAX),
    'index.html #target-pixels max 应与 TARGET_PIXELS_MAX 保持一致',
  );
  assert.equal(
    attr('step'),
    String(K.TARGET_PIXELS_STEP),
    'index.html #target-pixels step 应与 TARGET_PIXELS_STEP 保持一致',
  );
  assert.equal(
    attr('value'),
    String(K.DEFAULT_TARGET_PIXELS),
    'index.html #target-pixels value 应与 DEFAULT_TARGET_PIXELS 保持一致',
  );

  // 画笔 / 魔棒滑块范围：与 constants.js 保持一致
  const rangeAttr = (id, name) => {
    const html = read('templates/index.html');
    const m = html.match(new RegExp(`<input type="range" id="${id}"[^>]*>`));
    assert.ok(m, `index.html 应包含 #${id} 滑块`);
    return m[0].match(new RegExp(`${name}="([^"]*)"`))?.[1];
  };
  assert.equal(
    rangeAttr('brush-size', 'min'),
    String(K.BRUSH_SIZE_MIN),
    '#brush-size min 应与 BRUSH_SIZE_MIN 一致',
  );
  assert.equal(
    rangeAttr('brush-size', 'max'),
    String(K.BRUSH_SIZE_MAX),
    '#brush-size max 应与 BRUSH_SIZE_MAX 一致',
  );
  assert.equal(
    rangeAttr('wand-sensitivity', 'min'),
    String(K.WAND_SENSITIVITY_MIN),
    '#wand-sensitivity min 应与 WAND_SENSITIVITY_MIN 一致',
  );
  assert.equal(
    rangeAttr('wand-sensitivity', 'max'),
    String(K.WAND_SENSITIVITY_MAX),
    '#wand-sensitivity max 应与 WAND_SENSITIVITY_MAX 一致',
  );
  assert.equal(
    rangeAttr('wand-sensitivity', 'value'),
    String(K.WAND_SENSITIVITY_DEFAULT),
    '#wand-sensitivity value 应与 WAND_SENSITIVITY_DEFAULT 一致',
  );
}

console.log('[OK] 渲染参数与 bead/export.py 一致（图例 / 网格线 / 色号 / 空位样式 / 导出默认值）');
console.log(
  '[OK] bead/web/common.py / compress.py / index.html 与 constants.js 的目标像素量约束一致',
);

// ---------------- 版本号（package.json ↔ bead/version.py）----------------
{
  const pkg = JSON.parse(read('package.json'));
  const versionText = read('bead/version.py');
  const m = versionText.match(/^APP_VERSION\s*=\s*"([^"]+)"/m);
  assert.ok(m, 'bead/version.py 应包含 APP_VERSION');
  assert.equal(m[1], pkg.version, 'bead/version.py APP_VERSION 应与 package.json version 保持一致');
  assert.equal(
    K.APP_VERSION,
    pkg.version,
    'constants.js APP_VERSION 应与 package.json version 保持一致',
  );
  console.log('[OK] 版本号单一来源：package.json / bead/version.py / constants.js 一致');
}

// ---------------- 颜色数学（colors.py ↔ colors.js）----------------

function runPython(script, input = '') {
  return execFileSync(process.env.PYTHON || 'python', ['-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    timeout: 30000,
  });
}

{
  const colorsText = read('bead/colors.py');
  assert.equal(
    pyConst(colorsText, 'LUMINANCE_THRESHOLD'),
    K.LUMINANCE_THRESHOLD,
    'bead/colors.py LUMINANCE_THRESHOLD 应与 constants.js 保持一致',
  );

  // 采样集：固定边界/关键样本 + 确定性伪随机样本（种子固定，结果可复现）。
  // 用大规模采样把颜色数学的两端一致性从「抽查 10 个点」压到「边界 + 数百随机点」。
  const samples = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [128, 128, 128],
    [240, 128, 128],
    [10, 200, 30],
    [18, 52, 86],
    [200, 30, 10],
    // 边界与极端值
    [1, 1, 1],
    [254, 254, 254],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [100, 0, 0],
    [0, 100, 0],
    [0, 0, 100],
    [200, 200, 200],
    [55, 55, 55],
  ];
  // 确定性 LCG：避免测试结果随运行环境漂移
  let _seed = 0x5eed1234;
  const rand = () => {
    _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0;
    return _seed / 0x100000000;
  };
  for (let i = 0; i < 300; i++) {
    samples.push([Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)]);
  }
  const pairs = [];
  for (let i = 0; i < 10; i++) pairs.push([i, (i + 1) % 10]); // 固定样本环
  pairs.push([10, 12], [13, 15], [17, 19]); // 边界对
  for (let i = 0; i + 1 < samples.length; i += 7) pairs.push([i, i + 1]); // 随机相邻对
  const script = `
import json
from bead.colors import is_light_color, lab_distance, rgb_distance, rgb_to_lab
samples = ${JSON.stringify(samples)}
pairs = ${JSON.stringify(pairs)}
out = []
for rgb in samples:
    lab = [round(float(v), 9) for v in rgb_to_lab(rgb)]
    out.append({"rgb": rgb, "light": bool(is_light_color(tuple(rgb))), "lab": lab})
for a, b in pairs:
    la = rgb_to_lab(samples[a])
    lb = rgb_to_lab(samples[b])
    out.append({
        "rgbDist": round(float(rgb_distance(samples[a], samples[b])), 9),
        "labDist": round(float(lab_distance(la, lb)), 9),
    })
print(json.dumps(out, ensure_ascii=False))
`;
  const pyOut = JSON.parse(runPython(script));
  const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
  pyOut.slice(0, samples.length).forEach((entry) => {
    const [r, g, b] = entry.rgb;
    assert.equal(
      entry.light,
      isLightColor([r, g, b]),
      `isLightColor 应与 Python 一致：${entry.rgb}`,
    );
    const lab = rgbToLab(r, g, b);
    entry.lab.forEach((v, k) => assert.ok(approx(v, lab[k]), `Lab 分量 ${k} 不一致：${entry.rgb}`));
  });
  pyOut.slice(samples.length).forEach((entry, i) => {
    const [a, b] = pairs[i];
    const [ra, ga, ba] = samples[a];
    const [rb, gb, bb] = samples[b];
    assert.ok(
      approx(entry.rgbDist, colorDist2([ra, ga, ba], [rb, gb, bb], false)),
      `rgb_distance 不一致：pair ${i}`,
    );
    assert.ok(
      approx(entry.labDist, colorDist2([ra, ga, ba], [rb, gb, bb], true)),
      `Lab 距离不一致：pair ${i}`,
    );
  });
  console.log('[OK] 颜色数学与 bead/colors.py 一致（亮度阈值 / Lab / 距离公式）');
}

// ---------------- paletteHash（hash.js ↔ palette.py）----------------
{
  const palette = [
    { index: '2', code: 'B', name: '蓝', hex: '#0000ff' },
    { index: 1, code: 'A', name: '白', hex: '#FFFFFF' },
    { index: 2, code: 'B2', name: '', hex: '00ff00' },
    { index: 3, code: '', name: '红', hex: '#ff0000' },
    { index: 1.5, code: 'X', name: '浮点', hex: '#123456' },
    { index: '1.5', code: 'Y', name: '字符串浮点', hex: '#abcdef' },
    { index: null, code: 'N', name: '空', hex: '#000000' },
    { index: '', code: 'E', name: '空串', hex: '#111111' },
    { index: true, code: 'T', name: '布尔', hex: '#222222' },
    { index: '10', code: 'Z', name: '字符串10', hex: 'ABCDEF' },
    { index: 1, code: 'A2', name: '重复索引', hex: '#FEDCBA' },
  ];
  const script = `
import json, sys
from bead.palette import palette_hash
palette = json.loads(sys.stdin.read())
print(palette_hash(palette))
`;
  assert.equal(
    paletteHash(palette),
    runPython(script, JSON.stringify(palette)).trim(),
    'JS paletteHash 应与 bead/palette.py 对同一色板输出一致（含索引归一化与跳过规则）',
  );
  console.log(
    '[OK] paletteHash 与 bead/palette.py 输出一致（整数索引 / 跳过低效值 / 排序 / hex 大写）',
  );
}

// ---------------- hex 归一化（palette.py ↔ colors.js）----------------
{
  const inputs = ['#abc', '#ABCDEF', 'abc', 'ABCDEF', '#GGHHII', '', '#aabbcc', '123456', '#12f'];
  const script = `
import json
from bead.palette import normalize_color
inputs = ${JSON.stringify(inputs)}
print(json.dumps([normalize_color({"index": 1, "hex": h})["hex"] for h in inputs], ensure_ascii=False))
`;
  const pyHexes = JSON.parse(runPython(script));
  inputs.forEach((h, i) => {
    assert.deepEqual(
      hexToRgb(h),
      hexToRgb(pyHexes[i]),
      `hex 归一化后 RGB 应一致（前端 hexToRgb vs Python normalize_color）：${h}`,
    );
  });
  console.log('[OK] hex 归一化与 bead/palette.py 一致（3 位缩写展开 / 非法回退白）');
}

console.log('\n常量同步测试全部通过');
