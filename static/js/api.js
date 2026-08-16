async function responseError(res, fallback) {
  let msg = fallback || `请求失败（${res.status}）`;
  try {
    const j = await res.json();
    if (j?.error) msg = j.error;
  } catch (_e) {
    /* ignore */
  }
  return new Error(msg);
}

async function request(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw await responseError(res);
  return res.json();
}

const json = (body, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getConfigs = () => request('/api/configs');
export const getConfig = (name) => request(`/api/configs/${encodeURIComponent(name)}`);
export const createConfig = (name, colors) => request('/api/configs', json({ name, colors }));
export const saveConfig = (name, colors) =>
  request(`/api/configs/${encodeURIComponent(name)}`, json({ colors }, 'PUT'));
export const renameConfig = (name, newName) =>
  request(`/api/configs/${encodeURIComponent(name)}/rename`, json({ newName }));
export const deleteConfig = (name) =>
  request(`/api/configs/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const importConfig = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/configs/import', { method: 'POST', body: fd });
};
export const uploadImage = (file, targetPixels, sharpen, originalId = null) => {
  const fd = new FormData();
  if (file) fd.append('image', file);
  if (originalId) fd.append('originalId', originalId);
  fd.append('targetPixels', String(targetPixels));
  fd.append('sharpen', sharpen ? '1' : '0');
  return request('/api/upload', { method: 'POST', body: fd });
};
export const getOriginalBlob = async (originalId) => {
  const res = await fetch(`/api/originals/${encodeURIComponent(originalId)}`);
  if (!res.ok) throw await responseError(res, '原图不存在');
  return res.blob();
};
export const deleteOriginal = (originalId) =>
  request(`/api/originals/${encodeURIComponent(originalId)}`, { method: 'DELETE' });
export const saveProject = (document, filename) =>
  request('/api/project/save', json({ document, filename }));
export const openProjectUpload = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/project/open-upload', { method: 'POST', body: fd });
};
export const exportImage = async (payload) => {
  const res = await fetch('/api/export', json(payload));
  if (!res.ok) throw await responseError(res);
  return res.blob();
};
export const exportPdfPreview = (payload) => request('/api/export-preview', json(payload));
export const getState = () => request('/api/state');
export const putState = (state) => request('/api/state', json(state, 'PUT'));
export const authStatus = () => request('/api/auth/status');
export const login = (token) => request('/api/auth/login', json({ token }));
export const logout = () => request('/api/auth/logout', { method: 'POST' });
