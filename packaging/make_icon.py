"""应用图标生成脚本（打包前自动执行）。

图标设计源：static/favicon.svg（浏览器标签页图标）。此处用 PIL 复刻同一套
「蓝底圆角方块 + 2x2 拼豆格 + 内描边」图形，生成 assets/app-icon.png 与
packaging/app-icon.ico，保证浏览器 / EXE 文件 / 系统托盘三处图标一致。
若 assets/app-icon.png 不存在，也用同一套设计兜底生成，避免三处图标漂移。
"""

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "assets", "app-icon.png")
DST = os.path.join(ROOT, "packaging", "app-icon.ico")

# 与 static/favicon.svg 保持一致（viewBox 32，按 size/32 等比缩放）
FAVICON_BG = "#3b82f6"  # 蓝底
FAVICON_BEADS = ["#ffffff", "#ffd400", "#ff7043", "#43a047"]  # 白 / 黄 / 橙 / 绿


def draw_icon(size=256):
    """复刻浏览器 favicon：蓝底圆角方块 + 2x2 拼豆格 + 白色半透明内描边。"""
    s = size / 32
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # 蓝底圆角方块
    draw.rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(6 * s), fill=FAVICON_BG
    )
    # 2x2 拼豆格（左上白 / 右上黄 / 左下橙 / 右下绿）
    for i, color in enumerate(FAVICON_BEADS):
        # 行=商、列=余数，与 SVG 的四角布局一致
        row, col = divmod(i, 2)
        x = round((4 + col * 14) * s)
        y = round((4 + row * 14) * s)
        draw.rounded_rectangle(
            [x, y, x + round(10 * s), y + round(10 * s)],
            radius=round(3 * s),
            fill=color,
        )
    # 内描边（白 45% 透明度，线宽 1/32）
    draw.rounded_rectangle(
        [
            round(3.5 * s),
            round(3.5 * s),
            size - round(3.5 * s),
            size - round(3.5 * s),
        ],
        radius=round(5 * s),
        outline=(255, 255, 255, 115),
        width=max(1, round(1 * s)),
    )
    return img


def ensure_source():
    if not os.path.exists(SRC):
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        draw_icon().save(SRC)
        print(f"已生成默认图标源文件：{SRC}")


def main():
    ensure_source()
    img = Image.open(SRC).convert("RGBA")
    img = img.resize((256, 256), getattr(Image, "Resampling", Image).LANCZOS)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(DST, format="ICO", sizes=sizes)
    print(f"已生成：{DST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
