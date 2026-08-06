// 前端纯算法逻辑测试：颜色映射、贪心合并、事务树
import assert from 'node:assert/strict';
import * as C from '../static/js/colors.js';
import { createEmptyTree, createNode, deleteNode, compressNode } from '../static/js/tree.js';

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
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 0, 255, 255,
    0, 0, 0, 255,
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
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 0, 0, 0,
    255, 0, 0, 128,
    255, 0, 0, 64,
  ]);
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
  assert.deepEqual(m.color.get(rep0).map((v) => Math.round(v)), [255, 9, 9], '合并色应为加权平均');
  console.log('[OK] 贪心合并（滑动条）');
}

// ---- 事务树 ----
{
  const tree = createEmptyTree();
  const n1 = createNode(tree, null, { label: 'a' });
  assert.equal(tree.rootId, n1.id);
  const n2 = createNode(tree, n1.id, { label: 'b' });
  assert.equal(n2.parentId, n1.id);
  assert.deepEqual(tree.nodes[n1.id].children, [n2.id]);

  // 删除 n1 -> 全部删除
  const r = deleteNode(tree, n1.id);
  assert.equal(r.newCurrent, null);
  assert.equal(Object.keys(tree.nodes).length, 0);
  console.log('[OK] 事务树删除');

  // 压缩：根 -> a，a -> b、c，再 b -> d
  const t2 = createEmptyTree();
  const a = createNode(t2, null, {});
  const b = createNode(t2, a.id, {});
  const c = createNode(t2, a.id, {});
  const d = createNode(t2, b.id, {});
  t2.currentId = b.id;
  const cr = compressNode(t2, b.id);
  assert.equal(cr.ok, true);
  assert.equal(cr.newCurrent, a.id);
  assert.equal(t2.nodes[a.id].children.length, 2, 'b 的子节点应挂到 a');
  assert.equal(t2.nodes[d.id].parentId, a.id);
  assert.ok(!t2.nodes[b.id]);
  assert.equal(t2.currentId, a.id, '当前节点 b 被压缩后应切到父节点 a');
  console.log('[OK] 事务树压缩');
}

console.log('\n前端逻辑测试全部通过');
