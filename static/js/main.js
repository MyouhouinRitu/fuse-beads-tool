// 应用入口（组合根）：全量刷新 renderAll、滑块重算与启动流程。
// 事件绑定 / 快捷键 / 恢复 / 项目文件已拆分到 bind-events、shortcuts、restore、project-file。

import * as api from './api.js';
import * as auth from './auth.js';
import { bindEvents } from './bind-events.js';
import * as canvas from './canvas.js';
import * as colorList from './color-list.js';
import * as C from './colors.js';
import * as compare from './compare.js';
import { refreshCropMagnifier } from './crop-magnifier.js';
import { assertElements, els } from './els.js';
import * as highlight from './highlight.js';
import * as historyUI from './history-ui.js';
import * as palette from './palette.js';
import * as panel from './panel.js';
import { setNativeDialogs, updateProjectNameLabel } from './project-file.js';
import { renderAllNow, setRenderers } from './render-queue.js';
import { restoreState } from './restore.js';
import { applySlider } from './slider.js';
import { App } from './state.js';
import { installTestHooks } from './test-hooks.js';
import * as theme from './theme.js';
import * as toolState from './tool-state.js';
import { toast } from './utils.js';
import * as view from './view.js';

function renderAll() {
  const project = App.project;
  if (!project) {
    updateProjectNameLabel();
    canvas.clearWorkspace();
    els.emptyHint.style.display = '';
    els.colorSlider.disabled = true;
    els.btnSaveProject.disabled = true;
    els.cellInfo.textContent = '';
    els.usedColors.textContent = '';
    els.sliderValue.textContent = '2';
    canvas.syncHighlightBlink();
    toolState.updateModeControls();
    historyUI.updateUndoUI();
    if (App.settings.compare || App.settings.syncPan) {
      compare.setCompareEnabled(false, { silent: true });
    }
    return;
  }
  const counts = C.computeUsedCounts(project.grid, project.width, project.height);
  const used = C.countUsedColors(project.grid, project.width, project.height);
  const baseUsed = App.baseGrid
    ? C.countUsedColors(App.baseGrid, project.width, project.height)
    : used;
  App.maxColors = App.sliderN ?? baseUsed;
  els.colorSlider.max = String(Math.max(2, baseUsed));
  els.colorSlider.value = String(App.maxColors);
  els.colorSlider.disabled = baseUsed <= 1;
  els.sliderValue.textContent = String(App.maxColors);
  els.usedColors.textContent = `当前使用 ${used} 种颜色`;
  updateProjectNameLabel();
  canvas.redrawCanvas();
  els.emptyHint.style.display = 'none';

  let empty = 0;
  for (let p = 0; p < project.grid.length; p++) if (project.grid[p] < 0) empty++;
  els.cellInfo.textContent = `${project.width} × ${project.height} · 总量 ${project.grid.length - empty} · 空位 ${empty}`;
  colorList.renderColorList(counts);
  highlight.renderHighlightColorList(counts);
  canvas.syncHighlightBlink();
  els.btnSaveProject.disabled = false;
  toolState.updateModeControls();
  historyUI.updateUndoUI();
}

setRenderers(renderAll, canvas.composeCanvas);

// 缩放结束后统一联动：细节阈值重建、overlay 重绘、裁剪放大镜、对比镜像
view.setAfterZoomHook(() => {
  canvas.syncBaseLayerDetail();
  canvas.composeCanvas();
  refreshCropMagnifier();
  if (App.settings.syncPan && App.originalImage) {
    view.mirrorBeadToOrig();
    view.applyOriginalTransform();
  }
});

// ---------------- 启动 ----------------

async function init() {
  assertElements();
  try {
    const info = await api.getAppInfo();
    setNativeDialogs(!!info.nativeDialogs);
  } catch (_e) {
    /* 保持默认 false */
  }
  panel.applyPanelPrefs();
  theme.applyTheme(theme.currentTheme());
  bindEvents();
  await auth.ensureAuth();
  try {
    await palette.loadConfigs();
  } catch (e) {
    console.error('配置加载失败：', e);
    toast(`配置加载失败：${e.message}`);
  }
  try {
    await restoreState();
  } catch (e) {
    console.error('状态恢复失败：', e);
    toast(`状态恢复失败：${e.message}`);
  }
  renderAllNow();
  historyUI.renderHistoryUI();
}

init();

// 自动化测试挂钩（稳定契约）：暴露面与安装逻辑见 test-hooks.js
installTestHooks({ renderAll, applySlider, restoreState });
