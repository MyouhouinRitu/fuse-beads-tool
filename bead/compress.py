"""Image import helpers: EXIF fix, block-average downscale, optional sharpen."""

from __future__ import annotations

import io
import math

from PIL import Image, ImageFilter, ImageOps

# 目标像素量上下限：与前端 #target-pixels 输入框的 min/max 保持一致
MIN_TARGET_PIXELS = 100
HARD_CAP_PIXELS = 120000

# 锐化参数（UnsharpMask）
SHARPEN_RADIUS = 2
SHARPEN_PERCENT = 80
SHARPEN_THRESHOLD = 2


def open_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        # 保留透明通道：透明区域交给前端映射为空位（浅灰 X），不再压成白底
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")
    return img


def compress(
    img: Image.Image,
    target_pixels: int,
    sharpen: bool = False,
    hard_cap: int = HARD_CAP_PIXELS,
) -> Image.Image:
    w, h = img.size
    target = max(MIN_TARGET_PIXELS, min(int(target_pixels), hard_cap))
    scale = math.sqrt(target / (w * h))
    nw = max(1, round(w * scale))
    nh = max(1, round(h * scale))
    img = img.resize((nw, nh), Image.BOX)
    if sharpen:
        img = img.filter(
            ImageFilter.UnsharpMask(
                radius=SHARPEN_RADIUS, percent=SHARPEN_PERCENT, threshold=SHARPEN_THRESHOLD
            )
        )
    return img


def to_png_base64(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
