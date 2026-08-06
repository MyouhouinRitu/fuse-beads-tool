"""Color conversion and distance helpers (sRGB <-> CIELAB, D65)."""

import numpy as np


def srgb_to_linear(c):
    c = np.clip(c / 255.0, 0.0, 1.0)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb):
    """Convert Nx3 or 3-length RGB array to CIELAB (D65)."""
    rgb = np.asarray(rgb, dtype=np.float64)
    single = rgb.ndim == 1
    if single:
        rgb = rgb[None, :]
    r, g, b = srgb_to_linear(rgb[:, 0]), srgb_to_linear(rgb[:, 1]), srgb_to_linear(rgb[:, 2])
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    xn, yn, zn = 0.95047, 1.0, 1.08883
    fx = np.where(x / xn > 0.008856, np.cbrt(x / xn), 7.787 * (x / xn) + 16 / 116)
    fy = np.where(y / yn > 0.008856, np.cbrt(y / yn), 7.787 * (y / yn) + 16 / 116)
    fz = np.where(z / zn > 0.008856, np.cbrt(z / zn), 7.787 * (z / zn) + 16 / 116)
    l = 116 * fy - 16
    a = 500 * (fx - fy)
    bb = 200 * (fy - fz)
    out = np.stack([l, a, bb], axis=-1)
    return out[0] if single else out


def lab_distance(a, b):
    """Squared CIE76 distance between two Lab vectors (Nx3 or 3-length)."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    return np.sum((a - b) ** 2, axis=-1)


def rgb_distance(a, b):
    """Perceptually weighted RGB distance (squared)."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    dr = a[..., 0] - b[..., 0]
    dg = a[..., 1] - b[..., 1]
    db = a[..., 2] - b[..., 2]
    rmean = (a[..., 0] + b[..., 0]) / 2.0
    return (2 + rmean / 256.0) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256.0) * db * db
