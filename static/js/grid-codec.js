// 网格（Int16Array）<-> base64 编解码：自动保存载荷用紧凑编码替代大数组 JSON，
// 显著缩小 state.json 体积；项目文件（.ssfbp）与内存态仍保持数组/Int16Array 不变。

const CHUNK = 0x8000;

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 小端 Int16Array -> base64（含负数，如空位 -1）
export function encodeInt16Grid(grid) {
  const i16 = grid instanceof Int16Array ? grid : Int16Array.from(grid);
  return bytesToBase64(new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength));
}

// base64 -> Int16Array；输入损坏或长度为奇数时返回 null，由调用方决定降级策略
export function decodeInt16Grid(b64) {
  try {
    const bytes = base64ToBytes(String(b64 || ''));
    if (!bytes.length || bytes.length % 2 !== 0) return null;
    return new Int16Array(bytes.buffer.slice(0));
  } catch (_e) {
    return null;
  }
}
