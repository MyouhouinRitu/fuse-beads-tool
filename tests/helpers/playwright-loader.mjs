// 测试共享的 Playwright 解析：
// - 默认使用项目 devDependencies 中的 playwright（npm ci / npm install 后即可用）；
// - 可通过 PLAYWRIGHT_PATH 指向其它已安装的 playwright 包目录（目录或入口文件路径）。

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const override = process.env.PLAYWRIGHT_PATH;
  if (override) {
    try {
      return require(override);
    } catch (err) {
      throw new Error(`PLAYWRIGHT_PATH 无法加载：${override}（${err.message}）`);
    }
  }
  try {
    return require('playwright');
  } catch (_err) {
    throw new Error(
      '未找到 playwright 依赖：请先运行 `npm install`（devDependencies 已包含 playwright），' +
        '或设置 PLAYWRIGHT_PATH 指向已安装的 playwright 包目录。',
    );
  }
}

export const { chromium } = loadPlaywright();
