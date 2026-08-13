// 导出对话框：数据构建、实时预览与导出请求。

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
import * as api from './api.js';
import * as C from './colors.js';
import { els } from './els.js';
import { App } from './state.js';
import { clampInt, codeOf, downloadDataUrl, toast } from './utils.js';
import { drawPattern } from './render.js';
import { buildCodes, buildDisplayData, buildLegend } from './canvas.js';

function buildExportData() {
  const n = App.project.width * App.project.height;
  const gridOut = new Int16Array(n);
  const codesOut = new Array(n).fill('');
  const hexMap = new Map();
  const paletteOut = []; // { index, hex, code, count }：导出专用紧凑调色板，图例与之共用索引
  for (let p = 0; p < n; p++) {
    const v = App.project.grid[p];
    if (v < 0) { gridOut[p] = -1; continue; }
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
  const legend = paletteOut
    .map(({ hex, code, count }) => ({ hex, code, count }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const palette = paletteOut.map(({ index, hex }) => ({ index, hex }));
  return { grid: Array.from(gridOut), palette, legend, codes: codesOut };
}

export function openExportDialog() {
  if (!App.project) { toast('请先导入图片'); return; }
  els.dlgCodes.checked = App.settings.showCodes;
  els.exportDialog.classList.remove('hidden');
  renderExportPreview();
}

// 导出预览：用前端渲染器即时绘制一张小图（不经过后端，秒级响应）
export function renderExportPreview() {
  if (!App.project) return;
  const counts = C.computeUsedCounts(App.project.grid, App.project.width, App.project.height);
  const legend = buildLegend(counts);
  const display = buildDisplayData();
  const cellSize = clampInt(els.dlgCell.value, EXPORT_CELL_MIN, EXPORT_CELL_MAX, EXPORT_CELL_DEFAULT);
  const pad = clampInt(els.dlgPad.value, 0, EXPORT_PAD_MAX, 0);
  const showLegend = els.dlgLegend.checked;
  const previewCell = EXPORT_PREVIEW_CELL;
  const previewPad = Math.round(pad * previewCell / cellSize);
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
      options: {
        cellSize: clampInt(els.dlgCell.value, EXPORT_CELL_MIN, EXPORT_CELL_MAX, EXPORT_CELL_DEFAULT),
        gridLines: els.dlgGrid.checked,
        outerPad: clampInt(els.dlgPad.value, 0, EXPORT_PAD_MAX, 0),
        edgeNumbers: els.dlgEdgeNumbers.checked,
        showCodes: els.dlgCodes.checked,
        legend: els.dlgLegend.checked,
        format: fmt,
        quality: EXPORT_QUALITY,
        emptyStyle: els.dlgEmptyStyle.value,
      },
    });
    downloadDataUrl(res.dataUrl, `拼豆图案.${fmt === 'png' ? 'png' : 'jpg'}`);
    els.dlgStatus.textContent = '导出完成';
    await new Promise((r) => setTimeout(r, EXPORT_COMPLETE_DELAY_MS)); // 稍作停留显示完成状态
    els.exportDialog.classList.add('hidden');
  } catch (err) {
    toast('导出失败：' + err.message);
  } finally {
    els.dlgBusy.classList.add('hidden');
  }
}
