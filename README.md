# 拼豆工具

![version](https://img.shields.io/badge/version-0.8.0--beta-3b82f6)

一套拼豆（Perler / Fuse Beads）图案制作工具：导入图片 → 压缩成像素图 → 映射豆色 → 简化颜色 → 手动编辑 → 保存 / 撤销 → 导出图片。基于 **Python（Flask）+ HTML/JavaScript**，数据保存在本地，刷新后自动还原。

## 快速开始

```bash
pip install -r requirements.txt
python app.py
```

打开 http://127.0.0.1:5000 即可（默认 5000 端口，可用环境变量 `PORT` 覆盖；需 Python 3.10+）。本地直开与打包版会在后端就绪时自动打开浏览器，`NO_BROWSER=1` 可关闭；Docker 容器内不自动打开。

## 部署方式

- **Docker / NAS**：在 `docker-compose.yml` 设置 `APP_TOKEN`（必填）、`APP_SECRET`（建议随机）、`PUID/PGID`（按挂载目录属主），`docker compose up -d --build` 后访问 `http://NAS地址:5000` 并输入 Token。数据存于 `./data`，升级不丢；公网请配 HTTPS 反向代理。
- **Windows EXE**：运行 `build_exe.bat` 打包，产物 `dist\fuse-beads-tool.exe` 双击即用，常驻系统托盘（双击图标打开网页、右键退出、单实例不重复启动）；数据存于 exe 同级 `data` 目录，需 Token 时提前设置 `APP_TOKEN`。更换图标：替换 `assets\app-icon.png` 后重新打包。

> Token 验证：设置 `APP_TOKEN` 后所有 API 需登录（状态存于会话 Cookie）；未设置时本地直接访问。

## 功能概览

### 导入与压缩

- 支持常见图片格式（自动处理 EXIF 方向）；PNG 透明区显示为空位（浅灰 ×），半透明像素按白底合成。
- 「分块平均 + 感知色域量化」压缩，可勾选锐化；目标像素量默认 4000（上限 30000），超限自动等比缩放。
- 画布按像素格显示（默认每格 28px）：边缘粗黑、格内细灰、每 5 格粗虚线、每 10 格粗实线，四周带行列号条。

### 豆色配置

- 内置 MARD 221 色（默认）与 48 色示例；支持新建 / 重命名 / 删除、直接编辑颜色表、CSV 导入导出（UTF-8 BOM，兼容中英文表头）。
- 配置修改不直接生效，单击「重新压缩」后按新配置重新生成图案。

### 颜色简化

- 每个像素取距离最近的豆色（默认 Lab 感知距离，可切换 RGB）；平局按「已用数量最多 → 左-上-右-下」。
- 「颜色数量」滑块按像素数加权合并相近色；调整会清空快照与撤销记录（有确认提示）。

### 编辑模式

- **选择模式**（默认）：左键单击 / 拖拽选矩形，Shift 追加多选，ESC 清除；右键任意位置拖拽平移。
- **画笔 / 橡皮 / 取色**：点选颜色连续涂色（未选色自动取最暗色；有选区时点击颜色 = 填充选区）；橡皮擦除为空位；画笔尺寸 1-10。
- **魔棒**（T）：按容差选中四向连通的相似色，适合去背景 / 批量换色；Shift 追加选区。
- **裁剪**（R）：矩形裁剪，支持拖动边、点击平行格线移动、自动裁剪到非空格包围盒，应用后整体撤销 / 重做。
- **镜像**（G）：勾选水平 / 垂直即时预览，点击「应用」生效（记一步撤销 / 重做）。
- **D 键九宫格**：按相近色快速改色（单选格优先，否则悬停格），悬停实时预览。
- **颜色清单**：右侧按数量列出已用色号，点击高亮对应像素。

### 工作区视图

- 侧边栏可折叠；「对比原图」在左侧显示原图（可独立缩放拖拽）；「同步拖拽」让两侧坐标与缩放保持一致；支持日间 / 夜间模式（记忆偏好）。

### 快照与撤销

- 工作状态自动保存，刷新后还原；Ctrl+S 保存独立快照（扁平结构），右侧快照清单可切换 / 删除。
- 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y）最多 20 步；重新压缩或调整滑块会清空快照与撤销记录（有警告）。

### 导出图片

- 导出 JPG / PNG / PDF：实时预览，可设置每格大小、网格线、外部白边、行列号、色号、图例、透明色等；导出期间显示进度条。
- PDF 支持 A4 单页、A4 多页、A3 或 A4 三种模式；多页模式带总览页与分页图例。
- 导出内容与画布一致，并自动写入版权与作者元数据（JPG EXIF / PNG tEXt / PDF 文档信息）。

### 项目文件（.ssfbp）

- 「保存项目」（Ctrl+Shift+S）导出单一二进制文件，包含格式版本、状态、原图、视口与校验信息；「打开项目」走浏览器文件选择器。
- 打开前若文档有未保存更改会先确认；快照清单随项目文件保存并整体替换。

## 快捷键

| 按键 | 功能 |
| --- | --- |
| Ctrl+S / Cmd+S | 保存快照 |
| Ctrl+Shift+S / Cmd+Shift+S | 保存项目（.ssfbp，浏览器下载） |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | 撤销 / 重做（最多 20 步） |
| Q / W / E / R / T / G | 画笔 / 取色 / 橡皮 / 裁剪 / 魔棒 / 镜像 |
| D / 1-9 | 相近色九宫格 / 选择 |
| Delete | 清除选中格为空位 |
| Esc | 关闭弹窗 / 清除选择 / 返回选择模式 |
| 鼠标滚轮 / 右键拖拽 | 缩放 / 平移画布 |

## 隐私与许可

- **隐私**：所有数据（色板配置、图案、快照、导入原图、日志）仅保存在本地，不上传、不收集统计信息；除用户主动点击外链外无需联网。
- **导出归属**：导出文件包含用于归属校验的标识（不影响图案内容）。
- **许可**：本项目以 [MIT 协议](LICENSE) 开源，作者为 SoulString-Dev（解音知弦）；导出内容的版权归使用者所有，工具仅在文件中标注生成来源（元数据）。
- **数据存放位置**：色板配置 `data/configs/*.csv`；当前状态与快照清单 `data/state.json`；导入原图 `data/originals/`（按内容哈希存储）。「对比原图」的浏览器缓存位于 IndexedDB。

## 已知限制

- **浏览器鼠标手势冲突**：Edge 内置「鼠标手势」会拦截右键拖拽（画线 / 前进后退 / 关闭标签页），需要把工具地址加入手势排除列表；Chrome 无此问题。详见[右键拖拽修复说明](static/docs/right-drag-gesture-fix.md)。
- **图片尺寸上限**：上传体积上限 64MB、解压后像素上限 5000 万；压缩目标像素量上限 30000，超大或极端长宽比图片会按比例缩小以控制内存。
- **项目文件**：`.ssfbp` 为 v1 私有格式，仅本工具读写，跨版本可能存在兼容差异。
- **平台**：Windows 提供 EXE 与系统托盘；Docker / Linux 可自建部署；macOS 暂未提供打包。
- **数据备份**：数据（配置 / 图案 / 快照 / 原图）仅保存在本地 `data` 目录，公测期间建议定期备份该目录。

## 更新历史

版本记录详见 [CHANGELOG.md](CHANGELOG.md)。

## 测试

```bash
npm test                # 前端逻辑 / DOM 行为 / 组件契约 / 常量同步（纯 Node）
npm run test:backend    # 后端接口冒烟与导出校验
npm run test:ui         # Playwright 完整界面回归
npm run test:render     # Playwright 前后端渲染一致性
npm run test:auth       # Playwright Token 认证端到端
npm run test:coverage   # 覆盖率统计（前端 c8 + 后端 coverage.py，仅报告不设门槛）
npm run check           # lint + typecheck + 测试一键检查
```

## 前端工具链

前端使用 Biome（格式化 / lint）与 TypeScript `checkJs`（类型检查），后端使用 ruff / pyright，通过 npm 脚本统一入口（需要 Node.js 在 PATH 中）。后端工具与跨语言同步测试需要 Python：默认取 PATH 中的 `python`，也可用环境变量 `PYTHON` 覆盖（`lint:backend` / `typecheck:backend` / `test:backend` 统一经 `scripts/run-python.mjs` 取该变量）；pyright 首次运行需要 Node.js，建议把 node 加入 PATH。Playwright 已作为 devDependency 引入，首次运行前执行 `npx playwright install chromium`（CI 会自动安装）。

```bash
npm run format          # Biome 格式化并写入
npm run format:check    # 仅检查格式
npm run lint            # Biome lint + 格式 + import 排序检查
npm run lint:fix        # Biome 自动修复
npm run typecheck       # tsc --noEmit（checkJs 类型检查）
npm run lint:backend    # ruff 检查
npm run typecheck:backend # pyright 检查
```

编辑器推荐安装 Biome 扩展（`.vscode/extensions.json` 已声明），保存时自动格式化并修复。
