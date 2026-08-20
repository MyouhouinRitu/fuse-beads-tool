// 常见问题说明与帮助文档：下拉菜单、极简 Markdown 渲染与文档弹窗。

import { els } from './els.js';
import { hideDialog, showDialog } from './focus.js';

const FIX_DOCS = {
  'right-drag-gesture-fix': '/static/docs/right-drag-gesture-fix.md',
  shortcuts: '/static/docs/shortcuts.md',
  contact: '/static/docs/contact.md',
  about: '/static/docs/about.md',
};

// 文档里的 {{APP_VERSION}} 占位符替换为顶栏显示的当前版本（v0.7.0 等）
/** @param {string} text @returns {string} */
function interpolateVersion(text) {
  const el = els.appVersion;
  const version = el?.textContent ? el.textContent.trim() : '';
  return version ? String(text).replaceAll('{{APP_VERSION}}', version) : text;
}

// 极简 Markdown 渲染：仅覆盖文档用到的标题/列表/引用/加粗/行内代码/代码块
/** @param {string} md @returns {string} */
function renderMarkdown(md) {
  /** @type {(s: string) => string} */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** @type {(s: string) => string} */
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      );
  let html = '';
  /** @type {string | null} */
  let list = null;
  let inCode = false;
  /** @type {string[] | null} */
  let tableBuf = null;
  const codeBuf = [];
  // 表格：连续以 | 开头的行 → <table>；第二行全为 --- 分隔符时作为表头行
  const flushTable = () => {
    if (!tableBuf) return;
    const rows = tableBuf.map((r) =>
      r
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    );
    /** @type {(cells: string[]) => boolean} */
    const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
    const hasHead = rows.length >= 2 && isSep(rows[1]);
    const head = hasHead ? rows[0] : rows[0] || [];
    const body = hasHead ? rows.slice(2) : rows.slice(1);
    html += '<table><thead><tr>';
    for (const c of head) html += `<th>${inline(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (const cells of body) {
      html += '<tr>';
      for (const c of cells) html += `<td>${inline(c)}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    tableBuf = null;
  };
  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };
  for (const raw of String(md).split(/\r?\n/)) {
    if (/^```/.test(raw)) {
      if (inCode) {
        html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
        codeBuf.length = 0;
        inCode = false;
      } else inCode = true;
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    // 表格行：先收集，遇到非表格行或结束符时统一输出
    if (/^\s*\|/.test(raw)) {
      closeList();
      if (!tableBuf) tableBuf = [];
      tableBuf.push(raw);
      continue;
    }
    flushTable();
    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      continue;
    }
    const quote = raw.match(/^\s*>\s?(.*)/);
    if (quote) {
      closeList();
      if (quote[1].trim() !== '') html += `<blockquote><p>${inline(quote[1])}</p></blockquote>`;
      continue;
    }
    const ul = raw.match(/^\s*[-*]\s+(.*)/);
    if (ul) {
      if (list !== 'ul') {
        closeList();
        html += '<ul>';
        list = 'ul';
      }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }
    const ol = raw.match(/^\s*\d+[.、]\s+(.*)/);
    if (ol) {
      if (list !== 'ol') {
        closeList();
        html += '<ol>';
        list = 'ol';
      }
      html += `<li>${inline(ol[1])}</li>`;
      continue;
    }
    closeList();
    if (raw.trim() === '') continue;
    html += `<p>${inline(raw)}</p>`;
  }
  if (inCode) html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
  flushTable();
  closeList();
  return html;
}

/** @param {keyof typeof FIX_DOCS} key */
export async function openFixDoc(key) {
  const url = FIX_DOCS[key];
  if (!url) return;
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    els.docContent.textContent = `文档加载失败：${err.message}`;
    showDialog(els.docDialog);
    return;
  }
  els.docContent.innerHTML = renderMarkdown(interpolateVersion(text));
  showDialog(els.docDialog);
}

export function closeFixDoc() {
  hideDialog(els.docDialog);
}
