// 颜色计算 Worker 封装：优先走 Web Worker，环境不支持（如 Node 测试 / 隐私模式）时
// 自动降级为同步实现，调用方无需感知差异。

import * as C from './colors.js';

/** @type {Worker | null} */
let worker = null;
let nextId = 1;
/** @type {Map<number, { resolve: (msg: any) => void, reject: (err: Error) => void }>} */
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./color-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      if (msg.ok) request.resolve(msg);
      else request.reject(new Error(msg.error || '颜色计算失败'));
    };
    worker.onerror = (err) => {
      const requests = [...pending.values()];
      pending.clear();
      for (const request of requests) {
        request.reject(new Error(err.message || '颜色计算 Worker 异常'));
      }
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

/** @param {string} type @param {any} payload @returns {Promise<any>} */
function post(type, payload) {
  const target = ensureWorker();
  if (!target) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    target.postMessage({ id, type, ...payload });
  });
}

/**
 * 异步最近色映射；无 Worker 或失败时降级为同步实现。
 * @returns {Promise<{grid: Int16Array, counts: number[]}>}
 */
/** @param {Uint8ClampedArray | Uint8Array} rgba @param {number} width @param {number} height @param {Array<{ hex: string }>} palette @param {boolean} useLab @returns {Promise<{ grid: Int16Array, counts: number[] }>} */
export async function computeInitialMappingAsync(rgba, width, height, palette, useLab) {
  try {
    const msg = await post('mapping', { rgba, width, height, palette, useLab });
    if (!msg) return C.computeInitialMapping(rgba, width, height, palette, useLab);
    return { grid: new Int16Array(msg.grid), counts: msg.counts };
  } catch {
    return C.computeInitialMapping(rgba, width, height, palette, useLab);
  }
}

/**
 * 异步颜色合并；返回 Int16Array，无 Worker 或失败时返回 null（调用方回退同步 mergeGrid）。
 * @returns {Promise<Int16Array | null>}
 */
/** @param {Int16Array | number[]} baseGrid @param {number} width @param {number} height @param {Array<{ hex: string }>} palette @param {boolean} useLab @param {number} n @returns {Promise<Int16Array | null>} */
export async function mergeGridAsync(baseGrid, width, height, palette, useLab, n) {
  try {
    const msg = await post('merge', { baseGrid, width, height, palette, useLab, n });
    if (!msg) return null;
    return new Int16Array(msg.grid);
  } catch {
    return null;
  }
}
