// 应用入口（组合根）：全量刷新 renderFull、滑块重算与启动流程。
// 事件绑定 / 快捷键 / 恢复 / 项目文件已拆分到 bind-events、shortcuts、restore、project-file。

import * as auth from './auth.js';
import { bindEvents } from './bind-events.js';
import * as canvas from './canvas.js';
import * as colorList from './color-list.js';
import * as C from './colors.js';
import * as compare from './compare.js';
import { APP_VERSION } from './constants.js';
import { refreshCropMagnifier } from './crop-magnifier.js';
import { assertElements, els } from './els.js';
import * as highlight from './highlight.js';
import * as historyUI from './history-ui.js';
import * as palette from './palette.js';
import * as panel from './panel.js';
import { updateProjectNameLabel } from './project-file.js';
import { renderFullNow, setRenderers } from './render-queue.js';
import { restoreState } from './restore.js';
import { applySlider } from './slider.js';
import { App } from './state.js';
import { installTestHooks } from './test-hooks.js';
import * as theme from './theme.js';
import * as toolState from './tool-state.js';
import { toast } from './utils.js';
import * as view from './view.js';

function renderFull() {
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
    colorList.renderColorList();
    if (App.settings.compare || App.settings.syncPan) {
      compare.setCompareEnabled(false, { silent: true });
    }
    return;
  }
  const counts = C.computeUsedCounts(project.grid, project.width, project.height);
  let used = 0;
  let filled = 0;
  for (const c of counts) {
    if (c) {
      used++;
      filled += c;
    }
  }
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
  canvas.rebuildCanvas();
  els.emptyHint.style.display = 'none';

  const empty = project.grid.length - filled;
  els.cellInfo.textContent = `${project.width} × ${project.height} · 非空 ${filled} · 空位 ${empty}`;
  colorList.renderColorList(counts);
  highlight.renderHighlightColorList(counts);
  canvas.syncHighlightBlink();
  els.btnSaveProject.disabled = false;
  toolState.updateModeControls();
  historyUI.updateUndoUI();
}

setRenderers(renderFull, canvas.renderCanvas);

// 缩放结束后统一联动：细节阈值重建、overlay 重绘、裁剪放大镜、对比镜像
view.setAfterZoomHook(() => {
  canvas.syncBaseLayerDetail();
  canvas.renderCanvas();
  refreshCropMagnifier();
  if (App.settings.syncPan && App.originalImage) {
    view.mirrorBeadToOrig();
    view.applyOriginalTransform();
  }
});

// ---------------- 启动 ----------------

async function init() {
  assertElements();
  els.appVersion.textContent = APP_VERSION;
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
  renderFullNow();
  historyUI.renderHistoryUI();
}

init();

// 自动化测试挂钩（稳定契约）：暴露面与安装逻辑见 test-hooks.js
installTestHooks({ renderFull, applySlider, restoreState });
