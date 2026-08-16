// 调色板配置管理：选择 / 新建 / 导入 / 导出 / 重命名 / 删除 / 添加颜色。

import * as api from './api.js';
import { els } from './els.js';
import * as palette from './palette.js';
import { confirmDialog, promptDialog } from './popup.js';
import { App, setProjectDirty } from './state.js';
import { downloadUrl, toast, withPending } from './utils.js';

export function bindConfigs() {
  els.configSelect.addEventListener('change', () => {
    const name = els.configSelect.value;
    if (name) {
      setProjectDirty(true);
      palette.loadConfigDetail(name);
    }
  });
  els.btnNewConfig.addEventListener('click', () =>
    withPending(els.btnNewConfig, async () => {
      const name = await promptDialog('配置名称：');
      if (!name) return;
      const colors = App.palette.length
        ? App.palette.map((c) => ({ ...c }))
        : [{ index: 1, code: '001', name: '白色', hex: '#FFFFFF' }];
      try {
        await api.createConfig(name, colors);
        await palette.selectAndLoad(name);
        setProjectDirty(true);
        toast(`已创建配置「${name}」`, { type: 'success' });
      } catch (err) {
        toast(`创建失败：${err.message}`, { type: 'error' });
      }
    }),
  );
  els.btnImportConfig.addEventListener('click', () => els.configFileInput.click());
  els.configFileInput.addEventListener('change', () => {
    const f = els.configFileInput.files[0];
    els.configFileInput.value = '';
    if (!f) return;
    return withPending(els.btnImportConfig, async () => {
      try {
        const res = await api.importConfig(f);
        await palette.selectAndLoad(res.name);
        setProjectDirty(true);
        toast(`已导入配置「${res.name}」（${res.colors.length} 色）`, { type: 'success' });
      } catch (err) {
        toast(`导入失败：${err.message}`, { type: 'error' });
      }
    });
  });
  els.btnExportConfig.addEventListener('click', () => {
    if (!App.configName) return;
    downloadUrl(
      `/api/configs/${encodeURIComponent(App.configName)}/export`,
      `${App.configName}.csv`,
    );
  });
  els.btnRenameConfig.addEventListener('click', () =>
    withPending(els.btnRenameConfig, async () => {
      if (!App.configName) return;
      const newName = await promptDialog('配置名称：', App.configName);
      if (!newName || newName === App.configName) return;
      try {
        await api.renameConfig(App.configName, newName);
        await palette.selectAndLoad(newName);
        setProjectDirty(true);
        toast('已重命名', { type: 'success' });
      } catch (err) {
        toast(`重命名失败：${err.message}`, { type: 'error' });
      }
    }),
  );
  els.btnDeleteConfig.addEventListener('click', () =>
    withPending(els.btnDeleteConfig, async () => {
      if (!App.configName) return;
      if (App.configs.length <= 1) {
        toast('至少需要保留一个配置');
        return;
      }
      if (!(await confirmDialog(`确定删除配置「${App.configName}」吗？`))) return;
      try {
        await api.deleteConfig(App.configName);
        const remaining = App.configs.filter((c) => c.name !== App.configName);
        await palette.selectAndLoad(remaining[0] ? remaining[0].name : null);
        setProjectDirty(true);
        toast('已删除配置', { type: 'success' });
      } catch (err) {
        toast(`删除失败：${err.message}`, { type: 'error' });
      }
    }),
  );
  els.btnAddColor.addEventListener('click', palette.addColor);
}
