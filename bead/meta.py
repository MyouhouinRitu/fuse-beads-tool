"""产品身份与对外署名：统一在此维护作者、版权、仓库与导出署名文案。

文案改动需同步 static/js/constants.js 对应常量
（tests/constants_sync_test.mjs 会强制前后端一致）。
"""

from __future__ import annotations

from bead.version import APP_VERSION

APP_NAME_ZH = "拼豆工具"
APP_NAME_EN = "fuse-beads-tool"
AUTHOR_ZH = "解音知弦"
AUTHOR_EN = "SoulString"
AUTHOR_DISPLAY = "解音知弦 (SoulString)"
COPYRIGHT = "© 2026 解音知弦 (SoulString)"
REPO_URL = "https://github.com/SoulString-Dev/fuse-beads-tool"
ISSUES_URL = f"{REPO_URL}/issues"

# 导出图片底部署名：位于图案与图例之间、右侧对齐（前后端渲染一致）
ATTRIBUTION_TEXT = "由 解音知弦 (SoulString) 研发的拼豆工具生成"

# 隐写水印内容（竖写两行）
WATERMARK_LINES = ("解音知弦", "SoulString-Dev/fuse-beads-tool")


def software_name() -> str:
    """导出元数据 Software / Creator 字段：产品英文名 + 版本。"""
    return f"{APP_NAME_EN} v{APP_VERSION}"
