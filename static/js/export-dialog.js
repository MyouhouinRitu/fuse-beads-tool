// 导出对话框：数据构建、实时预览与导出请求。

import * as api from './api.js';
import { buildCodes, buildDisplayData, buildLegend, sortLegend } from './canvas.js';
import * as C from './colors.js';
import {
  EXPORT_CELL_DEFAULT,
  EXPORT_CELL_MAX,
  EXPORT_CELL_MIN,
  EXPORT_COMPLETE_DELAY_MS,
  EXPORT_PAD_MAX,
  EXPORT_PREVIEW_CELL,
  EXPORT_PREVIEW_MAX_H,
  EXPORT_PREVIEW_MAX_W,
  EXPORT_QUALITY,
} from './constants.js';
import { els } from './els.js';
import { closeDialog, openDialog } from './focus.js';
import { drawPattern } from './render.js';
import { App } from './state.js';
import { clampInt, codeOf, downloadUrl, toast } from './utils.js';

let pdfPreviewPages = [];
let pdfPreviewIndex = 0;
let pdfPreviewTimer = null;

function buildExportData() {
  const n = App.project.width * App.project.height;
  const gridOut = new Int16Array(n);
  const codesOut = new Array(n).fill('');
  const hexMap = new Map();
  const paletteOut = []; // { index, hex, code, count }：导出专用紧凑调色板，图例与之共用索引
  for (let p = 0; p < n; p++) {
    const v = App.project.grid[p];
    if (v < 0) {
      gridOut[p] = -1;
      continue;
    }
    const hex = App.appliedPalette[v] ? App.appliedPalette[v].hex : '#FFFFFF';
    let i = hexMap.get(hex);
    if (i == null) {
      i = paletteOut.length;
      hexMap.set(hex, i);
      paletteOut.push({ index: i, hex, code: codeOf(App.appliedPalette[v]), count: 0 });
    }
    paletteOut[i].count++;
    codesOut[p] = paletteOut[i].code;
    gridOut[p] = i;
  }
  // 图例与导出调色板共用同一套索引：按豆数从多到少排序，数量相同按色号
  const legend = sortLegend(paletteOut.map(({ hex, code, count }) => ({ hex, code, count })));
  const palette = paletteOut.map(({ index, hex }) => ({ index, hex }));
  return { grid: Array.from(gridOut), palette, legend, codes: codesOut };
}

export function openExportDialog() {
  if (!App.project) {
    toast('请先导入图片');
    return;
  }
  clearTimeout(pdfPreviewTimer);
  pdfPreviewPages = [];
  pdfPreviewIndex = 0;
  els.dlgBusy.classList.add('hidden');
  els.dlgStatus.textContent = '';
  els.dlgPdfPages.classList.add('hidden');
  els.dlgPreviewMask.classList.add('hidden');
  els.dlgCodes.checked = App.settings.showCodes;
  els.exportDialog.classList.remove('hidden');
  openDialog(els.exportDialog);
  renderExportPreview();
}

// 关闭导出弹窗并重置全部弹窗状态，避免下次打开残留进度 / 页码 / 状态文案
export function closeExportDialog() {
  clearTimeout(pdfPreviewTimer);
  pdfPreviewPages = [];
  pdfPreviewIndex = 0;
  els.dlgBusy.classList.add('hidden');
  els.dlgStatus.textContent = '';
  els.dlgPdfPages.classList.add('hidden');
  els.dlgPreviewMask.classList.add('hidden');
  closeDialog();
  els.exportDialog.classList.add('hidden');
}

// 导出预览：用前端渲染器即时绘制一张小图（不经过后端，秒级响应）
export async function renderExportPreview() {
  if (!App.project) return;
  clearTimeout(pdfPreviewTimer);
  const fmt = els.dlgFormat.value;
  if (fmt.startsWith('pdf-')) {
    pdfPreviewTimer = setTimeout(() => renderPdfPreview(), 120);
    return;
  }
  els.dlgPdfPages.classList.add('hidden');
  els.dlgPreviewMask.classList.add('hidden');
  pdfPreviewPages = [];
  const counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  const legend = buildLegend(counts);
  const display = buildDisplayData();
  const cellSize = clampInt(
    els.dlgCell.value,
    EXPORT_CELL_MIN,
    EXPORT_CELL_MAX,
    EXPORT_CELL_DEFAULT,
  );
  const pad = clampInt(els.dlgPad.value, 0, EXPORT_PAD_MAX, 0);
  const showLegend = els.dlgLegend.checked;
  const previewCell = EXPORT_PREVIEW_CELL;
  const previewPad = Math.round((pad * previewCell) / cellSize);
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  drawPattern(octx, App.project.width, App.project.height, display.idx, display.rgb, {
    cell: previewCell,
    outerPad: previewPad,
    gridLines: els.dlgGrid.checked,
    hatch: true,
    emptyStyle: els.dlgEmptyStyle.value,
    edgeNumbers: els.dlgEdgeNumbers.checked,
    showCodes: els.dlgCodes.checked,
    codes: buildCodes(),
    legend: showLegend ? legend : [],
    showLegend,
    background: '#ffffff', // 导出预览以白底呈现（图例/外白边区域不透明）
  });
  const pv = els.dlgPreview;
  const scale = Math.min(EXPORT_PREVIEW_MAX_W / off.width, EXPORT_PREVIEW_MAX_H / off.height, 1);
  pv.width = Math.max(1, Math.round(off.width * scale));
  pv.height = Math.max(1, Math.round(off.height * scale));
  const pctx = pv.getContext('2d');
  pctx.clearRect(0, 0, pv.width, pv.height);
  pctx.drawImage(off, 0, 0, pv.width, pv.height);
}

function buildExportOptions(fmt) {
  return {
    cellSize: clampInt(els.dlgCell.value, EXPORT_CELL_MIN, EXPORT_CELL_MAX, EXPORT_CELL_DEFAULT),
    gridLines: els.dlgGrid.checked,
    outerPad: clampInt(els.dlgPad.value, 0, EXPORT_PAD_MAX, 0),
    edgeNumbers: els.dlgEdgeNumbers.checked,
    showCodes: els.dlgCodes.checked,
    legend: els.dlgLegend.checked,
    format: fmt,
    quality: EXPORT_QUALITY,
    emptyStyle: els.dlgEmptyStyle.value,
  };
}

async function renderPdfPreview() {
  const fmt = els.dlgFormat.value;
  if (!fmt.startsWith('pdf-') || !App.project) return;
  const { grid, palette, legend, codes } = buildExportData();
  els.dlgPreviewMask.classList.remove('hidden');
  try {
    const res = await api.exportPdfPreview({
      width: App.project.width,
      height: App.project.height,
      grid,
      palette,
      legend,
      codes,
      options: buildExportOptions(fmt),
    });
    pdfPreviewPages = res.pages || [];
    pdfPreviewIndex = Math.min(pdfPreviewIndex, Math.max(0, pdfPreviewPages.length - 1));
    renderPdfPageButtons();
    drawPdfPreviewPage();
  } catch (e) {
    els.dlgPdfPages.classList.add('hidden');
    toast(`PDF 预览生成失败：${e.message}`, { type: 'error' });
  } finally {
    els.dlgPreviewMask.classList.add('hidden');
  }
}

function renderPdfPageButtons() {
  const wrap = els.dlgPdfPages;
  wrap.innerHTML = '';
  if (!pdfPreviewPages.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  pdfPreviewPages.forEach((page, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = page.page;
    btn.className = i === pdfPreviewIndex ? 'active' : '';
    btn.title = page.paper + (page.landscape ? ' 横向' : ' 纵向');
    btn.addEventListener('click', () => {
      pdfPreviewIndex = i;
      renderPdfPageButtons();
      drawPdfPreviewPage();
    });
    wrap.appendChild(btn);
  });
}

function drawPdfPreviewPage() {
  const page = pdfPreviewPages[pdfPreviewIndex];
  if (!page) return;
  const img = new Image();
  img.onload = () => {
    const pv = els.dlgPreview;
    const scale = Math.min(EXPORT_PREVIEW_MAX_W / img.width, EXPORT_PREVIEW_MAX_H / img.height, 1);
    pv.width = Math.max(1, Math.round(img.width * scale));
    pv.height = Math.max(1, Math.round(img.height * scale));
    const pctx = pv.getContext('2d');
    pctx.fillStyle = '#e8eaee';
    pctx.fillRect(0, 0, pv.width, pv.height);
    pctx.drawImage(img, 0, 0, pv.width, pv.height);
  };
  img.src = page.dataUrl;
}

export async function doExport() {
  if (!App.project) return;
  const fmt = els.dlgFormat.value;
  const { grid, palette, legend, codes } = buildExportData();
  // 导出期间显示进度条并禁止操作导出界面
  els.dlgBusy.classList.remove('hidden');
  els.dlgStatus.textContent = '正在导出…';
  try {
    const res = await api.exportImage({
      width: App.project.width,
      height: App.project.height,
      grid,
      palette,
      legend,
      codes,
      options: buildExportOptions(fmt),
    });
    const ext = fmt.startsWith('pdf-') ? 'pdf' : fmt === 'png' ? 'png' : 'jpg';
    downloadUrl(res.dataUrl, `拼豆图案.${ext}`);
    els.dlgStatus.textContent = '导出完成';
    await new Promise((r) => setTimeout(r, EXPORT_COMPLETE_DELAY_MS)); // 稍作停留显示完成状态
    closeExportDialog();
  } catch (err) {
    toast(`导出失败：${err.message}`, { type: 'error' });
  } finally {
    els.dlgBusy.classList.add('hidden');
  }
}
