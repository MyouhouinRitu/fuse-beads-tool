// 元数据与编码检查：防止 package.json 等元数据文件出现 GBK/ANSI 写入或乱码退化。
// 运行：node scripts/check-meta.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = path.join(ROOT, 'package.json');

// 1) 严格 UTF-8 校验：GBK/ANSI 写入的字节在此会直接抛错。
const raw = fs.readFileSync(PKG_PATH);
new TextDecoder('utf-8', { fatal: true }).decode(raw);

// 2) 结构校验。
const pkg = JSON.parse(raw.toString('utf8'));
let failed = false;
const fail = (msg) => {
  console.error('[check-meta] FAIL: ' + msg);
  failed = true;
};

if (typeof pkg.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)) {
  fail('name 必须是小写字母/数字/连字符：' + JSON.stringify(pkg.name));
}
if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  fail('version 必须符合 x.y.z：' + JSON.stringify(pkg.version));
}
if (typeof pkg.description !== 'string' || pkg.description.trim() === '') {
  fail('description 必须是非空字符串');
}

// 3) 乱码启发式检测：UTF-8 被误读为 GBK 时会产出下列高频“伪汉字”。
//    这些字符在现代中文文案中几乎不会出现，命中即视为编码损坏。
//    （例如旧的 description：“鎷艰眴锛圥erler / Fuse Beads锛夊浘妗堝埗浣滃伐鍏峰墠绔”）
if (typeof pkg.description === 'string') {
  const MOJIBAKE_CHARS =
    '鎷眴锛夊浘妗堝埗鍏墠绔鐢鍥墿搴璇ヨ嶆槸鍚楀缂栫爜閰鑹鏁鍒鎵缁鏂囦鍑彛鎺ュ杩涘';
  const bad = [...pkg.description].filter((ch) => MOJIBAKE_CHARS.includes(ch));
  if (bad.length > 0) {
    fail('description 疑似乱码（命中字符：' + [...new Set(bad)].join(' ') + '）：' + pkg.description);
  }
  if (/[\u0000-\u001f\u007f\ufffd]/.test(pkg.description)) {
    fail('description 包含控制字符或替换字符 U+FFFD');
  }
}

if (failed) process.exit(1);
console.log('[check-meta] OK: ' + pkg.name + '@' + pkg.version);