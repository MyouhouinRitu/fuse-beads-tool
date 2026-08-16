// 项目文档校验：恢复状态 / 打开项目前先验证尺寸、网格长度与值域，
// 避免损坏的 state.json 或 .ssfbp 让画布 / 撤销栈进入不一致状态。
// 与 bead/project_file.py 的 validate_project_document 保持同一套规则。

import { decodeInt16Grid } from './grid-codec.js';

/**
 * 校验项目载荷，返回错误信息字符串；合法时返回 null。
 * @param {any} project
 * @returns {string | null}
 */
export function validateProjectPayload(project) {
  if (!project || typeof project !== 'object') return '项目缺少画布数据';
  const width = Number(project.width);
  const height = Number(project.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return '项目尺寸无效';
  }
  let grid;
  if (Array.isArray(project.grid)) {
    for (const v of project.grid) {
      if (!Number.isInteger(v) || v < -1) return '项目网格包含非法值';
    }
    grid = project.grid;
  } else if (project.grid instanceof Int16Array) {
    grid = Array.from(project.grid);
  } else {
    grid = decodeInt16Grid(project.gridBase64);
    if (!grid) return '项目网格数据无法解码';
  }
  if (grid.length !== width * height) return '项目网格数据长度与尺寸不符';
  return null;
}
