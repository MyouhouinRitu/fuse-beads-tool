// 颜色工具：sRGB <-> Lab、距离计算、最近色映射、贪心合并

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToLinear(v) {
  v = Math.max(0, Math.min(1, v / 255));
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const fx = x / xn > 0.008856 ? Math.cbrt(x / xn) : 7.787 * (x / xn) + 16 / 116;
  const fy = y / yn > 0.008856 ? Math.cbrt(y / yn) : 7.787 * (y / yn) + 16 / 116;
  const fz = z / zn > 0.008856 ? Math.cbrt(z / zn) : 7.787 * (z / zn) + 16 / 116;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function colorDist2(rgb1, rgb2, useLab) {
  if (useLab) {
    const a = rgbToLab(rgb1[0], rgb1[1], rgb1[2]);
    const b = rgbToLab(rgb2[0], rgb2[1], rgb2[2]);
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }
  const dr = rgb1[0] - rgb2[0], dg = rgb1[1] - rgb2[1], db = rgb1[2] - rgb2[2];
  const rm = (rgb1[0] + rgb2[0]) / 2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

function nearestIndices(r, g, b, palRgb, palLab, useLab) {
  let minD = Infinity;
  let list = [];
  const lab = useLab ? rgbToLab(r, g, b) : null;
  for (let i = 0; i < palRgb.length; i++) {
    let d;
    if (useLab) {
      const p = palLab[i];
      const dl = lab[0] - p[0], da = lab[1] - p[1], db = lab[2] - p[2];
      d = dl * dl + da * da + db * db;
    } else {
      const p = palRgb[i];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
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
export function computeInitialMapping(rgba, width, height, palette, useLab) {
  const palRgb = palette.map((p) => hexToRgb(p.hex));
  const palLab = useLab ? palRgb.map((c) => rgbToLab(c[0], c[1], c[2])) : null;
  const n = width * height;
  const grid = new Int16Array(n);
  grid.fill(-1);
  const counts = new Array(palette.length).fill(0);
  const cache = new Map();
  const unassigned = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
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

function tieBreakPass(items, counts, grid, positional) {
  const remain = [];
  for (const u of items) {
    let best = -1, bestC = -1;
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

export function computeUsedCounts(grid, width, height) {
  const counts = [];
  for (let p = 0; p < width * height; p++) {
    const v = grid[p];
    if (v >= 0) {
      counts[v] = (counts[v] || 0) + 1;
    }
  }
  return counts;
}

class MinHeap {
  constructor() { this.a = []; }
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
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
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
export function buildMergeMap(counts, palette, useLab, targetN) {
  const rep = new Map();
  const color = new Map();
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
  const rgb = new Array(total);
  const parent = present.map((_, i) => i);
  for (let i = 0; i < total; i++) {
    alive[i] = 1;
    cnt[i] = counts[present[i]];
    idx[i] = present[i];
    rgb[i] = hexToRgb(palette[present[i]].hex);
  }
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
    let keep = e.a, dead = e.b;
    if (cnt[e.b] > cnt[e.a]) { keep = e.b; dead = e.a; }
    const wKeep = cnt[keep], wDead = cnt[dead];
    const kc = rgb[keep], dc = rgb[dead];
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
        heap.push({ d: colorDist2(rgb[keep], rgb[k], useLab), a: keep, b: k, va: ver[keep], vb: ver[k] });
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
