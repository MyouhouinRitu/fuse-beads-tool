async function request(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getConfigs = () => request('/api/configs');
export const getConfig = (name) => request('/api/configs/' + encodeURIComponent(name));
export const createConfig = (name, colors) =>
  request('/api/configs', json({ name, colors }));
export const saveConfig = (name, colors) =>
  request('/api/configs/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colors }) });
export const renameConfig = (name, newName) =>
  request('/api/configs/' + encodeURIComponent(name) + '/rename', json({ newName }));
export const deleteConfig = (name) =>
  request('/api/configs/' + encodeURIComponent(name), { method: 'DELETE' });
export const importConfig = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/configs/import', { method: 'POST', body: fd });
};
export const uploadImage = (file, targetPixels, sharpen) => {
  const fd = new FormData();
  fd.append('image', file);
  fd.append('targetPixels', String(targetPixels));
  fd.append('sharpen', sharpen ? '1' : '0');
  return request('/api/upload', { method: 'POST', body: fd });
};
export const exportImage = (payload) => request('/api/export', json(payload));
export const getState = () => request('/api/state');
export const putState = (state) =>
  request('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
export const authStatus = () => request('/api/auth/status');
export const login = (token) =>
  request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
export const logout = () => request('/api/auth/logout', { method: 'POST' });
