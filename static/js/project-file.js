// 项目文件：保存 / 打开 .ssfbp、项目显示名。

import * as api from './api.js';
import { buildProjectDocument, defaultProjectFileName } from './autosave.js';
import { confirmDialog } from './dialog.js';
import { els } from './els.js';
import { App, setDirty, setProjectDirty } from './state.js';
import { downloadUrl, fileNameStem, toast } from './utils.js';

export function updateProjectNameLabel() {
  const name = App.projectName || (App.originalName ? fileNameStem(App.originalName) : '');
  els.projectNameLabel.textContent = name ? `· ${name}` : '';
}

export async function saveProjectFile() {
  if (!App.project) return;
  try {
    const res = await api.saveProject(buildProjectDocument(), defaultProjectFileName());
    downloadUrl(`data:application/octet-stream;base64,${res.dataBase64}`, res.filename);
    App.projectName = fileNameStem(res.filename);
    toast('已生成项目文件（浏览器下载）');
    setDirty(false);
    setProjectDirty(false);
    updateProjectNameLabel();
  } catch (e) {
    toast(`保存项目失败：${e.message}`);
  }
}

export async function openProjectViaDialog() {
  if (App.projectDirty && !confirmDialog('当前项目有未保存的更改，打开新项目将覆盖。是否继续？'))
    return;
  // 统一使用浏览器文件选择器打开项目
  els.projectFileInput.click();
}
