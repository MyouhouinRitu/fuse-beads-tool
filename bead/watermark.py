"""隐写水印：确定性伪随机扩频水印（PNG / JPG / PDF 栅格通用）。

原理
----
水印内容为两行文本（解音知弦 / SoulString-Dev/fuse-beads-tool），以文本为种子
（sha256 → 随机数种子，明文、无密钥）生成一张低频频谱的 ±1 扩频模式图，
以极低幅度（ALPHA，默认 5/255）叠加到图像上：肉眼不可见，几乎不改变色准。
图像内容与随机模式不相关，提取时做归一化相关检测即可判定水印是否存在；
低频频谱使其能承受 JPEG 质量 95 及轻微亮度 / 对比度 / 缩放处理。
裁剪 / 旋转 / 重采样会破坏模式对齐，属于已知局限（弱水印可接受）。

用法
----
python -m bead.watermark embed <in> <out> [--alpha N]
python -m bead.watermark extract <file>
"""

from __future__ import annotations

import argparse
import hashlib
import sys

import numpy as np
from PIL import Image

from bead.meta import WATERMARK_LINES

ALPHA = 5             # 叠加幅度（0-255 灰度值）
PATTERN_BLOCK = 4     # 低频模式块大小：块内同值 → 抗 JPEG，仍与内容不相关
DETECT_THRESHOLD = 0.03   # 归一化相关系数阈值（无噪图 ≤0.019，水印 ≥0.037，见 tests/watermark_test.py）
MIN_PIXELS = 2000     # 图像过小时不嵌入 / 不检测


def _seed(lines: tuple[str, ...]) -> int:
    payload = "\n".join(lines).encode("utf-8")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "little")


def make_pattern(h: int, w: int, lines: tuple[str, ...] = WATERMARK_LINES) -> np.ndarray:
    """由文本生成 (h, w) 的 ±1 低频模式（均值约 0，范数归一化见 embed/detect）。"""
    rng = np.random.default_rng(_seed(lines))
    bh = max(1, (h + PATTERN_BLOCK - 1) // PATTERN_BLOCK)
    bw = max(1, (w + PATTERN_BLOCK - 1) // PATTERN_BLOCK)
    coarse = rng.integers(0, 2, size=(bh, bw)).astype(np.float64) * 2.0 - 1.0
    pat = np.kron(coarse, np.ones((PATTERN_BLOCK, PATTERN_BLOCK)))[:h, :w]
    return pat - pat.mean()


def embed(img: Image.Image, alpha: int = ALPHA, lines: tuple[str, ...] = WATERMARK_LINES) -> Image.Image:
    """把扩频水印叠加到图像副本；图像过小时原样返回。"""
    arr = np.asarray(img).astype(np.float64)
    h, w = arr.shape[0], arr.shape[1]
    if h * w < MIN_PIXELS:
        return img
    pat = make_pattern(h, w, lines)
    pat = pat[..., None] if arr.ndim == 3 else pat
    out = np.clip(arr + alpha * pat, 0, 255).astype(np.uint8)
    return Image.fromarray(out, img.mode)


def extract(
    img: Image.Image | str,
    lines: tuple[str, ...] = WATERMARK_LINES,
    threshold: float = DETECT_THRESHOLD,
) -> dict:
    """检测图像是否包含由 lines 生成的扩频水印，返回相关系数与判定。"""
    src = Image.open(img) if isinstance(img, str) else img
    gray = np.asarray(src.convert("L"), dtype=np.float64)
    h, w = gray.shape
    result = {
        "detected": False,
        "score": 0.0,
        "text": "\n".join(lines),
        "reason": "图像尺寸过小",
    }
    if h * w < MIN_PIXELS:
        return result
    pat = make_pattern(h, w, lines)
    x = gray - gray.mean()
    denom = np.linalg.norm(x) * np.linalg.norm(pat)
    if denom == 0:
        result["reason"] = "零方差图像"
        return result
    score = float(np.dot(x.ravel(), pat.ravel()) / denom)
    result.update({
        "detected": score >= threshold,
        "score": score,
        "reason": "detected" if score >= threshold else "low-score",
    })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="拼豆工具隐写水印：嵌入 / 提取")
    sub = parser.add_subparsers(dest="cmd", required=True)
    ep = sub.add_parser("embed", help="把水印叠加到图像上并另存")
    ep.add_argument("src")
    ep.add_argument("dst")
    ep.add_argument("--alpha", type=int, default=ALPHA)
    xp = sub.add_parser("extract", help="从图像中检测水印")
    xp.add_argument("file")
    args = parser.parse_args()
    if args.cmd == "embed":
        out = embed(Image.open(args.src).convert("RGB"), args.alpha)
        out.save(args.dst)
        print(f"已嵌入水印：{args.dst}（alpha={args.alpha}）")
        return 0
    r = extract(args.file)
    status = "检测到" if r["detected"] else "未检测到"
    print(f"{status}水印：{r['text']!r}（score={r['score']:.4f}，{r['reason']}）")
    return 0 if r["detected"] else 1


if __name__ == "__main__":
    sys.exit(main())
