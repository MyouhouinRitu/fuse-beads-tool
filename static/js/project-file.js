// 项目文件：保存 / 打开 .ssfbp、项目显示名与系统文件对话框开关。

import * as api from './api.js';
import { buildProjectDocument, defaultProjectFileName } from './autosave.js';
import { els } from './els.js';
import { applyProjectDocument } from './restore.js';
import { App, setDirty, setProjectDirty } from './state.js';
import { downloadUrl, fileNameStem, toast } from './utils.js';

let nativeDialogs = false; // 后端明确告知是否支持 Windows 系统文件对话框

export function setNativeDialogs(v) {
  nativeDialogs = !!v;
}

export function updateProjectNameLabel() {
  const name = App.projectName || (App.originalName ? fileNameStem(App.originalName) : '');
  els.projectNameLabel.textContent = name ? `· ${name}` : '';
}

// ---------------- 全量刷新（面板 + 画布） ----------------

export async function saveProjectFile() {
  if (!App.project) return;
  try {
    const isTest =
      typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
    const res = await api.saveProject(
      buildProjectDocument(),
      defaultProjectFileName(),
      isTest ? 'download' : undefined,
    );
    if (res.cancelled) return;
    if (res.mode === 'download') {
      downloadUrl(`data:application/octet-stream;base64,${res.dataBase64}`, res.filename);
      App.projectName = fileNameStem(res.filename);
      toast('已生成项目文件（浏览器下载）');
    } else if (res.mode === 'saved') {
      App.projectName = fileNameStem(String(res.path).split(/[\\/]/).pop());
      toast(`已保存项目：${res.path}`);
    }
    setDirty(false);
    setProjectDirty(false);
    updateProjectNameLabel();
  } catch (e) {
    toast(`保存项目失败：${e.message}`);
  }
}

export async function openProjectViaDialog() {
  if (App.projectDirty && !confirm('当前项目有未保存的更改，打开新项目将覆盖。是否继续？')) return;
  const isTest =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
  if (!nativeDialogs || isTest) {
    els.projectFileInput.click();
    return;
  }
  try {
    const pick = await api.pickOpenProject();
    if (pick.cancelled) return;
    if (pick.error) {
      els.projectFileInput.click();
      return;
    }
    const res = await api.openProjectPath(pick.path);
    await applyProjectDocument(res.document, res.path);
  } catch (e) {
    toast(`打开项目失败：${e.message}`);
  }
}
