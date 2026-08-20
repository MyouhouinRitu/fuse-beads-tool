// 运行 Python 命令的 npm 脚本辅助入口：
// 优先使用环境变量 PYTHON 指定的解释器，未设置时回退到 PATH 中的 python。
// 用途：npm 脚本（lint:backend / typecheck:backend / test:backend）统一经此运行，
// 避免在 Windows 等环境把解释器路径写死，换机器 / 换解释器无需改 package.json。
// 用法：node scripts/run-python.mjs -m ruff check .（等价于 python -m ruff check .）

import { spawnSync } from 'node:child_process';

const py = process.env.PYTHON || 'python';
const args = process.argv.slice(2);
const res = spawnSync(py, args, { stdio: 'inherit' });

if (res.error) {
  console.error(`[run-python] 无法运行 Python：${res.error.message}`);
  console.error(
    '[run-python] 请设置环境变量 PYTHON 指向 python 可执行文件（例如 Windows 下 ' +
      'PYTHON=C:\\Users\\...\\python.exe），或将 python 加入 PATH。',
  );
  process.exit(127);
}
process.exit(res.status ?? 1);
