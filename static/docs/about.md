## 关于拼豆工具

- **产品**：拼豆工具（fuse-beads-tool）
- **版本**：v{{APP_VERSION}}
- **作者**：解音知弦（SoulString）
- **主页**：[SoulString-Dev/fuse-beads-tool](https://github.com/SoulString-Dev/fuse-beads-tool)

### 隐私说明

- 所有数据（色板配置、当前图案、快照、导入原图）只保存在**本地**，不会上传到任何服务器。
- 使用过程中不会收集任何统计信息，不需要联网即可使用（除「联系作者」等外链外）。

### 数据存放位置

| 内容 | 路径 |
| --- | --- |
| 色板配置 | `data/configs/*.csv` |
| 当前状态与快照清单 | `data/state.json` |
| 导入原图 | `data/originals/` |
| 运行日志（打包版） | `data/app.log` |

> 数据目录位于：Windows EXE 同级的 `data` 目录；Docker 部署为挂载目录；本地直开为项目根目录下的 `data`。升级不会丢失，建议定期备份整个 `data` 目录。

### 许可协议

本项目以 MIT 协议开源，详见 [LICENSE](https://github.com/SoulString-Dev/fuse-beads-tool/blob/main/LICENSE)。

### 第三方致谢

- [Flask](https://flask.palletsprojects.com/)（Web 框架）
- [Pillow](https://python-pillow.org/)（图像处理与导出渲染）
- [NumPy](https://numpy.org/)（像素计算）
- [reportlab](https://www.reportlab.com/)（PDF 导出）
- [waitress](https://docs.pylonsproject.org/projects/waitress/)（生产级 WSGI 服务）
- [pystray](https://pystray.readthedocs.io/)（系统托盘）
- [PyInstaller](https://pyinstaller.org/)（Windows 打包）
- [Biome](https://biomejs.dev/)、[Playwright](https://playwright.dev/)、TypeScript（前端工具链与测试）

### 生成内容版权

- 导出图片 / PDF 会自动写入版权与作者元数据（JPG EXIF / PNG tEXt / PDF 文档信息），并叠加肉眼不可见的隐写水印，用于标注生成来源。
- 图案本身由使用者创作，版权归使用者所有；工具仅标注生成渠道，不主张对图案内容的权利。
