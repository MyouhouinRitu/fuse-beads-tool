// 使用问题修复文档：下拉菜单、极简 Markdown 渲染与文档弹窗。

import { els } from './els.js';

const FIX_DOCS = {
  'right-drag-gesture-fix': '/static/docs/right-drag-gesture-fix.md',
};

// 极简 Markdown 渲染：仅覆盖文档用到的标题/列表/引用/加粗/行内代码/代码块
function renderMarkdown(md) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '';
  let list = null;
  let inCode = false;
  const codeBuf = [];
  const closeList = () => {
    if (list) { html += `</${list}>`; list = null; }
  };
  for (const raw of String(md).split(/\r?\n/)) {
    if (/^```/.test(raw)) {
      if (inCode) { html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; codeBuf.length = 0; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }
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
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }
    const ol = raw.match(/^\s*\d+[.、]\s+(.*)/);
    if (ol) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`;
      continue;
    }
    closeList();
    if (raw.trim() === '') continue;
    html += `<p>${inline(raw)}</p>`;
  }
  if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
  closeList();
  return html;
}

export async function openFixDoc(key) {
  const url = FIX_DOCS[key];
  if (!url) return;
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (err) {
    els.docContent.textContent = '文档加载失败：' + err.message;
    els.docDialog.classList.remove('hidden');
    return;
  }
  els.docContent.innerHTML = renderMarkdown(text);
  els.docDialog.classList.remove('hidden');
}

export function closeFixDoc() {
  els.docDialog.classList.add('hidden');
}
