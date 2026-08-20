// 色板配置面板：配置列表/详情、色表渲染、增删改与延迟保存。

import * as api from './api.js';
import { scheduleAutosave } from './autosave.js';
import { CONFIG_SAVE_DELAY_MS } from './constants.js';
import { els } from './els.js';
import { paletteHash } from './hash.js';
import { renderFullNow } from './render-queue.js';
import { App, setProjectDirty } from './state.js';
import { hintPaletteDeferred, toast } from './utils.js';

// 未导入项目时，编辑工具的颜色列表直接反映当前配置色板，改动后需要同步刷新
function refreshIdleColorList() {
  if (!App.project) renderFullNow();
}

/** @param {string | null | undefined} [selectName] */
/** @param {string | null | undefined} [selectName] */
export async function loadConfigs(selectName) {
  const res = await api.getConfigs();
  /** @type {FuseConfigSummary[]} */
  const configs = res.configs;
  App.configs = configs;
  els.configSelect.innerHTML = '';
  for (const c of configs) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name}（${c.colorCount} 色）`;
    els.configSelect.appendChild(opt);
  }
  const name =
    selectName && configs.some((c) => c.name === selectName)
      ? selectName
      : configs[0]
        ? configs[0].name
        : null;
  App.configName = name;
  els.configSelect.value = name || '';
  if (name && !App.palette.length) {
    await loadConfigDetail(name);
  }
}

/** @param {string} name */
export async function loadConfigDetail(name) {
  const res = await api.getConfig(name);
  const hadPalette = App.palette.length > 0;
  const hash = paletteHash(res.colors);
  const cfg = App.configs.find((c) => c.name === res.name);
  if (cfg) cfg.paletteHash = hash;
  // 色板配置修改（含切换配置）只更新配置本身，画布与编辑工具保持不变；
  // 单击「重新压缩」后才会按新配置重新生成图案
  App.palette = res.colors;
  App.configName = res.name;
  els.configSelect.value = res.name;
  renderColorTable();
  scheduleAutosave();
  // 首次打开加载默认配置不算「更改」，不弹提示
  if (hadPalette) hintPaletteDeferred();
  refreshIdleColorList();
}

/** @param {string} name @returns {Promise<string | null>} */
async function configHashByName(name) {
  const cfg = App.configs.find((c) => c.name === name);
  if (!cfg) return null;
  if (cfg.paletteHash) return cfg.paletteHash;
  try {
    const res = await api.getConfig(name);
    const hash = paletteHash(res.colors);
    cfg.paletteHash = hash;
    return hash;
  } catch (_e) {
    return null;
  }
}

// 恢复色板：优先复用已有同 hash 配置；缺失/不一致时自动创建带后缀的恢复配置
/** @param {FusePaletteColor[]} colors @param {string} preferredName @returns {Promise<{ name: string, hash: string, created: boolean }>} */
export async function ensurePaletteConfig(colors, preferredName) {
  const hash = paletteHash(colors);
  const byHash = App.configs.find((c) => c.paletteHash === hash);
  if (byHash) return { name: byHash.name, hash, created: false };

  const preferred = String(preferredName || '恢复色板').trim() || '恢复色板';
  if ((await configHashByName(preferred)) === hash) {
    return { name: preferred, hash, created: false };
  }

  let name = preferred;
  let attempt = 1;
  while (App.configs.some((c) => c.name === name)) {
    name = `${preferred} (恢复 ${hash.slice(0, 8)})${attempt > 1 ? ` ${attempt}` : ''}`;
    attempt++;
  }
  const res = await api.createConfig(name, colors);
  App.configs.push({
    name: res.name,
    colorCount: res.colors.length,
    paletteHash: hash,
  });
  toast(`已自动创建恢复色板「${res.name}」，原配置未覆盖`, { important: true });
  const opt = document.createElement('option');
  opt.value = res.name;
  opt.textContent = `${res.name}（${res.colors.length} 色）`;
  els.configSelect.appendChild(opt);
  return { name: res.name, hash, created: true };
}

/** @param {string | null} name */
export async function selectAndLoad(name) {
  await loadConfigs(name);
  if (name) await loadConfigDetail(name);
}

function scheduleConfigSave() {
  const name = App.configName;
  if (!name) return;
  clearTimeout(App.configTimer ?? undefined);
  App.configTimer = setTimeout(async () => {
    try {
      await api.saveConfig(name, App.palette);
      const cfg = App.configs.find((c) => c.name === name);
      if (cfg) cfg.paletteHash = paletteHash(App.palette);
    } catch (err) {
      toast(`配置保存失败：${err.message}`, { type: 'error' });
    }
  }, CONFIG_SAVE_DELAY_MS);
}

function renumberPalette() {
  App.palette.forEach((c, i) => {
    c.index = i + 1;
  });
}

// 色表事件委托：容器上只绑定 input/change/click 三组监听，
// 避免 221 行 × 每行 6 个监听器反复创建
export function bindColorTable() {
  const tb = els.colorTable;
  tb.addEventListener('input', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    const row = /** @type {HTMLElement | null} */ (target.closest('.color-row'));
    if (!row) return;
    const i = Number(row.dataset.index);
    if (target.type === 'color') {
      App.palette[i].hex = target.value.toUpperCase();
      const hexInput = row.querySelector('.c-hex');
      if (hexInput) hexInput.value = App.palette[i].hex;
      setProjectDirty(true);
      scheduleConfigSave();
      hintPaletteDeferred();
      refreshIdleColorList();
    }
  });
  tb.addEventListener('change', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    const row = /** @type {HTMLElement | null} */ (target.closest('.color-row'));
    if (!row) return;
    const i = Number(row.dataset.index);
    if (target.classList.contains('c-hex')) {
      const h = /^#?[0-9a-fA-F]{6}$/.test(target.value.trim())
        ? `#${target.value.trim().replace('#', '').toUpperCase()}`
        : App.palette[i].hex;
      App.palette[i].hex = h;
      target.value = h;
      const colorInput = row.querySelector('input[type="color"]');
      if (colorInput) colorInput.value = h;
      setProjectDirty(true);
      scheduleConfigSave();
      hintPaletteDeferred();
      refreshIdleColorList();
    } else if (target.classList.contains('c-code') || target.classList.contains('c-name')) {
      const codeInput = row.querySelector('.c-code');
      const nameInput = row.querySelector('.c-name');
      App.palette[i].code = codeInput ? codeInput.value.trim() : '';
      App.palette[i].name = nameInput ? nameInput.value.trim() : '';
      setProjectDirty(true);
      scheduleConfigSave();
      refreshIdleColorList();
    }
  });
  tb.addEventListener('click', (e) => {
    const del = /** @type {HTMLElement | null} */ (e.target?.closest?.('.del'));
    if (!del) return;
    const row = /** @type {HTMLElement | null} */ (del.closest('.color-row'));
    if (!row) return;
    removeColor(Number(row.dataset.index));
  });
}

export function renderColorTable() {
  const tb = els.colorTable;
  tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  App.palette.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'color-row';
    row.dataset.index = String(i);

    const idx = document.createElement('input');
    idx.type = 'text';
    idx.className = 'c-index';
    idx.value = String(c.index);
    idx.readOnly = true;
    idx.title = '豆编号';

    const code = document.createElement('input');
    code.type = 'text';
    code.className = 'c-code';
    code.value = c.code || '';
    code.title = '豆色号';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'c-name';
    name.value = c.name || '';
    name.title = '名称';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = c.hex;

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'c-hex';
    hex.value = c.hex;

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = '删除该颜色';

    row.append(idx, code, name, color, hex, del);
    frag.appendChild(row);
  });
  tb.appendChild(frag);
}

/** @param {number} i */
function removeColor(i) {
  const oldPalette = App.palette;
  App.palette = App.palette.filter((_, k) => k !== i);
  if (!App.palette.length) {
    toast('至少需要保留一个颜色');
    App.palette = oldPalette;
    return;
  }
  renumberPalette();
  // 只修改色板配置本身，画布保持不变，重新压缩后才会按新配置生成
  renderColorTable();
  setProjectDirty(true);
  scheduleConfigSave();
  hintPaletteDeferred();
  refreshIdleColorList();
}

export function addColor() {
  const n = App.palette.length + 1;
  App.palette.push({ index: n, code: String(n).padStart(3, '0'), name: '', hex: '#FFFFFF' });
  renderColorTable();
  setProjectDirty(true);
  scheduleConfigSave();
  hintPaletteDeferred();
}
