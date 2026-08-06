"""Bead color palette: defaults and CSV import/export."""

import csv
import io
import os
import re

HEADER = ["编号", "色号", "名称", "颜色"]

DEFAULT_PALETTE = [
    {"index": 1, "code": "001", "name": "白色", "hex": "#FFFFFF"},
    {"index": 2, "code": "002", "name": "浅灰", "hex": "#C8C8C8"},
    {"index": 3, "code": "003", "name": "中灰", "hex": "#9E9E9E"},
    {"index": 4, "code": "004", "name": "深灰", "hex": "#616161"},
    {"index": 5, "code": "005", "name": "黑色", "hex": "#1B1B1B"},
    {"index": 6, "code": "006", "name": "米白", "hex": "#F5EBDD"},
    {"index": 7, "code": "007", "name": "奶黄", "hex": "#FFF3B0"},
    {"index": 8, "code": "008", "name": "柠檬黄", "hex": "#FFEB3B"},
    {"index": 9, "code": "009", "name": "明黄", "hex": "#FFD400"},
    {"index": 10, "code": "010", "name": "橘黄", "hex": "#FFB300"},
    {"index": 11, "code": "011", "name": "橙色", "hex": "#FF9800"},
    {"index": 12, "code": "012", "name": "深橙", "hex": "#F57C00"},
    {"index": 13, "code": "013", "name": "橙红", "hex": "#FF7043"},
    {"index": 14, "code": "014", "name": "大红", "hex": "#E53935"},
    {"index": 15, "code": "015", "name": "深红", "hex": "#C62828"},
    {"index": 16, "code": "016", "name": "酒红", "hex": "#8E2430"},
    {"index": 17, "code": "017", "name": "浅粉", "hex": "#F8BBD0"},
    {"index": 18, "code": "018", "name": "桃粉", "hex": "#F48FB1"},
    {"index": 19, "code": "019", "name": "玫红", "hex": "#E91E63"},
    {"index": 20, "code": "020", "name": "紫红", "hex": "#AD1457"},
    {"index": 21, "code": "021", "name": "浅紫", "hex": "#CE93D8"},
    {"index": 22, "code": "022", "name": "紫色", "hex": "#AB47BC"},
    {"index": 23, "code": "023", "name": "深紫", "hex": "#7B1FA2"},
    {"index": 24, "code": "024", "name": "蓝紫", "hex": "#5E35B1"},
    {"index": 25, "code": "025", "name": "浅蓝", "hex": "#81D4FA"},
    {"index": 26, "code": "026", "name": "天蓝", "hex": "#29B6F6"},
    {"index": 27, "code": "027", "name": "蓝色", "hex": "#1E88E5"},
    {"index": 28, "code": "028", "name": "深蓝", "hex": "#1565C0"},
    {"index": 29, "code": "029", "name": "藏青", "hex": "#283593"},
    {"index": 30, "code": "030", "name": "蓝黑", "hex": "#1A237E"},
    {"index": 31, "code": "031", "name": "青色", "hex": "#00BCD4"},
    {"index": 32, "code": "032", "name": "浅青", "hex": "#80DEEA"},
    {"index": 33, "code": "033", "name": "湖蓝", "hex": "#0097A7"},
    {"index": 34, "code": "034", "name": "深青", "hex": "#006064"},
    {"index": 35, "code": "035", "name": "薄荷", "hex": "#A5D6A7"},
    {"index": 36, "code": "036", "name": "浅绿", "hex": "#AED581"},
    {"index": 37, "code": "037", "name": "草绿", "hex": "#8BC34A"},
    {"index": 38, "code": "038", "name": "绿色", "hex": "#43A047"},
    {"index": 39, "code": "039", "name": "深绿", "hex": "#2E7D32"},
    {"index": 40, "code": "040", "name": "墨绿", "hex": "#1B5E20"},
    {"index": 41, "code": "041", "name": "黄绿", "hex": "#C0CA33"},
    {"index": 42, "code": "042", "name": "橄榄", "hex": "#9E9D24"},
    {"index": 43, "code": "043", "name": "浅棕", "hex": "#BCAAA4"},
    {"index": 44, "code": "044", "name": "卡其", "hex": "#A1887F"},
    {"index": 45, "code": "045", "name": "棕色", "hex": "#8D6E63"},
    {"index": 46, "code": "046", "name": "深棕", "hex": "#6D4C41"},
    {"index": 47, "code": "047", "name": "巧克力", "hex": "#4E342E"},
    {"index": 48, "code": "048", "name": "肤色", "hex": "#FFCCBC"},
]

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def normalize_color(c):
    c = dict(c or {})
    try:
        index = int(c.get("index", 0))
    except (TypeError, ValueError):
        index = 0
    code = str(c.get("code", "") or "").strip()
    name = str(c.get("name", "") or "").strip()
    hexv = str(c.get("hex", "#FFFFFF") or "").strip()
    m = _HEX_RE.match(hexv)
    hexv = "#" + m.group(1).upper() if m else "#FFFFFF"
    return {"index": index, "code": code, "name": name, "hex": hexv}


def normalize_colors(colors):
    out = []
    for i, c in enumerate(colors or [], 1):
        c = dict(c)
        c["index"] = i
        out.append(normalize_color(c))
    return out


def _column_map(header):
    mapping = {}
    for raw in header:
        key = str(raw).strip().lower()
        if key in ("编号", "id", "no", "index", "num"):
            mapping["index"] = raw
        elif key in ("色号", "code", "colorcode", "color_code", "sku"):
            mapping["code"] = raw
        elif key in ("名称", "name", "label"):
            mapping["name"] = raw
        elif key in ("颜色", "color", "colour", "hex", "rgb"):
            mapping["hex"] = raw
    return mapping


def read_csv_text(text):
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    cm = _column_map(reader.fieldnames)
    if "hex" not in cm:
        return []
    colors = []
    for row in reader:
        idx = row.get(cm["index"], "") if cm.get("index") else ""
        code = row.get(cm["code"], "") if cm.get("code") else ""
        name = row.get(cm["name"], "") if cm.get("name") else ""
        hexv = row.get(cm["hex"], "")
        colors.append(normalize_color({"index": idx, "code": code, "name": name, "hex": hexv}))
    return normalize_colors(colors)


def read_csv(path):
    with open(path, "r", encoding="utf-8-sig") as fh:
        return read_csv_text(fh.read())


def write_csv(path, colors):
    rows = normalize_colors(colors)
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=HEADER)
        writer.writeheader()
        for c in rows:
            writer.writerow({"编号": c["index"], "色号": c["code"], "名称": c["name"], "颜色": c["hex"]})


def ensure_dir(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
