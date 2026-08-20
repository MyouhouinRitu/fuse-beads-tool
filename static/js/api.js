// 后端 API 封装：统一错误提取与 JSON 请求构造。

/**
 * @param {Response} res
 * @param {string} [fallback]
 */
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

/**
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw await responseError(res);
  return res.json();
}

/**
 * @param {any} body
 * @param {'POST' | 'PUT' | 'DELETE'} [method]
 */
const json = (body, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getConfigs = () => request('/api/configs');
/** @param {string} name */
export const getConfig = (name) => request(`/api/configs/${encodeURIComponent(name)}`);
/** @param {string} name @param {any} colors */
export const createConfig = (name, colors) => request('/api/configs', json({ name, colors }));
/** @param {string} name @param {any} colors */
export const saveConfig = (name, colors) =>
  request(`/api/configs/${encodeURIComponent(name)}`, json({ colors }, 'PUT'));
/** @param {string} name @param {string} newName */
export const renameConfig = (name, newName) =>
  request(`/api/configs/${encodeURIComponent(name)}/rename`, json({ newName }));
/** @param {string} name */
export const deleteConfig = (name) =>
  request(`/api/configs/${encodeURIComponent(name)}`, { method: 'DELETE' });
/** @param {File} file */
export const importConfig = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/configs/import', { method: 'POST', body: fd });
};
/**
 * @param {File | Blob | null} file
 * @param {number} targetPixels
 * @param {boolean} sharpen
 * @param {string | null} [originalId]
 */
export const uploadImage = (file, targetPixels, sharpen, originalId = null) => {
  const fd = new FormData();
  // 从项目/状态恢复的原图是无文件名的 Blob；直接 append 会被浏览器默认命名为 "blob"，
  // 导致后端把 originalName 记成 "blob"。此时只传 originalId，由后端读取已存原图。
  if (file && 'name' in file && typeof file.name === 'string' && file.name !== '')
    fd.append('image', file);
  if (originalId) fd.append('originalId', originalId);
  fd.append('targetPixels', String(targetPixels));
  fd.append('sharpen', sharpen ? '1' : '0');
  return request('/api/upload', { method: 'POST', body: fd });
};
/** @param {string} originalId */
export const getOriginalBlob = async (originalId) => {
  const res = await fetch(`/api/originals/${encodeURIComponent(originalId)}`);
  if (!res.ok) throw await responseError(res, '原图不存在');
  return res.blob();
};
/** @param {string} originalId */
export const deleteOriginal = (originalId) =>
  request(`/api/originals/${encodeURIComponent(originalId)}`, { method: 'DELETE' });
/** @param {object} document @param {string} [filename] */
export const saveProject = (document, filename) =>
  request('/api/project/save', json({ document, filename }));
/** @param {File} file */
export const openProjectUpload = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return request('/api/project/open-upload', { method: 'POST', body: fd });
};
/** @param {object} payload */
export const exportImage = async (payload) => {
  const res = await fetch('/api/export', json(payload));
  if (!res.ok) throw await responseError(res);
  return res.blob();
};
/** @param {object} payload */
export const exportPdfPreview = (payload) => request('/api/export-preview', json(payload));
export const getState = () => request('/api/state');
/** @param {object} state */
export const putState = (state) => request('/api/state', json(state, 'PUT'));
export const authStatus = () => request('/api/auth/status');
/** @param {string} token */
export const login = (token) => request('/api/auth/login', json({ token }));
export const logout = () => request('/api/auth/logout', { method: 'POST' });
