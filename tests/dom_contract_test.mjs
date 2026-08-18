// 组件契约测试（P2）：把 ARIA / 焦点 / pending / 确认弹窗行为固化为可执行用例。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { App, elsMap, hooks, interactionState } from './helpers/dom-harness.mjs';

const html = fs.readFileSync(path.resolve('templates/index.html'), 'utf8');
const css = fs.readFileSync(path.resolve('static/css/style.css'), 'utf8');

// ---------------- 1. 静态 HTML 契约 ----------------
{
  const dialogTitles = {
    'doc-dialog': 'doc-title',
    'export-dialog': 'export-title',
    'login-mask': 'login-title',
    'palette-dialog': 'palette-dialog-title',
    'popup-dialog': 'popup-title',
  };
  for (const [dialogId, titleId] of Object.entries(dialogTitles)) {
    assert.ok(html.includes(`id="${dialogId}"`), `${dialogId} 应存在`);
    assert.ok(html.includes(`role="dialog"`), `${dialogId} 应有 role="dialog"`);
    assert.ok(html.includes(`aria-modal="true"`), `${dialogId} 应有 aria-modal`);
    assert.ok(html.includes(`aria-labelledby="${titleId}"`), `${dialogId} 应关联标题 ${titleId}`);
    assert.ok(html.includes(`id="${titleId}"`), `标题 ${titleId} 应存在`);
  }
  for (const head of ['left-panel-head', 'color-highlight-panel-head', 'right-panel-head']) {
    assert.ok(html.includes(`id="${head}"`), `${head} 应存在`);
    assert.ok(html.includes(`aria-expanded="true"`), `${head} 应有 aria-expanded`);
    assert.ok(html.includes(`aria-controls=`), `${head} 应有 aria-controls`);
  }
  for (const tool of [
    'tool-brush',
    'tool-picker',
    'tool-eraser',
    'tool-crop',
    'tool-wand',
    'tool-mirror',
  ]) {
    assert.ok(html.includes(`id="${tool}"`), `${tool} 应存在`);
    assert.ok(html.includes(`aria-pressed="false"`), `${tool} 应有 aria-pressed`);
  }
  assert.ok(html.includes(`id="btn-theme"`), '主题按钮应存在');
  assert.ok(html.includes(`aria-pressed="false"`), '主题按钮应有 aria-pressed');
  assert.ok(html.includes(`id="target-pixels"`), '目标像素量输入框应存在');
  assert.ok(
    html.includes('id="target-pixels-btn"') && !/target-pixels-btn[^>]*aria-hidden/.test(html),
    '像素量箭头按钮不应 aria-hidden（可聚焦元素不能对辅助技术隐藏）',
  );
  assert.ok(
    html.includes(`role="combobox"`) && html.includes(`aria-controls="target-pixels-menu"`),
    '目标像素量输入框应为 combobox 并关联菜单',
  );
  assert.ok(html.includes('<fieldset id="quick-picker"'), '九宫格应为 fieldset（group 语义）');
  const quickPickerLine = html.split('\n').find((line) => line.includes('id="quick-picker"')) || '';
  assert.ok(!quickPickerLine.includes('role="dialog"'), '九宫格不应标为 dialog（非模态 Popover）');
  console.log('[OK] 静态 HTML 契约：弹窗 ARIA / 面板头 / toggle / combobox');
}

// ---------------- 2. 面板头 aria 动态同步 ----------------
{
  const head = elsMap['left-panel-head'];
  head.setAttribute('aria-expanded', 'true');
  elsMap['left-panel'].classList.remove('collapsed');
  elsMap['left-panel-body'].setAttribute('aria-hidden', 'false');
  head.emit('click');
  assert.ok(elsMap['left-panel'].classList.contains('collapsed'), '点击面板头应收起');
  assert.equal(head.getAttribute('aria-expanded'), 'false', '收起后 aria-expanded 应为 false');
  assert.equal(
    elsMap['left-panel-body'].getAttribute('aria-hidden'),
    'true',
    '收起后面板体应 aria-hidden=true',
  );
  elsMap['left-panel-expand'].emit('click');
  assert.ok(!elsMap['left-panel'].classList.contains('collapsed'), '展开条应展开面板');
  assert.equal(head.getAttribute('aria-expanded'), 'true', '展开后 aria-expanded 应为 true');
  console.log('[OK] 面板头 aria-expanded / aria-hidden 动态同步');
}

// ---------------- 3. 工具 / 主题 aria-pressed ----------------
{
  hooks.setTool('brush');
  assert.equal(elsMap['tool-brush'].getAttribute('aria-pressed'), 'true', '画笔按下应为 pressed');
  assert.equal(elsMap['tool-picker'].getAttribute('aria-pressed'), 'false', '取色应未按下');
  hooks.setTool('select');
  assert.equal(
    elsMap['tool-brush'].getAttribute('aria-pressed'),
    'false',
    '回到选择模式应取消 pressed',
  );
  hooks.toggleTheme();
  const dark = globalThis.document.documentElement.dataset.theme === 'dark';
  assert.equal(
    elsMap['btn-theme'].getAttribute('aria-pressed'),
    String(dark),
    '主题按钮 aria-pressed 应与当前主题一致',
  );
  console.log('[OK] 工具 / 主题 aria-pressed 同步');
}

// ---------------- 4. 目标像素量组合框键盘契约 ----------------
{
  elsMap['target-pixels-menu'].classList.add('hidden');
  elsMap['target-pixels'].setAttribute('aria-expanded', 'false');
  elsMap['target-pixels'].value = '';
  elsMap['target-pixels'].emit('keydown', {
    key: 'ArrowDown',
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(!elsMap['target-pixels-menu'].classList.contains('hidden'), '↓ 应展开菜单');
  assert.equal(
    elsMap['target-pixels'].getAttribute('aria-expanded'),
    'true',
    '展开后 aria-expanded=true',
  );
  const first = elsMap['target-pixels-menu'].querySelector('[role="option"]');
  assert.ok(first, '预设项应有 role=option');
  assert.equal(first.getAttribute('aria-selected'), 'true', '首个预设应高亮');
  elsMap['target-pixels'].emit('keydown', {
    key: 'Enter',
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(elsMap['target-pixels'].value, '400', 'Enter 应应用高亮预设');
  assert.ok(elsMap['target-pixels-menu'].classList.contains('hidden'), '应用后菜单应关闭');
  assert.equal(
    elsMap['target-pixels'].getAttribute('aria-expanded'),
    'false',
    '关闭后 aria-expanded=false',
  );
  console.log('[OK] 目标像素量组合框：↓ / Enter / 关闭');
}

// ---------------- 5. 确认弹窗校验契约 ----------------
{
  const savedAuto = globalThis.__popupAutoConfirm;
  globalThis.__popupAutoConfirm = undefined;
  try {
    const { promptDialog } = await import('../static/js/popup.js');
    const promise = promptDialog('新配置名称：');
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(!elsMap['popup-dialog'].classList.contains('hidden'), '确认弹窗应打开');
    elsMap['popup-input'].value = '';
    elsMap['popup-ok'].emit('click');
    assert.ok(!elsMap['popup-error'].classList.contains('hidden'), '空值应显示校验错误');
    assert.equal(
      elsMap['popup-input'].getAttribute('aria-invalid'),
      'true',
      '空值应标记 aria-invalid',
    );
    assert.ok(!elsMap['popup-dialog'].classList.contains('hidden'), '校验失败弹窗不应关闭');
    elsMap['popup-input'].value = '新配置';
    elsMap['popup-input'].emit('input');
    elsMap['popup-dialog'].emit('keydown', {
      key: 'Enter',
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(await promise, '新配置', 'Enter 应提交输入值');
    assert.ok(elsMap['popup-dialog'].classList.contains('hidden'), '提交后弹窗应关闭');
  } finally {
    globalThis.__popupAutoConfirm = savedAuto;
  }
  console.log('[OK] 确认弹窗：空值校验 / aria-invalid / Enter 提交');
}

// ---------------- 5b. 弹窗队列：并发 confirm 不互相覆盖 ----------------
{
  const savedAuto = globalThis.__popupAutoConfirm;
  globalThis.__popupAutoConfirm = undefined;
  try {
    const { cancelPopup, confirmDialog } = await import('../static/js/popup.js');
    const p1 = confirmDialog('第一个确认');
    const p2 = confirmDialog('第二个确认');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(elsMap['popup-message'].textContent, '第一个确认', '应先显示第一个弹窗');
    assert.ok(!elsMap['popup-dialog'].classList.contains('hidden'), '第一个弹窗应打开');
    cancelPopup();
    assert.equal(await p1, null, '第一个弹窗取消应 resolve null');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      elsMap['popup-message'].textContent,
      '第二个确认',
      '关闭后应自动打开队列中的下一个',
    );
    elsMap['popup-ok'].emit('click');
    assert.equal(await p2, true, '第二个弹窗确认应 resolve true');
    assert.ok(elsMap['popup-dialog'].classList.contains('hidden'), '全部关闭后弹窗应隐藏');
  } finally {
    globalThis.__popupAutoConfirm = savedAuto;
  }
  console.log('[OK] 弹窗队列：并发 confirm 排队依次打开，不覆盖 Promise');
}

// ---------------- 6. withPending 契约 ----------------
{
  const { withPending } = await import('../static/js/utils.js');
  const trigger = elsMap['btn-recompress'];
  trigger.disabled = false;
  trigger.removeAttribute('aria-busy');
  let resolveTask;
  const task = () =>
    new Promise((resolve) => {
      resolveTask = resolve;
    });
  const run = withPending(trigger, task);
  assert.equal(trigger.disabled, true, 'pending 期间应禁用按钮');
  assert.equal(trigger.getAttribute('aria-busy'), 'true', 'pending 期间应有 aria-busy');
  resolveTask();
  await run;
  assert.equal(trigger.disabled, false, '结束后应恢复按钮');
  assert.equal(trigger.getAttribute('aria-busy'), null, '结束后应移除 aria-busy');
  console.log('[OK] withPending：禁用 / aria-busy / 恢复');
}

// ---------------- 7. 设计令牌存在性 ----------------
{
  for (const token of [
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xs',
    '--surface-hover',
    '--surface-active',
    '--focus-ring',
    '--input-bg',
    '--btn-bg',
    '--border-strong',
    '--border-soft',
    '--danger-border',
    '--workspace-bg',
  ]) {
    assert.ok(css.includes(`${token}:`), `设计令牌 ${token} 应定义`);
    assert.ok(css.includes(`data-theme="dark"`), '暗色主题覆盖应存在');
  }
  console.log('[OK] 设计令牌：radius / surface / focus / input / border');
}

// ---------------- 8. 状态对象边界：App / dragState / interactionState 不重叠 ----------------
{
  const appKeys = new Set(Object.keys(App));
  const dragKeys = new Set(Object.keys(globalThis.__dragState));
  const interactionKeys = new Set(Object.keys(interactionState));
  for (const key of dragKeys) {
    assert.ok(!appKeys.has(key), `dragState.${key} 不应出现在 App 中`);
    assert.ok(!interactionKeys.has(key), `dragState.${key} 不应出现在 interactionState 中`);
  }
  for (const key of interactionKeys) {
    assert.ok(!appKeys.has(key), `interactionState.${key} 不应出现在 App 中`);
  }
  assert.ok(!('cropPreview' in globalThis.__dragState), 'cropPreview 应留在 interactionState');
  assert.ok(!('cropEdge' in interactionState), '拖拽中的活动边应留在 dragState');
  console.log('[OK] 状态边界：App / dragState / interactionState 字段不重叠');
}

// ---------------- 9. 测试钩子暴露面契约：新增/删除钩子必须同步本清单 ----------------
{
  const EXPECTED_HOOKS = [
    'renderAll',
    'drawPattern',
    'setTool',
    'updateBrush',
    'paintCell',
    'paintStamp',
    'doUndo',
    'doRedo',
    'toggleTheme',
    'recordCropStep',
    'moveCropEdgeTo',
    'updateCropCursor',
    'updateCropPreview',
    'autoCrop',
    'applyCrop',
    'updateCropMagnifier',
    'applySlider',
    'saveTransaction',
    'deleteHistoryItem',
    'restoreState',
    'renderHistoryUI',
    'openExportDialog',
    'mirrorBeadToOrig',
    'mirrorOrigToBead',
    'getToastQueue',
    'buildProjectDocument',
  ];
  assert.deepEqual(
    Object.keys(hooks).sort(),
    [...EXPECTED_HOOKS].sort(),
    'window.__testHooks 暴露面应与契约清单一致（test-hooks.js 改动需同步本清单）',
  );
  assert.ok(globalThis.__app && globalThis.__dragState && globalThis.__interactionState);
  console.log('[OK] 测试钩子契约：暴露面与清单一致');
}

console.log('\n组件契约测试全部通过');
