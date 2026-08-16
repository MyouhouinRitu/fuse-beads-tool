// 颜色计算 Worker：把最耗时的最近色映射 / 贪心合并移出主线程。
// 协议：postMessage({ id, type: 'mapping' | 'merge', ...payload })，
// 结果以 ArrayBuffer 形式回传（结构化克隆；30k 格仅约 60KB，拷贝开销可忽略）。

import { buildMergeMap, computeInitialMapping, computeUsedCounts } from './colors.js';

self.onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'mapping') {
      const { rgba, width, height, palette, useLab } = e.data;
      const { grid, counts } = computeInitialMapping(rgba, width, height, palette, useLab);
      self.postMessage({ id, ok: true, grid: grid.buffer, counts });
      return;
    }
    if (type === 'merge') {
      const { baseGrid, width, height, palette, useLab, n } = e.data;
      const source = baseGrid instanceof Int16Array ? baseGrid : Int16Array.from(baseGrid);
      const counts = computeUsedCounts(source, width, height);
      const merge = buildMergeMap(counts, palette, useLab, n);
      const out = new Int16Array(source.length);
      for (let p = 0; p < source.length; p++) {
        const v = source[p];
        out[p] = v < 0 ? -1 : (merge.rep.get(v) ?? v);
      }
      self.postMessage({ id, ok: true, grid: out.buffer });
      return;
    }
    self.postMessage({ id, ok: false, error: `未知任务类型：${type}` });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
