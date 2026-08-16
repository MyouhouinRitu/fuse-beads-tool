// 前端纯算法逻辑测试：颜色映射、贪心合并、扁平事务历史、单步撤销/重做
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as C from '../static/js/colors.js';
import { decodeInt16Grid, encodeInt16Grid } from '../static/js/grid-codec.js';
import { paletteHash, sha256Hex } from '../static/js/hash.js';
import {
  applyStepToGrid,
  applyStructuralStep,
  createEmptyHistory,
  createTransaction,
  deleteTransaction,
  findTransaction,
  MAX_SNAPSHOTS,
  MAX_UNDO_STEPS,
  maxSnapshotsFor,
  recordStep,
  recordStructuralStep,
  redoStep,
  SNAPSHOT_BUDGET_BYTES,
  sanitizeHistory,
  sanitizeUndoStack,
  undoStep,
} from '../static/js/history.js';

// ---- 哈希工具：SHA-256 与色板规范化哈希 ----
{
  for (const text of ['', 'abc', '你好', '{"index":1,"code":"001"}']) {
    assert.equal(
      sha256Hex(text),
      createHash('sha256').update(text, 'utf8').digest('hex'),
      `sha256Hex 应与 Node crypto 一致：${text}`,
    );
  }
  const palette = [
    { index: 2, code: 'B', name: '蓝', hex: '#0000ff' },
    { index: 1, code: 'A', name: '白', hex: '#FFFFFF' },
  ];
  const expected = createHash('sha256')
    .update(
      '[{"index":1,"code":"A","name":"白","hex":"#FFFFFF"},{"index":2,"code":"B","name":"蓝","hex":"#0000FF"}]',
      'utf8',
    )
    .digest('hex');
  assert.equal(paletteHash(palette), expected, '色板哈希应按 index 排序并统一 hex 大写');
  assert.equal(
    paletteHash(palette),
    paletteHash([...palette].reverse()),
    '色板哈希应与输入顺序无关',
  );
  console.log('[OK] 哈希工具：SHA-256 与色板规范化哈希');
}

// ---- 网格 base64 编解码（自动保存紧凑载荷）----
{
  const grid = new Int16Array([0, 1, -1, 221, 0, 7, -1, 2]);
  const encoded = encodeInt16Grid(grid);
  assert.equal(typeof encoded, 'string');
  assert.deepEqual(Array.from(decodeInt16Grid(encoded)), Array.from(grid), '编解码应无损往返');
  assert.equal(decodeInt16Grid('%%%非法%%%'), null, '损坏的 base64 应返回 null');
  assert.equal(decodeInt16Grid(''), null, '空串应返回 null');
  console.log('[OK] 网格 base64 编解码：无损往返 / 损坏输入降级');
}

// ---- 最近色映射（功能三第 1~4 步）----
{
  const palette = [
    { index: 1, hex: '#FF0000' },
    { index: 2, hex: '#0000FF' },
    { index: 3, hex: '#00FF00' },
    { index: 4, hex: '#FFFFFF' },
  ];
  // 2x2 图像：红、红、蓝、纯黑（黑与红/蓝距离不同，唯一最近色？黑到红蓝均为 255 距离）
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255,
  ]);
  const { grid, counts } = C.computeInitialMapping(rgba, 2, 2, palette, false);
  assert.equal(grid[0], 0, '红色像素应映射到红色豆');
  assert.equal(grid[1], 0, '红色像素应映射到红色豆');
  assert.equal(grid[2], 1, '蓝色像素应映射到蓝色豆');
  // 黑色到红/蓝距离：加权 RGB 下 (0,0,0) 与 (255,0,0): dr=255, dg=0, db=0, rm=127.5 -> (2.5)*255^2
  // 与 (0,0,255) 相同，存在平局。先按豆数量：红=2、蓝=1 -> 应选红色
  assert.equal(grid[3], 0, '黑色平局应按豆数量最多的最相近色（红色）');
  assert.deepEqual(counts, [3, 1, 0, 0]);
  console.log('[OK] 最近色映射 + 平局规则');
}

// ---- 透明像素映射（alpha < 128 视为空位，半透明先合成白底）----
{
  const palette = [
    { index: 1, hex: '#FF0000' },
    { index: 2, hex: '#FFFFFF' },
  ];
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 128, 255, 0, 0, 64]);
  const { grid, counts } = C.computeInitialMapping(rgba, 2, 2, palette, false);
  assert.equal(grid[0], 0, '不透明红色像素应映射到红色豆');
  assert.equal(grid[1], -1, '完全透明像素应为空位');
  assert.equal(grid[2], 0, 'alpha=128 的半透明像素应合成白底后映射到红色豆');
  assert.equal(grid[3], -1, 'alpha<128 的半透明像素应为空位');
  assert.deepEqual(counts, [2, 0]);
  console.log('[OK] 透明像素映射为空位');
}

// ---- 贪心合并（滑动条）----
{
  const palette = [
    { index: 1, hex: '#FF0000' },
    { index: 2, hex: '#FF1111' },
    { index: 3, hex: '#0000FF' },
  ];
  const counts = [10, 10, 10];
  const m = C.buildMergeMap(counts, palette, false, 2);
  assert.equal(m.rep.size, 3);
  // 红色与浅红应合并为一簇，蓝色独立
  const rep0 = m.rep.get(0);
  const rep1 = m.rep.get(1);
  const rep2 = m.rep.get(2);
  assert.equal(rep0, rep1, '相近两色应合并');
  assert.notEqual(rep0, rep2, '蓝色应保持独立');
  assert.deepEqual(
    m.color.get(rep0).map((v) => Math.round(v)),
    [255, 9, 9],
    '合并色应为加权平均',
  );
  console.log('[OK] 贪心合并（滑动条）');
}

// ---- 扁平事务历史（独立结构，无子树）----
{
  const h = createEmptyHistory();
  const t1 = createTransaction(h, { grid: [1, 2, 3], width: 3, height: 1 });
  const t2 = createTransaction(h, { grid: [4, 5, 6], width: 3, height: 1 });
  assert.equal(h.items.length, 2, '扁平历史按保存顺序存放');
  assert.equal(t2.id, t1.id + 1, '节点编号递增');
  assert.equal(h.currentId, t2.id, '新保存的节点成为当前节点');
  assert.equal(h.baselineId, t2.id, '新保存的节点也应成为基线事务');
  assert.ok(!('parentId' in t1) && !('children' in t2), '节点之间没有父子关系');
  assert.equal(findTransaction(h, t1.id).id, t1.id);
  assert.equal(findTransaction(h, 999), null);

  // 删除非当前节点：只删除该节点，其它节点与当前节点不受影响
  const delOther = deleteTransaction(h, t1.id);
  assert.equal(delOther.ok, true);
  assert.equal(delOther.newCurrent, t2.id, '删除非当前节点后当前节点不变');
  assert.equal(h.items.length, 1);
  assert.equal(h.currentId, t2.id);

  // 删除当前节点：切到前一个节点
  const t3 = createTransaction(h, { grid: [7, 8, 9], width: 3, height: 1 });
  const delCurrent = deleteTransaction(h, t3.id);
  assert.equal(delCurrent.newCurrent, t2.id, '删除当前节点后应切到相邻节点');
  assert.equal(h.currentId, t2.id);

  // 删除最后一个节点：currentId 置空
  deleteTransaction(h, t2.id);
  assert.equal(h.items.length, 0);
  assert.equal(h.currentId, null);
  console.log('[OK] 扁平事务历史：保存 / 只删单节点 / 切换当前节点');
}

// ---- 旧版树形结构数据兼容：直接清空，不崩溃 ----
{
  const legacy = {
    nodes: { 1: { id: 1, children: [2] }, 2: { id: 2, children: [] } },
    rootId: 1,
    currentId: 2,
    nextId: 3,
  };
  const h = sanitizeHistory(legacy);
  assert.equal(h.items.length, 0);
  assert.equal(h.currentId, null);

  const h2 = sanitizeHistory({
    items: [
      { id: 1, label: 'A', snapshot: { grid: [0, -1], width: 2, height: 1 } },
      { id: 2, label: 'B', snapshot: { grid: [1, 0], width: 2, height: 1 } },
      { id: 'x', snapshot: { grid: [] } },
      { id: 3, snapshot: { grid: 'bad' } },
    ],
    currentId: 2,
    baselineId: 2,
    nextId: 10,
  });
  assert.equal(h2.items.length, 2, '应过滤掉非法节点');
  assert.equal(h2.currentId, 2);
  assert.equal(h2.baselineId, 2, '有效的基线事务应保留');
  assert.equal(sanitizeHistory({ ...h2, baselineId: 99 }).baselineId, null, '失效的基线事务应清空');
  assert.equal(h2.nextId, 3, 'nextId 应根据现有节点推导');
  console.log('[OK] 历史数据清洗与旧树兼容');
}

// ---- 快照数量上限：最多保留最近 MAX_SNAPSHOTS 个 ----
{
  const history = createEmptyHistory();
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
    createTransaction(history, { width: 1, height: 1, grid: [i] });
  }
  assert.equal(history.items.length, MAX_SNAPSHOTS, '快照数量不应超过上限');
  assert.equal(history.items[0].id, 6, '应丢弃最旧的快照');
  assert.equal(history.currentId, history.items[history.items.length - 1].id, '当前应指向最新快照');

  // 清洗端同样限长，且兼容 base64 编码的快照网格
  const items = Array.from({ length: MAX_SNAPSHOTS + 3 }, (_, i) => ({
    id: i + 1,
    createdAt: i + 1,
    snapshot: {
      width: 1,
      height: 1,
      gridBase64: encodeInt16Grid(Int16Array.from([i])),
    },
  }));
  const cleaned = sanitizeHistory({ items, currentId: items.length, baselineId: 1 });
  assert.equal(cleaned.items.length, MAX_SNAPSHOTS, '清洗后快照数量应封顶');
  assert.equal(cleaned.items[0].id, 4, '清洗应保留最新快照');
  assert.deepEqual(cleaned.items[0].snapshot.grid, [3], 'base64 快照应解码为数组');
  assert.equal(cleaned.baselineId, null, '被丢弃的基线应清空');
  console.log('[OK] 快照数量上限：保存与清洗均封顶 / base64 快照解码');
}

// ---- 快照上限按网格规模自适应：大网格按体积预算收缩，小网格仍用硬上限 ----
{
  const limit = maxSnapshotsFor(200, 150); // 30000 格
  assert.ok(limit >= 1 && limit < MAX_SNAPSHOTS, '大网格应收缩快照上限');
  const history = createEmptyHistory();
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
    createTransaction(history, { width: 200, height: 150, grid: new Array(30000).fill(i % 3) });
  }
  assert.equal(history.items.length, limit, '保存端应按网格规模限制快照数量');

  const items = Array.from({ length: MAX_SNAPSHOTS + 3 }, (_, i) => ({
    id: i + 1,
    createdAt: i + 1,
    snapshot: { width: 200, height: 150, grid: new Array(30000).fill(i % 3) },
  }));
  const cleaned = sanitizeHistory({ items, currentId: items.length, baselineId: 1 });
  assert.equal(cleaned.items.length, limit, '清洗端应按网格规模限制快照数量');
  assert.equal(maxSnapshotsFor(2, 2), MAX_SNAPSHOTS, '小网格仍应使用快照硬上限');
  // 体积预算回归：3 万格按自适应上限存满时，历史区 base64 总长不应超过预算
  const budgetGrid = new Int16Array(30000).fill(1);
  const budgetLimit = maxSnapshotsFor(200, 150);
  let totalBytes = 0;
  for (let i = 0; i < budgetLimit; i++) totalBytes += encodeInt16Grid(budgetGrid).length;
  assert.ok(
    totalBytes <= SNAPSHOT_BUDGET_BYTES,
    `历史区 base64 体积应落在预算内：${totalBytes} > ${SNAPSHOT_BUDGET_BYTES}`,
  );
  console.log('[OK] 快照上限按网格规模自适应（体积预算 + 实际体积回归）');
}

// ---- 单步撤销/重做：增量记录 + 20 步上限 ----
{
  const undo = [],
    redo = [];
  const step1 = recordStep(undo, redo, [{ x: 0, y: 0, from: 0, to: 1 }]);
  assert.ok(step1, '应记录第一步');
  const step2 = recordStep(undo, redo, [{ x: 1, y: 0, from: 1, to: 2 }]);
  assert.equal(redo.length, 0, '新记录应清空重做栈');
  assert.equal(undo.length, 2);

  const grid = new Int16Array([0, 1, 0]);
  applyStepToGrid(grid, 3, step1.changes, 'redo');
  assert.equal(grid[0], 1);

  const u = undoStep(undo, redo);
  assert.equal(u, step2, '撤销应取最后一步');
  applyStepToGrid(grid, 3, u.changes, 'undo');
  assert.equal(grid[1], 1);
  assert.equal(redo.length, 1);

  const r = redoStep(undo, redo);
  assert.equal(r, step2, '重做应恢复最后一步');
  applyStepToGrid(grid, 3, r.changes, 'redo');
  assert.equal(grid[1], 2);

  // 20 步上限：记录 25 步后只保留最近 20 步
  const u2 = [],
    r2 = [];
  for (let i = 0; i < 25; i++) recordStep(u2, r2, [{ x: 0, y: 0, from: i, to: i + 1 }]);
  assert.equal(u2.length, MAX_UNDO_STEPS, '撤销栈不应超过 20 步');
  assert.equal(u2[0].changes[0].from, 5, '应丢弃最旧的 5 步');
  console.log('[OK] 单步撤销/重做：增量记录、重做清空、20 步上限');
}

// ---- 结构型步骤（裁剪）：撤销/重做与增量叠加 ----
{
  const undoStack = [];
  const redoStack = [];
  const before = {
    width: 4,
    height: 3,
    grid: Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    baseGrid: Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  };
  const after = {
    width: 2,
    height: 2,
    grid: Int16Array.from([5, 6, 9, 10]),
    baseGrid: Int16Array.from([5, 6, 9, 10]),
  };
  recordStructuralStep(undoStack, redoStack, before, after);
  assert.equal(undoStack.length, 1, '结构型步骤应独占撤销栈');
  assert.ok(undoStack[0].structural && undoStack[0].type === 'crop', '步骤应标记为结构型裁剪');

  const holder = {};
  applyStructuralStep(holder, undoStack[0], 'undo');
  assert.equal(holder.width, 4, '撤销应恢复宽度');
  assert.equal(holder.height, 3, '撤销应恢复高度');
  assert.deepEqual(
    Array.from(holder.grid),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    '撤销应恢复网格',
  );

  undoStep(undoStack, redoStack);
  applyStructuralStep(holder, redoStack[0], 'redo');
  assert.equal(holder.width, 2, '重做应恢复裁剪后宽度');
  assert.deepEqual(Array.from(holder.grid), [5, 6, 9, 10], '重做应恢复裁剪后网格');
  assert.deepEqual(Array.from(holder.baseGrid), [5, 6, 9, 10], '基副本应随裁剪同步');

  // 重做后裁剪步骤回到撤销栈，可继续叠加增量步骤（坐标以新尺寸为准）
  redoStep(undoStack, redoStack);
  recordStep(undoStack, redoStack, [{ x: 0, y: 0, from: 5, to: 0 }]);
  assert.equal(undoStack.length, 2, '裁剪后增量步骤可叠加');
  const popped = undoStep(undoStack, redoStack);
  assert.ok(popped && !popped.structural, '撤销应先取增量步骤');
  assert.equal(undoStack.length, 1, '撤销增量步骤后回到裁剪步骤');
  console.log('[OK] 结构型步骤：裁剪撤销/重做与增量叠加');
}

// ---- 恢复用撤销/重做栈清洗：丢弃损坏步骤、保留结构型快照 ----
{
  const raw = [
    {
      changes: [
        { x: 0, y: 0, from: 1, to: 2 },
        { x: 1, y: 0, from: 2, to: 3 },
      ],
    },
    { changes: [{ x: 0, y: 1, from: 3, to: 'bad' }] },
    'junk',
    null,
    {
      structural: true,
      type: 'crop',
      before: { width: 2, height: 1, grid: [0, 1], baseGrid: [0, 1] },
      after: { width: 1, height: 1, grid: [1], baseGrid: [1] },
    },
    {
      structural: true,
      type: 'crop',
      before: { width: 2, height: 2, grid: [0, 1] }, // grid 长度错误
      after: { width: 1, height: 1, grid: [1] },
    },
  ];
  const cleaned = sanitizeUndoStack(raw);
  assert.equal(cleaned.length, 2, '应保留 1 个有效增量步骤和 1 个有效结构型步骤');
  assert.deepEqual(cleaned[0].changes, [
    { x: 0, y: 0, from: 1, to: 2 },
    { x: 1, y: 0, from: 2, to: 3 },
  ]);
  assert.equal(cleaned[1].structural, true);
  assert.deepEqual(Array.from(cleaned[1].before.grid), [0, 1]);
  assert.equal(sanitizeUndoStack('bad').length, 0, '非数组输入应返回空栈');
  console.log('[OK] 撤销/重做栈清洗：损坏步骤丢弃、结构型快照保留');
}

// ---- 颜色计算异步封装：无 Worker 时降级为同步实现且结果一致 ----
{
  const { computeInitialMappingAsync, mergeGridAsync } = await import(
    '../static/js/color-queue.js'
  );
  const palette = [
    { index: 0, code: 'R', name: '', hex: '#FF0000' },
    { index: 1, code: 'B', name: '', hex: '#0000FF' },
    { index: 2, code: 'G', name: '', hex: '#00FF00' },
  ];
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0, 0, 0, 0]);
  const asyncMap = await computeInitialMappingAsync(rgba, 2, 2, palette, false);
  const syncMap = C.computeInitialMapping(rgba, 2, 2, palette, false);
  assert.deepEqual(Array.from(asyncMap.grid), Array.from(syncMap.grid), '异步映射应与同步一致');
  assert.deepEqual(asyncMap.counts, syncMap.counts, '异步映射计数应与同步一致');
  const merged = await mergeGridAsync(Int16Array.from([0, 1, 2, -1]), 2, 2, palette, false, 1);
  assert.equal(merged, null, '无 Worker 环境应返回 null 由调用方走同步降级');
  console.log('[OK] 颜色计算异步封装：无 Worker 降级同步且结果一致');
}

console.log('\n前端逻辑测试全部通过');
