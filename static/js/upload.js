// 图片导入与重新压缩：上传、映射为拼豆网格、应用到工作区。

import * as api from './api.js';
import { scheduleAutosave } from './autosave.js';
import { resetProjectEditingState } from './canvas.js';
import { computeInitialMappingAsync } from './color-queue.js';
import * as C from './colors.js';
import { redrawOriginalImage } from './compare.js';
import { els } from './els.js';
import * as historyUI from './history-ui.js';
import { confirmDialog } from './popup.js';
import { renderFullNow } from './render-queue.js';
import { App, clearHistoryRecords, hasPendingRecords, setProjectDirty } from './state.js';
import { fileNameStem, getTargetPixels, toast } from './utils.js';
import { fitViewportToCanvas } from './view.js';

export async function processUpload() {
  if (!App.originalFile && !App.originalId) {
    toast('请先导入图片');
    return;
  }
  try {
    const target = getTargetPixels();
    const oldOriginalId = App.originalId;
    const res = await api.uploadImage(
      App.originalFile || null,
      target,
      els.chkSharpen.checked,
      App.originalId,
      els.chkMirror.checked,
    );
    const img = new Image();
    img.src = `data:image/png;base64,${res.pngBase64}`;
    await new Promise((ok, fail) => {
      img.onload = ok;
      img.onerror = fail;
    });
    const off = document.createElement('canvas');
    off.width = res.width;
    off.height = res.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    const rgba = octx.getImageData(0, 0, res.width, res.height).data;
    App.compressed = { rgba, width: res.width, height: res.height };
    App.originalId = res.originalId || null;
    // 本次上传未带真实文件（如从项目/状态恢复的 Blob 或仅按 originalId 重压）时，
    // 后端无法得知原图文件名，保留已有名称，避免被 "blob"/占位名覆盖。
    const hadRealFile =
      !!App.originalFile &&
      typeof App.originalFile.name === 'string' &&
      App.originalFile.name !== '';
    App.originalName = hadRealFile
      ? res.originalName || null
      : App.originalName || res.originalName || null;
    App.originalSha256 = res.originalSha256 || null;
    App.originalSize = res.originalSize || null;
    // 重新压缩/导入后按当前镜像设置重绘对比原图
    redrawOriginalImage();
    App.projectName = fileNameStem(App.originalName || res.originalName || '') || '未命名';
    if (oldOriginalId && oldOriginalId !== App.originalId) {
      api.deleteOriginal(oldOriginalId).catch(() => {});
    }
    await applyMapping();
    // 上传成功后才清空旧快照，避免失败时误丢历史记录
    historyUI.clearAll({ silent: true });
    setProjectDirty(true);
    const used = C.countUsedColors(App.project.grid, App.project.width, App.project.height);
    toast(`已导入 ${res.width} × ${res.height}，共使用 ${used} 种颜色`, { type: 'success' });
  } catch (err) {
    toast(`导入失败：${err.message}`, { type: 'error' });
  }
}

async function applyMapping() {
  if (!App.compressed) return;
  const isNew = !App.project;
  const { rgba, width, height } = App.compressed;
  const { grid } = await computeInitialMappingAsync(
    rgba,
    width,
    height,
    App.palette,
    App.settings.useLab,
  );
  App.project = { width, height, grid };
  App.baseGrid = grid.slice();
  // 重新压缩/导入后，当前色板配置成为已应用色板（画布与编辑工具随之更新）
  App.appliedPalette = App.palette.map((c) => ({ ...c }));
  // 网格被替换，九宫格目标格索引可能失效
  resetProjectEditingState();
  App.maxColors = Math.max(2, C.countUsedColors(grid, width, height));
  App.sliderN = null;
  App.editedSinceSlider = false;
  renderFullNow();
  if (isNew) fitViewportToCanvas();
  scheduleAutosave();
}

export async function recompress() {
  if (!App.originalFile && !App.originalId) {
    toast('请先导入图片');
    return;
  }
  const consequences = [];
  if (App.project && App.dirty) consequences.push('丢弃画布上的手动修改');
  const needClear = hasPendingRecords();
  if (needClear) consequences.push('清空全部快照与撤销记录');
  if (consequences.length) {
    const message = `重新压缩将按新设置重新生成图案，并${consequences.join('、')}。是否继续？`;
    if (!(await confirmDialog(message))) return;
  }
  if (needClear) {
    clearHistoryRecords();
    historyUI.renderHistoryUI();
  }
  await processUpload();
  fitViewportToCanvas(); // 重新压缩后默认适应窗口
}
