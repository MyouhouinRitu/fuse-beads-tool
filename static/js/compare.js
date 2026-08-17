// 对比原图：IndexedDB 缓存、原图绘制、对比开关与同步拖拽开关。

import { scheduleAutosave } from './autosave.js';
import { ORIG_MAX_DIM } from './constants.js';
import { els } from './els.js';
import { App } from './state.js';
import { toast } from './utils.js';
import { applyOriginalTransform, fitOriginal, mirrorBeadToOrig } from './view.js';

// ---------- 原图缓存（IndexedDB，刷新后对比功能仍可用） ----------

const ORIGINAL_DB = 'fuse-beads-tool';
const ORIGINAL_STORE = 'originals';
const ORIGINAL_KEY = 'current';

function openOriginalDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(ORIGINAL_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ORIGINAL_STORE)) {
        req.result.createObjectStore(ORIGINAL_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveOriginalCache(blob) {
  try {
    const db = await openOriginalDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ORIGINAL_STORE, 'readwrite');
      tx.objectStore(ORIGINAL_STORE).put(blob, ORIGINAL_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_e) {
    // 缓存不可用时（隐私模式等）忽略，对比功能仅在本会话生效
  }
}

async function readOriginalCache() {
  try {
    const db = await openOriginalDB();
    const blob = await new Promise((resolve, reject) => {
      const tx = db.transaction(ORIGINAL_STORE, 'readonly');
      const req = tx.objectStore(ORIGINAL_STORE).get(ORIGINAL_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blob;
  } catch (_e) {
    return null;
  }
}

// 从浏览器缓存恢复原图（刷新后对比功能仍可用）
export async function restoreOriginalFromCache() {
  const blob = await readOriginalCache();
  if (!blob) return false;
  return loadOriginalImage(blob);
}

export function loadOriginalImage(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(false);
      return;
    }
    App.originalFile = file; // 缓存恢复时也保留原图句柄，刷新后「重新压缩」仍可用
    if (App.originalUrl) {
      try {
        URL.revokeObjectURL(App.originalUrl);
      } catch (_e) {
        /* ignore */
      }
    }
    App.originalUrl = null;
    App.originalImage = null;
    if (typeof URL.createObjectURL !== 'function') {
      resolve(false);
      return;
    }
    saveOriginalCache(file); // 缓存原图，刷新后仍可对比
    const url = URL.createObjectURL(file);
    App.originalUrl = url;
    const img = new Image();
    img.onload = () => {
      App.originalImage = img;
      drawOriginalImage();
      if (App.settings.compare) {
        if (App.settings.syncPan) mirrorBeadToOrig();
        else fitOriginal();
        applyOriginalTransform();
      }
      resolve(true);
    };
    img.onerror = () => {
      App.originalImage = null;
      toast('原图加载失败，无法使用对比功能');
      resolve(false);
    };
    img.src = url;
  });
}

function drawOriginalImage() {
  const cv = els.canvasOriginal;
  const img = App.originalImage;
  if (!img) return;
  const scale = Math.min(1, ORIG_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (App.settings.mirror) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
}

// 重新压缩/导入后按当前镜像设置重绘对比原图
export function redrawOriginalImage() {
  drawOriginalImage();
}

export function setCompareEnabled(on, { silent = false } = {}) {
  if (on && !App.project) {
    App.settings.compare = false;
    els.chkCompare.checked = false;
    if (!silent) toast('请先导入图片');
    return false;
  }
  if (on && !App.originalImage) {
    App.settings.compare = false;
    els.chkCompare.checked = false;
    if (!silent) toast('原图尚未加载，请先导入图片再使用对比');
    return false;
  }
  App.settings.compare = on;
  els.chkCompare.checked = on;
  if (!on && App.settings.syncPan) {
    // 取消对比原图时，同步拖拽一并取消
    App.settings.syncPan = false;
    els.chkSyncPan.checked = false;
  }
  els.canvasScroll.classList.toggle('compare-on', on);
  if (on) {
    drawOriginalImage();
    if (App.settings.syncPan) mirrorBeadToOrig();
    else fitOriginal();
    applyOriginalTransform();
  }
  scheduleAutosave();
  return true;
}

export function setSyncPan(on) {
  if (on && !(App.settings.compare && App.project && App.originalImage)) {
    const ok = setCompareEnabled(true);
    if (!ok) {
      els.chkSyncPan.checked = false;
      App.settings.syncPan = false;
      return;
    }
  }
  App.settings.syncPan = on;
  els.chkSyncPan.checked = on;
  if (on && App.originalImage) {
    // 同步拖拽：以拼豆图当前坐标/缩放为准，换算成原图的坐标与缩放
    mirrorBeadToOrig();
    applyOriginalTransform();
  }
  scheduleAutosave();
}
