"""应用图标生成脚本（打包前自动执行）。

图标源文件：assets/app-icon.png（替换自己的图标时改这个文件即可）。
脚本会把它归一化为 256x256 并生成多尺寸 packaging/app-icon.ico（PyInstaller 打包用）。
若 assets/app-icon.png 不存在，则先生成一个默认的拼豆图案图标。
"""

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "assets", "app-icon.png")
DST = os.path.join(ROOT, "packaging", "app-icon.ico")

BEAD_COLORS = [
    "#ef4444", "#f97316", "#facc15", "#22c55e",
    "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
    "#ef4444", "#f97316", "#facc15", "#22c55e",
    "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
]


def draw_default_icon(size=256):
    """默认图标：渐变圆角底 + 4x4 拼豆格。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = round(size * 0.2)
    # 竖直渐变底（深蓝 -> 蓝）
    for y in range(size):
        t = y / size
        r = round(79 + (37 - 79) * t)
        g = round(70 + (99 - 70) * t)
        b = round(229 + (235 - 229) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    # 圆角遮罩
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [(4, 4), (size - 4, size - 4)], radius=radius, fill=255
    )
    img.putalpha(mask)
    # 4x4 拼豆
    margin = round(size * 0.16)
    cell = (size - 2 * margin) / 4
    bead_r = round(cell * 0.42)
    hl_r = max(2, round(bead_r * 0.22))
    for i, color in enumerate(BEAD_COLORS):
        row, col = divmod(i, 4)
        cx = margin + col * cell + cell / 2
        cy = margin + row * cell + cell / 2
        draw.ellipse([cx - bead_r, cy - bead_r, cx + bead_r, cy + bead_r], fill=color)
        # 高光点
        draw.ellipse(
            [cx - bead_r * 0.45 - hl_r, cy - bead_r * 0.45 - hl_r,
             cx - bead_r * 0.45 + hl_r, cy - bead_r * 0.45 + hl_r],
            fill=(255, 255, 255, 200),
        )
    return img


def ensure_source():
    if not os.path.exists(SRC):
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        draw_default_icon().save(SRC)
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
