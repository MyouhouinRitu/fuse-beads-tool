"""隐写水印往返测试：嵌入后可提取、干净图不误报、JPG/PNG/PDF 页均覆盖。

运行：python tests/watermark_test.py
"""

from __future__ import annotations

import io
import os
import sys

import numpy as np
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from bead import pdf_export as pdfx
from bead import watermark as wm
from bead.export import render_pattern

COLORS = [
    "#E23B3B", "#3B7AE2", "#2E7D32", "#F0C040", "#7A3BE2",
    "#3BE27A", "#E27A3B", "#FFFFFF", "#111111", "#888888",
]


def make_pattern_img(w: int, h: int, cell: int, seed: int = 0) -> Image.Image:
    rng = np.random.default_rng(seed)
    grid = [int(rng.integers(0, len(COLORS))) for _ in range(w * h)]
    palette = {i: COLORS[i] for i in range(len(COLORS))}
    legend = [{"hex": COLORS[i], "code": str(i), "count": 50} for i in range(len(COLORS))]
    return render_pattern(
        w, h, grid, palette, cell=cell, grid_lines=True, outer_pad=20,
        legend=legend, show_legend=True, edge_numbers=True,
    )


def test_no_false_positive() -> None:
    bad = [seed for seed in range(40) if wm.extract(make_pattern_img(40, 30, 8, seed))["detected"]]
    assert not bad, f"干净图误报: seeds={bad}"
    print("[OK] 干净图无误报（40 张随机图案）")


def test_roundtrip() -> None:
    for seed in range(6):
        img = make_pattern_img(40, 30, 8, seed)
        wm_img = wm.embed(img)
        assert wm.extract(wm_img)["detected"], f"PNG 往返失败 seed={seed}"
        for q in (95, 90):
            buf = io.BytesIO()
            wm_img.save(buf, "JPEG", quality=q)
            assert wm.extract(Image.open(buf).convert("RGB"))["detected"], (
                f"JPG q{q} 往返失败 seed={seed}"
            )
        assert wm.extract(ImageEnhance.Brightness(wm_img).enhance(0.9))["detected"]
    print("[OK] 水印往返：PNG / JPG q95 / q90 / 亮度（6 张图案）")


def test_small_image() -> None:
    small = make_pattern_img(12, 9, 5)
    wm_small = wm.embed(small)
    assert wm.extract(wm_small)["detected"], "小图 PNG 往返失败"
    buf = io.BytesIO()
    wm_small.save(buf, "JPEG", quality=95)
    assert wm.extract(Image.open(buf).convert("RGB"))["detected"], "小图 JPG 往返失败"
    print("[OK] 小图水印往返（PNG / JPG q95）")


def test_pdf_pages() -> None:
    """PDF 每页栅格都嵌入水印：build_pdf_pages → embed → extract。"""
    grid = [0] * (40 * 30)
    palette = [{"index": 0, "hex": "#E23B3B"}, {"index": 1, "hex": "#3B7AE2"}]
    legend = [
        {"hex": "#E23B3B", "code": "A", "count": 600},
        {"hex": "#3B7AE2", "code": "B", "count": 600},
    ]
    options = {"gridLines": True, "edgeNumbers": True, "showCodes": True, "legend": True}
    pages = pdfx.build_pdf_pages("pdf-multi-a4", 40, 30, grid, palette, legend, None, options, dpi=150)
    for label, page_img, _paper in pages:
        wm_page = wm.embed(page_img)
        assert wm.extract(wm_page)["detected"], f"PDF 页 {label} 水印往返失败"
    print(f"[OK] PDF 各页水印往返（{len(pages)} 页）")


def test_invisible() -> None:
    img = make_pattern_img(40, 30, 8, 0)
    wm_img = wm.embed(img)
    diff = np.abs(np.asarray(img).astype(int) - np.asarray(wm_img).astype(int))
    assert diff.max() <= wm.ALPHA * 2, "水印改动幅度不应超过 2×ALPHA"
    assert diff.mean() < wm.ALPHA, "平均改动应远小于 ALPHA（仅叠加低频模式）"
    print(f"[OK] 水印肉眼不可见：最大改幅 {diff.max()} / 平均改幅 {diff.mean():.2f}")


def main() -> None:
    test_no_false_positive()
    test_roundtrip()
    test_small_image()
    test_pdf_pages()
    test_invisible()
    print("watermark_test: 全部通过")


if __name__ == "__main__":
    main()
