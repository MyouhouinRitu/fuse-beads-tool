"""Image import helpers: EXIF fix, block-average downscale, optional sharpen."""

import io
import math

from PIL import Image, ImageFilter, ImageOps


def open_image(data):
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        # 保留透明通道：透明区域交给前端映射为空位（浅灰 X），不再压成白底
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")
    return img


def compress(img, target_pixels, sharpen=False, hard_cap=120000):
    w, h = img.size
    target = max(100, min(int(target_pixels), hard_cap))
    scale = math.sqrt(target / (w * h))
    nw = max(1, round(w * scale))
    nh = max(1, round(h * scale))
    img = img.resize((nw, nh), Image.BOX)
    if sharpen:
        img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
    return img


def to_png_base64(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
