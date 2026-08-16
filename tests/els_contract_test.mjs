// els.js 与 templates/index.html 的 DOM 契约测试：
// - HTML 中每个 id 唯一；
// - els.js 引用的每个 id 必须真实存在于 HTML；
// - els.js 内每个键对应唯一 id，且同一 id 不得被重复引用；
// - 生产代码只允许通过 els.js 获取 DOM（单一注册表），禁止散落的 document.getElementById。
// 运行：node tests/els_contract_test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const htmlText = read('templates/index.html');
const elsText = read('static/js/els.js');

// ---- HTML id 唯一性 ----
const htmlIds = [...htmlText.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const dupIds = [...new Set(htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i))];
assert.deepEqual(dupIds, [], 'HTML 中存在重复 id');

// ---- els.js 键与 id 引用 ----
const elsEntries = [
  ...elsText.matchAll(/^ {2}([A-Za-z_$][\w$]*): \$\(['"]([^'"]+)['"]\),?$/gm),
].map((m) => ({ key: m[1], id: m[2] }));
assert.ok(elsEntries.length > 0, '未从 els.js 解析到任何元素注册');
assert.equal(new Set(elsEntries.map((e) => e.key)).size, elsEntries.length, 'els.js 中存在重复键');
const idsUsed = elsEntries.map((e) => e.id);
const dupIdsUsed = [...new Set(idsUsed.filter((id, i) => idsUsed.indexOf(id) !== i))];
assert.deepEqual(dupIdsUsed, [], 'els.js 中同一 id 被重复引用');

const htmlIdSet = new Set(htmlIds);
const missing = elsEntries.filter((e) => !htmlIdSet.has(e.id)).map((e) => `${e.key} -> ${e.id}`);
assert.deepEqual(missing, [], 'els.js 引用了 HTML 中不存在的 id');

// ---- 单一注册表：生产代码禁止散落 getElementById ----
const jsFiles = fs.readdirSync(path.join(ROOT, 'static/js')).filter((f) => f.endsWith('.js'));
const offenders = [];
for (const f of jsFiles) {
  if (f === 'els.js') continue;
  const text = fs.readFileSync(path.join(ROOT, 'static/js', f), 'utf8');
  text.split('\n').forEach((line, i) => {
    if (/document\.getElementById\s*\(/.test(line)) offenders.push(`${f}:${i + 1}`);
  });
}
assert.deepEqual(offenders, [], 'static/js 中除 els.js 外禁止使用 document.getElementById');

// ---- 未注册 id 仅作提示（纯样式/纯展示 id 可忽略）----
const referenced = new Set(idsUsed);
const unreferenced = htmlIds.filter((id) => !referenced.has(id));
console.log(
  '[OK] els.js 注册 ' +
    elsEntries.length +
    ' 个元素；HTML 共 ' +
    htmlIds.length +
    ' 个 id；未注册 ' +
    unreferenced.length +
    ' 个（仅提示）：' +
    unreferenced.join(', '),
);
