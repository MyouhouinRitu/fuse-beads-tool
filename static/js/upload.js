// 图片导入与重新压缩：上传、映射为拼豆网格、应用到工作区。

import * as api from './api.js';
import * as C from './colors.js';
import { els } from './els.js';
import { App, setProjectDirty } from './state.js';
import { getTargetPixels, toast } from './utils.js';
import { resetProjectEditingState } from './canvas.js';
import { fitViewportToCanvas } from './view.js';
import { scheduleAutosave } from './autosave.js';
import { renderAllNow } from './render-queue.js';
import { confirmClearRecords } from './history-ui.js';

export async function processUpload() {
  if (!App.originalFile && !App.originalId) {
    toast('请先导入图片');
    return;
  }
  try {
    const target = getTargetPixels();
    const oldOriginalId = App.originalId;
    const res = await api.uploadImage(App.originalFile || null, target, els.chkSharpen.checked, App.originalId);
    const img = new Image();
    img.src = 'data:image/png;base64,' + res.pngBase64;
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; });
    const off = document.createElement('canvas');
    off.width = res.width;
    off.height = res.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    const rgba = octx.getImageData(0, 0, res.width, res.height).data;
    App.compressed = { rgba, width: res.width, height: res.height };
    App.originalId = res.originalId || null;
    App.originalName = res.originalName || null;
    App.originalSha256 = res.originalSha256 || null;
    App.originalSize = res.originalSize || null;
    App.projectName = String(App.originalName || res.originalName || '')
      .replace(/\.[^.]+$/, '').trim() || '未命名';
    if (oldOriginalId && oldOriginalId !== App.originalId) {
      api.deleteOriginal(oldOriginalId).catch(() => {});
    }
    applyMapping();
    setProjectDirty(true);
    const used = C.countUsedColors(App.project.grid, App.project.width, App.project.height);
    toast(`已导入 ${res.width} × ${res.height}，共使用 ${used} 种颜色`);
  } catch (err) {
    toast('导入失败：' + err.message);
  }
}

function applyMapping() {
  if (!App.compressed) return;
  const isNew = !App.project;
  const { rgba, width, height } = App.compressed;
  const { grid } = C.computeInitialMapping(rgba, width, height, App.palette, App.settings.useLab);
  App.project = { width, height, grid };
  App.baseGrid = grid.slice();
  // 重新压缩/导入后，当前色板配置成为已应用色板（画布与编辑工具随之更新）
  App.appliedPalette = App.palette.map((c) => ({ ...c }));
  // 网格被替换，九宫格目标格索引可能失效
  resetProjectEditingState();
  App.maxColors = Math.max(2, C.countUsedColors(grid, width, height));
  App.sliderN = null;
  App.editedSinceSlider = false;
  renderAllNow();
  if (isNew) fitViewportToCanvas();
  scheduleAutosave();
}

export async function recompress() {
  if (!App.originalFile && !App.originalId) { toast('请先导入图片'); return; }
  if (App.project && App.dirty) {
    if (!confirm('重新压缩将按新设置重新生成图案，并丢弃画布上的手动修改。是否继续？')) return;
  }
  if (!confirmClearRecords('重新压缩将清空全部事务历史与撤销记录。是否继续？')) return;
  await processUpload();
  fitViewportToCanvas(); // 重新压缩后默认适应窗口
}
