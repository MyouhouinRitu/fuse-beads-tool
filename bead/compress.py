"""Image import helpers: EXIF fix, block-average downscale, optional sharpen."""

from __future__ import annotations

import io
import math

from PIL import Image, ImageFilter, ImageOps

# 目标像素量上下限：与前端 #target-pixels 输入框的 min/max 保持一致
MIN_TARGET_PIXELS = 100
HARD_CAP_PIXELS = 30000
# 中间画布上限：透明占比很高时，需要比目标豆量更大的中间像素量才能补回非透明豆量
MAX_INTERMEDIATE_PIXELS = 500000
# 上传图片解压后的像素总量上限：防止 64MB 文件解压成超大位图耗尽内存
MAX_IMAGE_PIXELS = 50_000_000

# 关闭 Pillow 自带的解压炸弹阈值，由下方显式尺寸校验统一控制（open 后立即检查，不加载像素）
Image.MAX_IMAGE_PIXELS = None

# 锐化参数（UnsharpMask）
SHARPEN_RADIUS = 2
SHARPEN_PERCENT = 80
SHARPEN_THRESHOLD = 2


def open_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    if img.width * img.height > MAX_IMAGE_PIXELS:
        raise ValueError("图片像素过大，无法处理")
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        # 保留透明通道：透明区域交给前端映射为空位（浅灰 X），不再压成白底
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")
    return img


def opaque_ratio(img: Image.Image) -> float:
    """计算会被映射为非空位的像素比例（alpha >= 128 与前端一致）。"""
    if img.mode not in ("RGBA", "LA"):
        return 1.0
    alpha = img.getchannel("A")
    hist = alpha.histogram()
    total = sum(hist)
    if total <= 0:
        return 1.0
    return max(0.0, sum(hist[128:]) / total)


def adjust_target_for_transparency(
    img: Image.Image,
    target: int,
    intermediate_cap: int = MAX_INTERMEDIATE_PIXELS,
) -> int:
    """根据透明比例放大中间目标像素量，使压缩后的非空豆量接近 target。"""
    ratio = opaque_ratio(img)
    if ratio <= 0:
        return max(MIN_TARGET_PIXELS, target)
    effective = target / ratio
    return max(MIN_TARGET_PIXELS, min(round(effective), intermediate_cap))


def compress(
    img: Image.Image,
    target_pixels: int,
    sharpen: bool = False,
    hard_cap: int = HARD_CAP_PIXELS,
    intermediate_cap: int = MAX_INTERMEDIATE_PIXELS,
) -> Image.Image:
    w, h = img.size
    target = max(MIN_TARGET_PIXELS, min(int(target_pixels), hard_cap))
    target = adjust_target_for_transparency(img, target, intermediate_cap)
    scale = math.sqrt(target / (w * h))
    nw = max(1, round(w * scale))
    nh = max(1, round(h * scale))
    if nw * nh > target:
        # 四舍五入后可能略超目标像素量：按同一比例下调一维，保证结果不超过上限
        fix = math.sqrt(target / (nw * nh))
        nw = max(1, math.floor(nw * fix))
        nh = max(1, math.floor(nh * fix))
    img = img.resize((nw, nh), Image.Resampling.BOX)
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
