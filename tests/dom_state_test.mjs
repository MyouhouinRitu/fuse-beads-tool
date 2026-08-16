// DOM 行为测试（dom_state_test.mjs 分组）：依赖 tests/helpers/dom-harness.mjs 的共享桩。

import assert from 'node:assert/strict';
import { decodeInt16Grid } from '../static/js/grid-codec.js';
import {
  App,
  canvasRectForCells,
  colorInputs,
  configs,
  createdConfigs,
  drawLog,
  elsMap,
  fillStyles,
  hooks,
  interactionState,
  mouseAt,
  palette3,
  seedProject,
  testState,
  windowListeners,
} from './helpers/dom-harness.mjs';

// ---------------- 1. 色板配置修改：不即时更新图片与画笔，重新压缩后才应用 ----------------
{
  seedProject();
  App.brushColor = 0;
  hooks.renderAll();
  assert.ok(fillStyles().has('#ffffff'), '初始绘制应包含白色像素');
  const fillsBefore = drawLog.fills.length;
  const brushBefore = elsMap['brush-label'].textContent;

  const input = colorInputs().find((e) => e.value === '#FFFFFF' || e.value === '#ffffff');
  assert.ok(input, '色板表应包含颜色输入控件');
  input.value = '#12AB34';
  input.emit('input', { target: input });

  assert.equal(App.palette[0].hex, '#12AB34', '修改后色板配置本身应立即更新');
  assert.equal(drawLog.fills.length, fillsBefore, '修改色板后不应重绘画布');
  assert.ok(!fillStyles().has('#12ab34'), '修改色板后画布不应出现新颜色');
  assert.equal(
    elsMap['brush-label'].textContent,
    brushBefore,
    `修改色板后画笔颜色不应改变，实际 ${elsMap['brush-label'].textContent}`,
  );

  // 画布/编辑工具使用“已应用色板”：手动更新 appliedPalette 后重绘才生效
  App.appliedPalette[0].hex = '#00FF00';
  hooks.renderAll();
  assert.ok(fillStyles().has('#00ff00'), '画布应使用已应用色板渲染');
  assert.ok(!fillStyles().has('#12ab34'), '画布不应渲染待应用的色板配置');
  assert.ok(elsMap['brush-label'].textContent.includes('#00FF00'), '画笔应使用已应用色板');
  console.log('[OK] 色板配置修改不即时生效：画布/画笔保持已应用色板');
}

// ---------------- 2. 扁平事务：保存 / 只删当前节点 ----------------
{
  seedProject();
  hooks.saveTransaction();
  hooks.saveTransaction();
  assert.equal(App.history.items.length, 2, 'Ctrl+S 保存两次应有 2 个独立事务');
  assert.equal(App.history.items[1].id, App.history.items[0].id + 1);
  assert.equal(App.history.currentId, App.history.items[1].id);
  assert.ok(
    !('children' in App.history.items[0]) && !('parentId' in App.history.items[0]),
    '事务节点无父子关系',
  );

  // 删除非当前事务：仅删除该节点，当前节点不变
  const firstId = App.history.items[0].id;
  await hooks.deleteHistoryItem(firstId);
  assert.equal(App.history.items.length, 1, '删除应只移除一个事务节点');
  assert.equal(App.history.items[0].id, App.history.currentId, '删除非当前节点后当前节点不变');

  // 删除当前事务：切到相邻节点
  await hooks.deleteHistoryItem(App.history.currentId);
  assert.equal(App.history.items.length, 0, '删除当前节点后历史清空');
  assert.equal(App.history.currentId, null);
  assert.equal(elsMap['history-list'].children.length, 0, '历史面板应显示空状态');
  console.log('[OK] 扁平事务：保存、只删单个节点、切换当前节点');
}

// ---------------- 2.5 事务基线标记：选中/编辑/新建的红色圆点 ----------------
{
  seedProject();
  App.brushColor = 1;
  hooks.saveTransaction();
  const firstId = App.history.items[0].id;
  let itemEl = elsMap['history-list'].children[0];
  assert.equal(App.history.currentId, firstId, '新建事务后应选中该事务');
  assert.equal(App.history.baselineId, firstId, '新建事务后应作为基线事务');
  assert.ok(itemEl.classList.contains('current'), '新建事务应保持选中态');
  assert.ok(itemEl.querySelector('.hi-baseline-dot'), '新建事务应显示红色基线圆点');

  // 修改后：取消选中，但圆点保留
  hooks.paintCell(0, 0);
  hooks.renderHistoryUI();
  itemEl = elsMap['history-list'].children[0];
  assert.equal(App.history.currentId, null, '修改后应取消选中当前事务');
  assert.equal(App.history.baselineId, firstId, '修改后基线事务应保持不变');
  assert.ok(!itemEl.classList.contains('current'), '修改后事务不应再有选中态');
  assert.ok(itemEl.querySelector('.hi-baseline-dot'), '修改后红色圆点应保留');

  // 再新建事务：新事务选中并带圆点，旧事务圆点消失
  hooks.saveTransaction();
  const secondId = App.history.items[1].id;
  assert.equal(App.history.currentId, secondId, '新建第二个事务后应选中新事务');
  assert.equal(App.history.baselineId, secondId, '新建第二个事务后基线应指向新事务');
  assert.ok(elsMap['history-list'].children[1].classList.contains('current'), '新事务应保持选中态');
  assert.ok(
    elsMap['history-list'].children[1].querySelector('.hi-baseline-dot'),
    '新事务应显示红色圆点',
  );
  assert.ok(
    !elsMap['history-list'].children[0].querySelector('.hi-baseline-dot'),
    '旧事务圆点应消失',
  );
  console.log('[OK] 事务基线标记：选中 / 编辑取消选中 / 新建事务圆点迁移');
}

// ---------------- 3. 单步撤销 / 重做（画笔整段一笔） ----------------
{
  seedProject();
  App.tool = 'brush';
  App.brushColor = 2; // 蓝色
  App.selection.clear();
  hooks.renderAll();
  canvasRectForCells();
  const grid = App.project.grid;
  assert.equal(grid[0], 0);
  assert.equal(grid[1], 1);

  const md = elsMap['canvas-scroll'].listeners.pointerdown[0];
  const mm = windowListeners.pointermove[0];
  const mu = windowListeners.pointerup[0];
  md(mouseAt(0, 0));
  mm({ ...mouseAt(1, 0) });
  mu({});

  assert.equal(grid[0], 2, '按下起点应涂成蓝色');
  assert.equal(grid[1], 2, '拖过格子应涂成蓝色');
  assert.equal(App.undoStack.length, 1, '一次按下到放开应只记一步');
  assert.equal(App.undoStack[0].changes.length, 2, '这一步应包含 2 个像素的增量修改');

  hooks.doUndo();
  assert.equal(grid[0], 0, '撤销后起点应恢复原色');
  assert.equal(grid[1], 1, '撤销后终点应恢复原色');
  assert.equal(App.redoStack.length, 1);

  hooks.doRedo();
  assert.equal(grid[0], 2, '重做后起点重新涂色');
  assert.equal(grid[1], 2, '重做后终点重新涂色');
  assert.equal(App.undoStack.length, 1);
  console.log('[OK] 单步撤销/重做：画笔整段一笔、增量还原');
}

// ---------------- 4. D 键九宫格选色记为一步 ----------------
{
  seedProject();
  App.tool = 'select';
  App.selection = new Set([0]); // 选中 (0,0)
  App.brushColor = 0;
  hooks.renderAll();
  const grid = App.project.grid;
  assert.equal(grid[0], 0);

  // D 键打开九宫格
  const kd = windowListeners.keydown[0];
  kd({ key: 'd', ctrlKey: false, metaKey: false, target: null, preventDefault() {} });
  assert.ok(!elsMap['quick-picker'].classList.contains('hidden'), 'D 键应打开九宫格');
  const btns = elsMap['quick-picker'].children.filter(
    (c) => c.tagName === 'BUTTON' && !c.className.includes('qp-cancel'),
  );
  assert.ok(btns.length > 0, '九宫格应有候选按钮');

  // 悬停候选 → 实时预览（不进撤销栈）
  const target = interactionState.pickerCandidates[0].i;
  const fillsBeforeHover = drawLog.fills.length;
  btns[0].emit('mouseover');
  assert.equal(grid[0], target, '悬停候选应立即预览颜色');
  assert.equal(App.undoStack.length, 0, '预览不应进入撤销栈');
  // 预览必须真的渲染到画布：目标格 (0,0) 应出现候选色填充（工作区含 1 格行列号偏移，起点 28px）
  const candidateHex = App.appliedPalette[target].hex.toLowerCase();
  assert.ok(
    drawLog.fills
      .slice(fillsBeforeHover)
      .some(
        (f) =>
          Math.round(f.x) === 28 &&
          Math.round(f.y) === 28 &&
          Math.round(f.w) === 28 &&
          Math.round(f.h) === 28 &&
          String(f.style).toLowerCase() === candidateHex,
      ),
    '悬停候选应在画布上渲染候选色',
  );

  // 移出弹窗 → 还原原始颜色
  elsMap['quick-picker'].emit('mouseleave');
  assert.equal(grid[0], 0, '移出弹窗应还原原始颜色');

  // 再次悬停并点击 → 提交改色，记一步撤销
  btns[0].emit('mouseover');
  App.dirty = false;
  App.projectDirty = false;
  App.editedSinceSlider = false;
  App.saveTimer = null;
  btns[0].emit('click');
  assert.equal(grid[0], target, '点击候选应提交改色');
  assert.equal(App.undoStack.length, 1, '提交应记一步撤销');
  assert.equal(App.dirty, true, 'D 键改色应标记未保存修改');
  assert.equal(App.projectDirty, true, 'D 键改色应标记项目文档未保存');
  assert.equal(App.editedSinceSlider, true, 'D 键改色应标记滑块后编辑');
  assert.ok(App.saveTimer != null, 'D 键改色应调度自动保存');
  hooks.doUndo();
  assert.equal(grid[0], 0, '撤销后应恢复原色');
  console.log('[OK] D 键九宫格：悬停预览 + 点击确认记一步');
}

// ---------------- 4.5 快捷键：Ctrl+Shift+Z 作为重做 ----------------
{
  seedProject();
  App.tool = 'brush';
  App.brushColor = 1;
  interactionState.strokeBuffer = [];
  hooks.paintCell(0, 0);
  App.undoStack.push({ changes: interactionState.strokeBuffer });
  interactionState.strokeBuffer = null;
  assert.equal(App.undoStack.length, 1, '前置：应存在一步撤销记录');
  assert.equal(App.project.grid[0], 1, '前置：应先涂色');
  hooks.doUndo();
  assert.equal(App.project.grid[0], 0, '前置：应先撤销涂色');
  assert.equal(App.redoStack.length, 1, '前置：撤销后应有重做记录');
  const kd = windowListeners.keydown[0];
  kd({
    key: 'z',
    ctrlKey: true,
    shiftKey: true,
    metaKey: false,
    target: null,
    preventDefault() {},
  });
  assert.equal(App.project.grid[0], 1, 'Ctrl+Shift+Z 应触发重做');
  assert.equal(App.redoStack.length, 0, '重做后重做栈应清空');
  console.log('[OK] 快捷键：Ctrl+Shift+Z 重做');
}

// ---------------- 5. 滑块调整：存在事务/记录时警告并清空 ----------------
{
  seedProject();
  hooks.saveTransaction();
  interactionState.strokeBuffer = [];
  App.tool = 'brush';
  App.brushColor = 1;
  hooks.paintCell(0, 0);
  App.undoStack.push({ changes: interactionState.strokeBuffer });
  interactionState.strokeBuffer = null;
  assert.ok(App.history.items.length > 0 && App.undoStack.length > 0, '前置：存在事务与撤销记录');

  testState.confirmResult = false;
  await hooks.applySlider(1);
  assert.equal(App.history.items.length, 1, '取消确认后不应清空事务');
  assert.equal(App.undoStack.length, 1, '取消确认后不应清空撤销记录');

  testState.confirmResult = true;
  await hooks.applySlider(1);
  assert.equal(App.history.items.length, 0, '确认后应清空全部事务');
  assert.equal(App.undoStack.length, 0, '确认后应清空撤销记录');
  assert.equal(App.redoStack.length, 0, '确认后应清空重做记录');
  console.log('[OK] 滑块调整：有事务/记录时警告并清空');
}

// ---------------- 6. 恢复状态时以磁盘配置色板为准 ----------------
{
  seedProject();
  testState.stateResponse = {
    settings: { targetPixels: 40000 },
    project: {
      width: 2,
      height: 2,
      grid: [0, 1, 0, 1],
      baseGrid: [0, 1, 0, 1],
      sliderN: 2,
      editedSinceSlider: false,
      paletteName: 'cfg',
      palette: [{ index: 1, code: 'OLD', name: '旧', hex: '#000000' }],
      maxColors: 2,
    },
    history: { items: [], currentId: null, nextId: 1 },
  };
  App.configs = configs;
  await hooks.restoreState();
  assert.ok(App.configName.startsWith('cfg (恢复 '), '快照与磁盘配置不一致时应创建恢复配置');
  assert.equal(App.palette[0].hex, '#000000', '恢复后可编辑色板应以快照色板为准');
  assert.equal(App.palette.length, 1);
  assert.equal(App.appliedPalette[0].hex, '#000000', '恢复后画布应使用状态里保存的已应用色板');
  console.log('[OK] 恢复状态：快照与磁盘配置不一致时创建恢复配置');
}

// ---------------- 6.5 恢复运行态：视口 / 工具 / 画笔色 / 选区 / dirty / 撤销栈 / 原图引用 ----------------
{
  seedProject();
  const fakeSha = 'a'.repeat(64);
  testState.stateResponse = {
    settings: { targetPixels: 40000, useLab: true },
    viewport: { zoom: 1.25, pan: { x: 12, y: 34 }, origZoom: 2, origPan: { x: 5, y: 6 } },
    editor: {
      tool: 'wand',
      brushColor: 2,
      dirty: true,
      selection: [0, 3],
    },
    project: {
      width: 2,
      height: 2,
      grid: [0, 1, 0, 1],
      baseGrid: [0, 1, 0, 1],
      sliderN: 2,
      editedSinceSlider: false,
      paletteName: 'cfg',
      palette: palette3.map((c) => ({ ...c })),
      maxColors: 2,
    },
    undo: {
      undoStack: [{ changes: [{ x: 0, y: 0, from: 0, to: 1 }] }],
      redoStack: [],
    },
    history: { items: [], currentId: null, nextId: 1 },
    original: { id: fakeSha, name: 't.png', sha256: fakeSha, size: 123 },
  };
  App.configs = configs;
  await hooks.restoreState();
  assert.equal(App.zoom, 1.25, '恢复后应还原缩放');
  assert.deepEqual(App.pan, { x: 12, y: 34 }, '恢复后应还原平移');
  assert.equal(App.tool, 'wand', '恢复后应还原魔棒工具');
  assert.equal(App.brushColor, 2, '恢复后应还原画笔颜色');
  assert.deepEqual(
    [...App.selection].sort((a, b) => a - b),
    [0, 3],
    '恢复后应还原选区',
  );
  assert.equal(App.dirty, true, '恢复后应保留未保存修改标记');
  assert.equal(App.undoStack.length, 1, '恢复后应还原单步撤销栈');
  assert.equal(App.originalId, fakeSha, '恢复后应还原后端原图引用');
  console.log('[OK] 恢复运行态：视口 / 工具 / 画笔色 / 选区 / dirty / 撤销栈 / 原图引用');
}

// ---------------- 6.6 色板恢复：配置不一致时自动创建恢复配置 ----------------
{
  seedProject();
  const snapshotPalette = [
    { index: 1, code: 'R1', name: '恢复红', hex: '#123456' },
    { index: 2, code: 'B1', name: '恢复蓝', hex: '#654321' },
  ];
  testState.stateResponse = {
    settings: { targetPixels: 40000 },
    project: {
      width: 2,
      height: 2,
      grid: [0, 1, 0, 1],
      baseGrid: [0, 1, 0, 1],
      sliderN: 2,
      editedSinceSlider: false,
      paletteName: 'cfg',
      palette: snapshotPalette.map((c) => ({ ...c })),
      maxColors: 2,
    },
    history: { items: [], currentId: null, nextId: 1 },
  };
  App.configs = configs.map((c) => ({ ...c }));
  await hooks.restoreState();
  assert.ok(
    App.configName.startsWith('cfg (恢复 '),
    `应自动创建带后缀的恢复配置，实际 ${App.configName}`,
  );
  assert.equal(App.palette[0].hex, '#123456', '可编辑色板应使用恢复配置');
  assert.ok(createdConfigs[App.configName], '后端应已创建恢复配置');
  assert.equal(createdConfigs[App.configName].length, 2, '恢复配置应包含快照色板');
  const toastQueuedOrVisible =
    hooks.getToastQueue().some((m) => m.includes('已自动创建恢复色板')) ||
    elsMap.toast.textContent.includes('已自动创建恢复色板');
  assert.ok(
    toastQueuedOrVisible,
    `自动创建恢复配置后应排队弹出提示，队列 ${JSON.stringify(hooks.getToastQueue())}，当前 ${elsMap.toast.textContent}`,
  );
  await new Promise((r) => setTimeout(r, 950));
  assert.equal(
    testState.stateResponse.project.paletteName,
    App.configName,
    '自动保存应持久化新的 paletteName',
  );
  console.log('[OK] 色板恢复：配置不一致时自动创建恢复配置');
}

// ---------------- 6.7 自动保存载荷：包含 schema / 视口 / 编辑状态 / 撤销栈 / 原图引用 ----------------
{
  const { STATE_SCHEMA_VERSION } = await import('../static/js/autosave.js');
  seedProject();
  App.tool = 'wand';
  App.brushColor = 2;
  App.dirty = true;
  App.selection = new Set([0, 3]);
  App.undoStack = [{ changes: [{ x: 0, y: 0, from: 0, to: 1 }] }];
  App.redoStack = [];
  App.pan = { x: 12, y: 34 };
  App.zoom = 1.25;
  App.originalId = 'a'.repeat(64);
  App.originalName = 't.png';
  App.originalSha256 = 'a'.repeat(64);
  App.originalSize = 123;
  hooks.paintCell(0, 0);
  await new Promise((r) => setTimeout(r, 950));
  assert.equal(
    testState.stateResponse.schemaVersion,
    STATE_SCHEMA_VERSION,
    '自动保存应带 schemaVersion',
  );
  assert.equal(
    typeof testState.stateResponse.project.gridBase64,
    'string',
    '自动保存网格应使用 base64 紧凑编码',
  );
  assert.deepEqual(
    Array.from(decodeInt16Grid(testState.stateResponse.project.gridBase64)),
    Array.from(App.project.grid),
    'base64 网格应能还原为当前画布',
  );
  assert.equal(testState.stateResponse.viewport.zoom, 1.25, '自动保存应记录缩放');
  assert.deepEqual(testState.stateResponse.viewport.pan, { x: 12, y: 34 }, '自动保存应记录平移');
  assert.equal(testState.stateResponse.editor.tool, 'wand', '自动保存应记录当前工具');
  assert.equal(testState.stateResponse.editor.brushColor, 2, '自动保存应记录画笔颜色');
  assert.equal(testState.stateResponse.editor.dirty, true, '自动保存应记录未保存修改标记');
  assert.deepEqual(testState.stateResponse.editor.selection, [0, 3], '自动保存应记录选区');
  assert.equal(testState.stateResponse.undo.undoStack.length, 1, '自动保存应记录撤销栈');
  assert.equal(testState.stateResponse.original.id, 'a'.repeat(64), '自动保存应记录后端原图引用');
  assert.equal(testState.stateResponse.projectDirty, true, '自动保存应记录 projectDirty');
  console.log('[OK] 自动保存载荷：schema / 视口 / 编辑状态 / 撤销栈 / 原图引用');
}

// ---------------- 6.7 历史编码缓存：引用未变时复用，元数据变化时重新编码 ----------------
{
  seedProject();
  const { buildStatePayload } = await import('../static/js/autosave.js');
  const { createTransaction } = await import('../static/js/history.js');
  createTransaction(App.history, {
    grid: Array.from(App.project.grid),
    width: App.project.width,
    height: App.project.height,
    paletteName: 'cfg',
    palette: App.appliedPalette.map((c) => ({ ...c })),
    paletteHash: '0'.repeat(64),
    maxColors: App.maxColors,
  });
  const encoded1 = buildStatePayload().history.items[0].snapshot.gridBase64;
  const encoded2 = buildStatePayload().history.items[0].snapshot.gridBase64;
  assert.equal(encoded2, encoded1, '历史未变化时重复构建应复用编码缓存');
  App.history.items[0].snapshot.paletteName = 'other';
  const encoded3 = buildStatePayload().history.items[0];
  assert.equal(encoded3.snapshot.paletteName, 'other', '快照元数据变化后应重新编码');
  console.log('[OK] 历史编码缓存：复用 / 失效');
}

// ---------------- 6.8 项目文档载荷：只包含文档数据，不包含运行态 ----------------
{
  seedProject();
  App.tool = 'brush';
  App.brushColor = 2;
  App.selection = new Set([0, 3]);
  App.undoStack = [{ changes: [{ x: 0, y: 0, from: 0, to: 1 }] }];
  App.zoom = 1.5;
  App.pan = { x: 20, y: 30 };
  App.history = {
    items: [
      {
        id: 1,
        createdAt: 1,
        label: '快照 #1',
        snapshot: { width: 2, height: 2, grid: [0, 1, 0, 1] },
      },
    ],
    currentId: 1,
    nextId: 2,
    baselineId: 1,
  };
  const doc = hooks.buildProjectDocument();
  assert.equal(doc.project.width, 2, '项目文档应包含画布尺寸');
  assert.equal(doc.settings.wandSensitivity, 20, '项目文档应包含魔棒容差设置');
  assert.equal(doc.history.baselineId, 1, '项目文档应包含事务基线标记');
  assert.equal(doc.viewport.zoom, 1.5, '项目文档应包含视口缩放');
  assert.deepEqual(doc.viewport.pan, { x: 20, y: 30 }, '项目文档应包含视口平移');
  assert.ok(
    !('tool' in doc) && !('undo' in doc) && !('dirty' in doc),
    '项目文档不应包含工具/撤销栈/dirty 等运行态',
  );
  console.log('[OK] 项目文档载荷：文档数据 + 视口保留、其它运行态排除');
}

// ---------------- 7. 导出预览与「有未保存的修改」提示 ----------------
{
  seedProject();
  hooks.renderAll();
  elsMap['dirty-indicator'].classList.add('hidden'); // 桩不解析 HTML 初始 class，手动补上
  assert.ok(elsMap['dirty-indicator'].classList.contains('hidden'), '初始应无未保存提示');
  App.tool = 'brush';
  App.brushColor = 1;
  hooks.paintCell(0, 0);
  assert.ok(!elsMap['dirty-indicator'].classList.contains('hidden'), '编辑后应显示未保存提示');
  hooks.saveTransaction();
  assert.ok(elsMap['dirty-indicator'].classList.contains('hidden'), '保存事务后应隐藏未保存提示');

  elsMap['dlg-legend'].checked = true; // 桩默认未勾选，手动开启图例
  hooks.openExportDialog();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(
    elsMap['dlg-preview'].width > 0 && elsMap['dlg-preview'].height > 0,
    '导出对话框应显示实时预览',
  );
  assert.ok(
    drawLog.texts.some((t) => /^\S+ × \d+$/.test(t.text)),
    `图例文字应为「色号 × 数量」格式，实际 ${JSON.stringify(drawLog.texts.map((t) => t.text))}`,
  );
  elsMap['export-dialog'].classList.add('hidden'); // 关闭弹窗，避免影响后续 Escape 测试
  console.log('[OK] 导出预览与「有未保存的修改」提示');
}

// ---------------- 画笔未选色：默认取调色板最暗色并进入画笔模式 ----------------
{
  seedProject();
  App.tool = 'select';
  App.brushColor = null;
  elsMap['tool-brush'].emit('click');
  assert.equal(App.brushColor, 2, '未选色按画笔应默认选调色板最暗色（蓝 #0000FF）');
  assert.equal(App.tool, 'brush', '未选色按画笔也应进入画笔模式');
  assert.ok(elsMap['brush-label'].textContent.includes('#0000FF'), '画笔标签应显示默认深色');
  console.log('[OK] 画笔未选色：默认取调色板最暗色并进入画笔模式');
}

// ---------------- 8. 侧边栏折叠 / 展开 ----------------
{
  seedProject();
  clearTimeout(App.saveTimer);
  App.saveTimer = null;
  const panBefore = App.pan.x;
  for (const id of ['left-panel', 'color-highlight-panel', 'right-panel']) {
    const panel = elsMap[id];
    assert.ok(panel && !panel.classList.contains('collapsed'), `${id} 初始应处于展开状态`);
    // 左侧栏通过小按钮收起；颜色清单 / 事务历史通过点击标题栏收起
    const trigger = elsMap[`${id}-toggle`] || elsMap[`${id}-head`];
    const expand = elsMap[`${id}-expand`];
    assert.ok(trigger && expand, `${id} 应包含可点击的收起触发与展开按钮`);

    trigger.emit('click');
    assert.ok(panel.classList.contains('collapsed'), `${id} 点击折叠按钮后应收起`);
    if (id === 'left-panel') {
      assert.equal(App.pan.x, panBefore + 288, '折叠左侧栏后应补偿画布位移，保持画面绝对位置');
      assert.ok(App.saveTimer != null, '折叠左侧栏（视图变化）应调度自动保存');
    } else {
      assert.equal(App.pan.x, panBefore, '折叠右侧栏不应改变画布位置');
    }

    expand.emit('click');
    assert.ok(!panel.classList.contains('collapsed'), `${id} 点击展开按钮后应恢复展开`);
    assert.equal(App.pan.x, panBefore, `${id} 展开后画布位置应复原`);
  }
  console.log('[OK] 侧边栏折叠 / 展开');
}

// ---------------- 9. 对比原图 / 同步拖拽守卫 ----------------
{
  seedProject();
  App.originalImage = null;
  elsMap['chk-compare'].checked = true;
  elsMap['chk-compare'].emit('change');
  assert.equal(App.settings.compare, false, '无原图时不应开启对比');
  assert.equal(elsMap['chk-compare'].checked, false, '无原图时勾选对比应被回退');

  elsMap['chk-sync-pan'].checked = true;
  elsMap['chk-sync-pan'].emit('change');
  assert.equal(App.settings.compare, false, '无原图时同步拖拽不应自动开启对比');
  assert.equal(App.settings.syncPan, false, '无原图时同步拖拽不应生效');
  assert.equal(elsMap['chk-sync-pan'].checked, false, '无原图时勾选同步应被回退');
  console.log('[OK] 对比原图 / 同步拖拽守卫');
}

// ---------------- 10. 同步换算：格放大 × 降采样系数，取消对比联动取消同步 ----------------
{
  seedProject();
  App.screenCell = 28;
  // 拼豆网格 48 格，原图显示宽 96px：整张网格 ↔ 整张原图，1 格对应 2 个显示像素
  App.project.width = 48;
  App.project.height = 48;
  elsMap['canvas-original'].width = 96;
  elsMap['canvas-original'].height = 96;
  App.pan = { x: 100, y: 50 };
  App.zoom = 1;

  hooks.mirrorBeadToOrig();
  assert.equal(App.origZoom, 14, '原图 zoom 应为 拼豆 zoom × 28 × (网格宽48/原图显示宽96)');
  assert.equal(App.origPan.x, 128, '原图 pan.x 应包含 1 格行列号条偏移（100 + 1×28×1）');
  assert.equal(App.origPan.y, 78, '原图 pan.y 应包含 1 格行列号条偏移（50 + 1×28×1）');

  App.origPan = { x: 128, y: 78 };
  App.origZoom = 14;
  hooks.mirrorOrigToBead();
  assert.equal(App.zoom, 1, '反向换算应还原拼豆 zoom');
  assert.equal(App.pan.x, 100, '反向换算应还原拼豆 pan.x');
  assert.equal(App.pan.y, 50, '反向换算应还原拼豆 pan.y');

  // 取消对比原图 → 同步拖拽应一并取消
  App.originalImage = { naturalWidth: 48, naturalHeight: 48 };
  App.settings.compare = true;
  App.settings.syncPan = true;
  elsMap['chk-compare'].checked = true;
  elsMap['chk-sync-pan'].checked = true;
  elsMap['chk-compare'].checked = false;
  elsMap['chk-compare'].emit('change');
  assert.equal(App.settings.syncPan, false, '取消对比后同步拖拽应一并取消');
  assert.equal(elsMap['chk-sync-pan'].checked, false, '取消对比后同步勾选框应被取消');
  assert.equal(App.settings.compare, false, '取消对比后对比状态应关闭');
  console.log('[OK] 同步换算含网格/原图比例 / 取消对比联动取消同步');
}

// ---------------- 21. schemaVersion 校验：高于当前版本时拒绝恢复 / 打开 ----------------
{
  seedProject();
  const before = App.project;
  testState.stateResponse = { schemaVersion: 999, project: { width: 9, height: 9 } };
  await hooks.restoreState();
  assert.equal(App.project, before, '更高版本的状态文件不应覆盖当前画布');
  assert.ok(elsMap.toast.textContent.includes('已跳过恢复'), '更高版本的状态文件应提示跳过恢复');

  const { applyProjectDocument } = await import('../static/js/restore.js');
  const beforeDoc = App.project;
  await applyProjectDocument({ schemaVersion: 999, project: { width: 7, height: 7 } });
  assert.equal(App.project, beforeDoc, '更高版本的项目文件不应打开');
  assert.ok(elsMap.toast.textContent.includes('无法打开'), '更高版本的项目文件应提示无法打开');
  console.log('[OK] schemaVersion 校验：拒绝更高版本的状态与项目文件');
}

// ---------------- 22. PDF 预览异步流程：分页按钮 + 页面绘制 + 失败提示 ----------------
{
  seedProject();
  testState.pdfPreviewResponse = {
    pages: [
      {
        page: '总',
        paper: 'A4',
        landscape: false,
        width: 100,
        height: 80,
        dataUrl: 'data:image/png;base64,ZmFrZQ==',
      },
      {
        page: '1',
        paper: 'A4',
        landscape: false,
        width: 100,
        height: 80,
        dataUrl: 'data:image/png;base64,ZmFrZQ==',
      },
    ],
  };
  hooks.openExportDialog();
  elsMap['dlg-format'].value = 'pdf-multi-a4';
  const exportDialog = await import('../static/js/export-dialog.js');
  await exportDialog.renderExportPreview();
  await new Promise((r) => setTimeout(r, 180));
  assert.equal(elsMap['dlg-pdf-pages'].children.length, 2, 'PDF 预览应渲染分页按钮');
  assert.equal(elsMap['dlg-pdf-pages'].children[0].textContent, '总');
  assert.equal(elsMap['dlg-pdf-pages'].children[1].textContent, '1');
  assert.ok(elsMap['dlg-preview'].width > 0, 'PDF 预览页应绘制到预览画布');

  testState.pdfPreviewFail = true;
  elsMap['dlg-format'].value = 'pdf-a4';
  await exportDialog.renderExportPreview();
  await new Promise((r) => setTimeout(r, 180));
  assert.ok(elsMap.toast.textContent.includes('PDF 预览生成失败'), 'PDF 预览失败应弹出错误提示');
  testState.pdfPreviewFail = false;
  exportDialog.closeExportDialog();
  console.log('[OK] PDF 预览异步流程：分页按钮 / 页面绘制 / 失败提示');
}

// ---------------- 22b. PDF 预览竞态：慢的旧响应不覆盖最新预览 ----------------
{
  seedProject();
  const exportDialog = await import('../static/js/export-dialog.js');
  const pageA = {
    page: 'A',
    paper: 'A4',
    landscape: false,
    width: 100,
    height: 80,
    dataUrl: 'data:image/png;base64,ZmFrZQ==',
  };
  const pageB = { ...pageA, page: 'B' };
  const pageC = { ...pageA, page: 'C' };
  testState.pdfPreviewQueue = [
    { delay: 250, resp: { pages: [pageA] } }, // 慢的旧响应：1 页
    { delay: 30, resp: { pages: [pageB, pageC] } }, // 快的新响应：2 页
  ];
  hooks.openExportDialog(); // 默认 jpg 预览，不触发 PDF 请求
  elsMap['dlg-format'].value = 'pdf-multi-a4';
  await exportDialog.renderExportPreview(); // 请求 1（慢）在 120ms 后发出
  await new Promise((r) => setTimeout(r, 140));
  await exportDialog.renderExportPreview(); // 请求 2（快）在 120ms 后发出
  await new Promise((r) => setTimeout(r, 350)); // 等两个响应都返回
  assert.equal(elsMap['dlg-pdf-pages'].children.length, 2, '应显示最新预览的分页（2 页）');
  assert.equal(elsMap['dlg-pdf-pages'].children[0].textContent, 'B');
  assert.equal(elsMap['dlg-pdf-pages'].children[1].textContent, 'C');
  exportDialog.closeExportDialog();
  testState.pdfPreviewQueue = [];
  console.log('[OK] PDF 预览竞态：慢的旧响应被丢弃，最新响应生效');
}

// ---------------- 23. 恢复损坏 history / 撤销栈：过滤非法项、画布不受影响 ----------------
{
  seedProject();
  testState.stateResponse = {
    settings: {},
    project: {
      width: 2,
      height: 2,
      grid: [0, 1, 0, 1],
      baseGrid: [0, 1, 0, 1],
      sliderN: 2,
      editedSinceSlider: false,
      paletteName: 'cfg',
      palette: palette3.map((c) => ({ ...c })),
      maxColors: 2,
    },
    undo: {
      undoStack: [
        null,
        { changes: [{ x: 0, y: 0, from: 0, to: 1 }] },
        { changes: [{ x: 0, y: 0, from: 1, to: 'bad' }] },
      ],
      redoStack: ['junk'],
    },
    history: {
      items: [
        { id: 1, createdAt: 1, snapshot: { width: 2, height: 2, grid: [0, 1, 0, 1] } },
        { id: 'x', snapshot: { width: 2, height: 2, grid: [0, 1, 0, 1] } },
        { id: 2, createdAt: 2, snapshot: { width: 2, height: 2, gridBase64: '%%%bad%%%' } },
        { id: 3, createdAt: 3, snapshot: { width: 2, height: 2, grid: [0, 1] } },
      ],
      currentId: 1,
      baselineId: 1,
      nextId: 10,
    },
    original: null,
  };
  App.configs = configs;
  await hooks.restoreState();
  assert.equal(App.project.width, 2, '损坏历史不应影响画布恢复');
  assert.equal(App.history.items.length, 1, '恢复后只保留合法快照');
  assert.equal(App.history.items[0].id, 1);
  assert.equal(App.undoStack.length, 1, '撤销栈应过滤非法项');
  assert.equal(App.redoStack.length, 0, '重做栈应过滤非法项');
  console.log('[OK] 恢复损坏 history / 撤销栈：过滤非法项、画布不受影响');
}

// ---------------- 23b. 恢复损坏项目载荷：尺寸 / 网格校验 + 越界变更忽略 ----------------
{
  seedProject();
  const before = App.project;
  testState.stateResponse = {
    settings: {},
    project: { width: 2, height: 2, grid: [0, 1] },
    undo: { undoStack: [], redoStack: [] },
    history: { items: [], currentId: null, nextId: 1 },
    original: null,
  };
  await hooks.restoreState();
  assert.equal(App.project, before, '网格长度与尺寸不符时不应恢复项目');
  assert.ok(elsMap.toast.textContent.includes('状态恢复失败'), '损坏项目应提示恢复失败');

  testState.stateResponse = {
    settings: {},
    project: { width: 2, height: 2, grid: [0, -2, 0, 1] },
    undo: { undoStack: [], redoStack: [] },
    history: { items: [], currentId: null, nextId: 1 },
    original: null,
  };
  await hooks.restoreState();
  assert.equal(App.project, before, '非法网格值不应恢复');

  const { applyProjectDocument } = await import('../static/js/restore.js');
  const beforeDoc = App.project;
  await applyProjectDocument({ project: { width: 2, height: 2, grid: [0, 1, 0] } });
  assert.equal(App.project, beforeDoc, '损坏项目文档不应打开');
  assert.ok(elsMap.toast.textContent.includes('项目文件数据无效'), '损坏项目文档应提示无效');

  const { applyGridChanges } = await import('../static/js/mutations.js');
  seedProject();
  const gridBefore = Array.from(App.project.grid);
  const applied = applyGridChanges([
    { x: -1, y: 0, to: 1 },
    { x: 0, y: 99, to: 1 },
    { x: 0, y: 0, to: -2 },
  ]);
  assert.deepEqual(Array.from(App.project.grid), gridBefore, '越界/非法变更不应写入网格');
  assert.equal(applied.length, 0, '越界/非法变更不应产生实际记录');
  console.log('[OK] 恢复损坏项目载荷：尺寸/网格校验 + 越界变更忽略');
}

// ---------------- 23. 自动保存写串行化：慢写入期间的新保存排队补写，避免旧写覆盖新状态 ----------------
// 放在文件末尾：用例需要真实等待定时器/慢请求，避免改变前面用例的 toast 队列时序。
{
  const { scheduleAutosave } = await import('../static/js/autosave.js');
  seedProject();
  testState.statePutDelayMs = 1000;
  try {
    // 第一次保存：t=0 调度，t=800 开始写入，写请求持续 1000ms
    scheduleAutosave();
    await new Promise((r) => setTimeout(r, 850));
    // 第一次写入仍在途中时产生新状态并再次调度（t=1650 触发，此时应排队补写）
    App.project.grid[0] = 2;
    scheduleAutosave();
    // 等待第一次写入完成 + 排队补写完成
    await new Promise((r) => setTimeout(r, 2200));
    const saved = decodeInt16Grid(testState.stateResponse.project.gridBase64);
    assert.equal(saved[0], 2, '自动保存应串行补写最新状态，而不是让旧写入覆盖新状态');
  } finally {
    testState.statePutDelayMs = 0;
  }
  console.log('[OK] 自动保存写串行化：慢写入期间的新保存排队补写最新状态');
}
