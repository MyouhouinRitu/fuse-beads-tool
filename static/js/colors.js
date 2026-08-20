// 颜色工具：sRGB <-> Lab、距离计算、最近色映射、贪心合并

import { LUMINANCE_THRESHOLD } from './constants.js';

/** @param {string} hex @returns {[number, number, number]} */
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 打包 / 解包 0xRRGGBB：画布显示数据用整数存储像素色
/** @param {number[]} rgb @returns {number} */
export function packRgb(rgb) {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

/** @param {number} packed @returns {string} */
export function hex6(packed) {
  return (
    ((packed >>> 16) & 255).toString(16).padStart(2, '0') +
    ((packed >>> 8) & 255).toString(16).padStart(2, '0') +
    (packed & 255).toString(16).padStart(2, '0')
  );
}

/** @param {number} v @returns {[number, number, number]} */
export function rgbFromPacked(v) {
  return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

// 感知亮度判断：≥ 阈值视为亮色（用于文字、描边等对比色选择）
/** @param {number[]} rgb @returns {boolean} */
export function isLightColor(rgb) {
  return luminance(rgb) >= LUMINANCE_THRESHOLD;
}

/** @param {number[]} rgb @returns {number} */
export function luminance(rgb) {
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
}

/** @param {number} v @returns {number} */
function srgbToLinear(v) {
  v = Math.max(0, Math.min(1, v / 255));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** @param {number} r @param {number} g @param {number} b @returns {[number, number, number]} */
export function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r),
    gl = srgbToLinear(g),
    bl = srgbToLinear(b);
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  const fx = x / xn > 0.008856 ? Math.cbrt(x / xn) : 7.787 * (x / xn) + 16 / 116;
  const fy = y / yn > 0.008856 ? Math.cbrt(y / yn) : 7.787 * (y / yn) + 16 / 116;
  const fz = z / zn > 0.008856 ? Math.cbrt(z / zn) : 7.787 * (z / zn) + 16 / 116;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** @param {number[]} rgb1 @param {number[]} rgb2 @param {boolean} useLab @returns {number} */
export function colorDist2(rgb1, rgb2, useLab) {
  if (useLab) {
    const a = rgbToLab(rgb1[0], rgb1[1], rgb1[2]);
    const b = rgbToLab(rgb2[0], rgb2[1], rgb2[2]);
    const dl = a[0] - b[0],
      da = a[1] - b[1],
      db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }
  const dr = rgb1[0] - rgb2[0],
    dg = rgb1[1] - rgb2[1],
    db = rgb1[2] - rgb2[2];
  const rm = (rgb1[0] + rgb2[0]) / 2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** @param {number} r @param {number} g @param {number} b @param {Array<number[]>} palRgb @param {Array<number[]> | null} palLab @param {boolean} useLab @returns {number[]} */
function nearestIndices(r, g, b, palRgb, palLab, useLab) {
  let minD = Infinity;
  /** @type {number[]} */
  let list = [];
  const lab = useLab ? rgbToLab(r, g, b) : null;
  for (let i = 0; i < palRgb.length; i++) {
    let d;
    if (useLab) {
      const p = /** @type {Array<number[]>} */ (palLab)[i];
      const labVal = /** @type {number[]} */ (lab);
      const dl = labVal[0] - p[0],
        da = labVal[1] - p[1],
        db = labVal[2] - p[2];
      d = dl * dl + da * da + db * db;
    } else {
      const p = palRgb[i];
      const dr = r - p[0],
        dg = g - p[1],
        db = b - p[2];
      const rm = (r + p[0]) / 2;
      d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    }
    if (d < minD - 1e-9) {
      minD = d;
      list = [i];
    } else if (Math.abs(d - minD) <= 1e-9) {
      list.push(i);
    }
  }
  return list;
}

// 透明判定阈值：alpha 低于该值的像素视为透明，映射为空位（浅灰 X）
const TRANSPARENT_ALPHA = 128;

// 功能三第 1~4 步：计算最相近色并处理平局
/** @param {Uint8ClampedArray | Uint8Array} rgba @param {number} width @param {number} height @param {Array<{ hex: string }>} palette @param {boolean} useLab @returns {{ grid: Int16Array, counts: number[] }} */
export function computeInitialMapping(rgba, width, height, palette, useLab) {
  const palRgb = palette.map((p) => hexToRgb(p.hex));
  const palLab = useLab ? palRgb.map((c) => rgbToLab(c[0], c[1], c[2])) : null;
  const n = width * height;
  const grid = new Int16Array(n);
  grid.fill(-1);
  /** @type {number[]} */
  const counts = new Array(palette.length).fill(0);
  /** @type {Map<number, number[]>} */
  const cache = new Map();
  /** @type {Array<{ p: number, list: number[] }>} */
  const unassigned = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = rgba[i],
        g = rgba[i + 1],
        b = rgba[i + 2];
      const a = rgba[i + 3];
      if (a < TRANSPARENT_ALPHA) continue; // 透明像素：保留空位，不参与取色
      if (a < 255) {
        // 半透明像素先合成到白底，再参与最近色映射，避免边缘偏色
        const f = a / 255;
        const bg = 255;
        r = Math.round(r * f + bg * (1 - f));
        g = Math.round(g * f + bg * (1 - f));
        b = Math.round(b * f + bg * (1 - f));
      }
      const key = (r << 16) | (g << 8) | b;
      let list = cache.get(key);
      if (!list) {
        list = nearestIndices(r, g, b, palRgb, palLab, useLab);
        cache.set(key, list);
      }
      const p = y * width + x;
      if (list.length === 1) {
        grid[p] = list[0];
        counts[list[0]]++;
      } else {
        unassigned.push({ p, list });
      }
    }
  }

  // 第三步：按已确认豆数量最多者确定；平局暂不设色
  let remaining = tieBreakPass(unassigned, counts, grid, false);
  // 第四步前半：再比较一次
  remaining = tieBreakPass(remaining, counts, grid, false);
  // 第四步后半：按左-上-右-下顺序确定
  tieBreakPass(remaining, counts, grid, true);

  return { grid, counts };
}

/** @param {Array<{ p: number, list: number[] }>} items @param {number[]} counts @param {Int16Array} grid @param {boolean} positional @returns {Array<{ p: number, list: number[] }>} */
function tieBreakPass(items, counts, grid, positional) {
  const remain = [];
  for (const u of items) {
    let best = -1,
      bestC = -1;
    for (const c of u.list) {
      const cc = counts[c];
      if (cc > bestC || (positional && cc === bestC && (best < 0 || c < best))) {
        best = c;
        bestC = cc;
      } else if (!positional && cc === bestC) {
        best = -2; // 平局标记
      }
    }
    if (best >= 0) {
      grid[u.p] = best;
      counts[best]++;
    } else {
      remain.push(u);
    }
  }
  return remain;
}

/** @param {Int16Array | number[]} grid @param {number} width @param {number} height @returns {number[]} */
export function computeUsedCounts(grid, width, height) {
  /** @type {number[]} */
  const counts = [];
  for (let p = 0; p < width * height; p++) {
    const v = grid[p];
    if (v >= 0) {
      counts[v] = (counts[v] || 0) + 1;
    }
  }
  return counts;
}

// 当前使用中的颜色种数（按格子色号去重统计）
/** @param {Int16Array | number[]} grid @param {number} width @param {number} height @returns {number} */
export function countUsedColors(grid, width, height) {
  const seen = new Set();
  for (let p = 0; p < width * height; p++) {
    const v = grid[p];
    if (v >= 0) seen.add(v);
  }
  return seen.size;
}

/** @typedef {{ d: number, a: number, b: number, va: number, vb: number }} MinHeapEntry */
class MinHeap {
  constructor() {
    /** @type {MinHeapEntry[]} */
    this.a = [];
  }
  /** @param {MinHeapEntry} x */
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  /** @returns {MinHeapEntry | null} */
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = /** @type {MinHeapEntry} */ (last);
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// 贪心合并：每次合并距离最近的两簇颜色（按像素数加权），直到簇数 <= targetN
/** @param {number[]} counts @param {Array<{ hex: string }>} palette @param {boolean} useLab @param {number} targetN @returns {{ rep: Map<number, number>, color: Map<number, number[]> }} */
export function buildMergeMap(counts, palette, useLab, targetN) {
  /** @type {Map<number, number>} */
  const rep = new Map();
  /** @type {Map<number, number[]>} */
  const color = new Map();
  /** @type {number[]} */
  const present = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) present.push(i);
  const total = present.length;
  const target = Math.max(1, Math.min(targetN || total, total));
  if (target >= total) {
    for (const i of present) {
      rep.set(i, i);
      color.set(i, hexToRgb(palette[i].hex));
    }
    return { rep, color };
  }

  const alive = new Uint8Array(total);
  const ver = new Int32Array(total);
  const cnt = new Float64Array(total);
  const idx = new Int32Array(total);
  /** @type {number[][]} */
  const rgb = new Array(total);
  const parent = present.map((_, i) => i);
  for (let i = 0; i < total; i++) {
    alive[i] = 1;
    cnt[i] = counts[present[i]];
    idx[i] = present[i];
    rgb[i] = hexToRgb(palette[present[i]].hex);
  }
  /** @param {number} x */
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const heap = new MinHeap();
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      heap.push({ d: colorDist2(rgb[i], rgb[j], useLab), a: i, b: j, va: ver[i], vb: ver[j] });
    }
  }

  let aliveCount = total;
  while (aliveCount > target) {
    let e;
    do {
      e = heap.pop();
    } while (e && (!alive[e.a] || !alive[e.b] || e.va !== ver[e.a] || e.vb !== ver[e.b]));
    if (!e) break;
    let keep = e.a,
      dead = e.b;
    if (cnt[e.b] > cnt[e.a]) {
      keep = e.b;
      dead = e.a;
    }
    const wKeep = cnt[keep],
      wDead = cnt[dead];
    const kc = rgb[keep],
      dc = rgb[dead];
    rgb[keep] = [
      (kc[0] * wKeep + dc[0] * wDead) / (wKeep + wDead),
      (kc[1] * wKeep + dc[1] * wDead) / (wKeep + wDead),
      (kc[2] * wKeep + dc[2] * wDead) / (wKeep + wDead),
    ];
    cnt[keep] = wKeep + wDead;
    parent[dead] = keep;
    alive[dead] = 0;
    ver[dead]++;
    ver[keep]++;
    for (let k = 0; k < total; k++) {
      if (alive[k] && k !== keep) {
        heap.push({
          d: colorDist2(rgb[keep], rgb[k], useLab),
          a: keep,
          b: k,
          va: ver[keep],
          vb: ver[k],
        });
      }
    }
    aliveCount--;
  }

  for (let i = 0; i < total; i++) {
    const root = find(i);
    const orig = present[i];
    rep.set(orig, idx[root]);
    color.set(idx[root], rgb[root]);
  }
  return { rep, color };
}
