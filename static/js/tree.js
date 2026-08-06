export function createEmptyTree() {
  return { nodes: {}, rootId: null, currentId: null, nextId: 1 };
}

export function collectSubtreeIds(tree, id) {
  const set = new Set();
  const walk = (nid) => {
    set.add(nid);
    for (const c of tree.nodes[nid].children) walk(c);
  };
  walk(id);
  return set;
}

export function createNode(tree, parentId, snapshot) {
  const id = tree.nextId++;
  const node = {
    id,
    parentId,
    createdAt: Date.now(),
    label: `状态 #${id}`,
    children: [],
    snapshot,
  };
  if (parentId == null) {
    tree.rootId = id;
  } else {
    tree.nodes[parentId].children.push(id);
  }
  tree.nodes[id] = node;
  tree.currentId = id;
  return node;
}

export function deleteNode(tree, id) {
  const removed = collectSubtreeIds(tree, id);
  const node = tree.nodes[id];
  let newCurrent = tree.currentId;
  if (removed.has(tree.currentId)) {
    let p = node.parentId;
    while (p != null && removed.has(p)) p = tree.nodes[p].parentId;
    newCurrent = p;
  }
  if (node.parentId != null) {
    const parent = tree.nodes[node.parentId];
    parent.children = parent.children.filter((c) => c !== id);
  } else {
    tree.rootId = null;
  }
  for (const rid of removed) delete tree.nodes[rid];
  tree.currentId = newCurrent;
  return { removed, newCurrent };
}

export function compressNode(tree, id) {
  const node = tree.nodes[id];
  if (node.parentId == null) return { removed: new Set([id]), newCurrent: tree.currentId, ok: false };
  const parent = tree.nodes[node.parentId];
  const at = parent.children.indexOf(id);
  parent.children.splice(at, 1, ...node.children);
  for (const c of node.children) tree.nodes[c].parentId = node.parentId;
  let newCurrent = tree.currentId;
  if (tree.currentId === id) newCurrent = node.parentId;
  delete tree.nodes[id];
  tree.currentId = newCurrent;
  return { removed: new Set([id]), newCurrent, ok: true };
}
