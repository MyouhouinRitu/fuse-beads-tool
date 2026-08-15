// 项目文件：保存 / 打开 .ssfbp、项目显示名。

import * as api from './api.js';
import { buildProjectDocument } from './autosave.js';
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
    // 默认文件名由后端统一生成（唯一来源），避免前后端命名逻辑双份维护
    const res = await api.saveProject(buildProjectDocument());
    downloadUrl(`data:application/octet-stream;base64,${res.dataBase64}`, res.filename);
    App.projectName = fileNameStem(res.filename);
    toast('已生成项目文件（浏览器下载）', { type: 'success' });
    setDirty(false);
    setProjectDirty(false);
    updateProjectNameLabel();
  } catch (e) {
    toast(`保存项目失败：${e.message}`, { type: 'error' });
  }
}

export async function openProjectViaDialog() {
  if (
    App.projectDirty &&
    !(await confirmDialog('当前项目有未保存的更改，打开新项目将覆盖。是否继续？'))
  )
    return;
  // 统一使用浏览器文件选择器打开项目
  els.projectFileInput.click();
}
