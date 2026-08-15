"""Bead color palette: defaults and CSV import/export."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
from typing import TypedDict


class Color(TypedDict):
    index: int
    code: str
    name: str
    hex: str

HEADER = ["编号", "色号", "名称", "颜色"]


def palette_hash(colors: list[Color]) -> str:
    """色板规范化哈希：与 static/js/hash.js 的 paletteHash 保持一致。"""
    norm = []
    for c in colors or []:
        if not c or "index" not in c:
            continue
        raw = c["index"]
        if isinstance(raw, bool):
            continue
        if isinstance(raw, int):
            idx = raw
        elif isinstance(raw, str) and re.fullmatch(r"-?\d+", raw.strip()):
            idx = int(raw.strip())
        else:
            continue  # 非整数索引与前端约定一致地跳过（含浮点/空值/布尔）
        norm.append({
            "index": idx,
            "code": str(c.get("code") or ""),
            "name": str(c.get("name") or ""),
            "hex": str(c.get("hex") or "").upper(),
        })
    norm.sort(key=lambda c: c["index"])
    text = json.dumps(norm, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

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

MARD_221_PALETTE_CSV = """编号,色号,名称,颜色
1,A1,,#FAF5CD
2,A2,,#FCFED6
3,A3,,#FCFF92
4,A4,,#F7EC5C
5,A5,,#F0D83A
6,A6,,#FDA951
7,A7,,#FA8C4F
8,A8,,#FBDA4D
9,A9,,#F79D5F
10,A10,,#F47E38
11,A11,,#FEDB99
12,A12,,#FDA276
13,A13,,#FEC667
14,A14,,#F75842
15,A15,,#FBF65E
16,A16,,#FEFF97
17,A17,,#FDE173
18,A18,,#FCBF80
19,A19,,#FD7E77
20,A20,,#F9D666
21,A21,,#FAE393
22,A22,,#EDF878
23,A23,,#E4C8BA
24,A24,,#F3F6A9
25,A25,,#FDF785
26,A26,,#FFC734
27,B1,,#DFF13B
28,B2,,#64F343
29,B3,,#A1F586
30,B4,,#5FDF34
31,B5,,#39E158
32,B6,,#64E0A4
33,B7,,#3EAE7C
34,B8,,#1D9B54
35,B9,,#2A5037
36,B10,,#9AD1BA
37,B11,,#627032
38,B12,,#1A6E3D
39,B13,,#C8E87D
40,B14,,#ABE84F
41,B15,,#305335
42,B16,,#C0ED9C
43,B17,,#9EB33E
44,B18,,#E6ED4F
45,B19,,#26B78E
46,B20,,#CBECCF
47,B21,,#18616A
48,B22,,#0A4241
49,B23,,#343B1A
50,B24,,#E8FAA6
51,B25,,#4E846D
52,B26,,#907C35
53,B27,,#D0E0AF
54,B28,,#9EE5BB
55,B29,,#C6DF5F
56,B30,,#E3FBB1
57,B31,,#B4E691
58,B32,,#92AD60
59,C1,,#F0FEE4
60,C2,,#ABF8FE
61,C3,,#A2E0F7
62,C4,,#44CDFB
63,C5,,#06AADF
64,C6,,#54A7E9
65,C7,,#3977CA
66,C8,,#0F52BD
67,C9,,#3349C3
68,C10,,#3CBCE3
69,C11,,#2ADED3
70,C12,,#1E334E
71,C13,,#CDE7FE
72,C14,,#D5FCF7
73,C15,,#21C5C4
74,C16,,#1858A2
75,C17,,#02D1F3
76,C18,,#213244
77,C19,,#18869D
78,C20,,#1A70A9
79,C21,,#BCDDFC
80,C22,,#6BB1BB
81,C23,,#C8E2FD
82,C24,,#7EC5F9
83,C25,,#A9E8E0
84,C26,,#42ADCF
85,C27,,#D0DEF9
86,C28,,#BDCEE8
87,C29,,#364A89
88,D1,,#ACB7EF
89,D2,,#868DD3
90,D3,,#3554AF
91,D4,,#162D7B
92,D5,,#B34EC6
93,D6,,#B37BDC
94,D7,,#8758A9
95,D8,,#E3D2FE
96,D9,,#D5B9F4
97,D10,,#301A49
98,D11,,#BEB9E2
99,D12,,#DC99CE
100,D13,,#B5038D
101,D14,,#862993
102,D15,,#2F1F8C
103,D16,,#E2E4F0
104,D17,,#C7D3F9
105,D18,,#9A64B8
106,D19,,#D8C2D9
107,D20,,#9A35AD
108,D21,,#940595
109,D22,,#38389A
110,D23,,#EADBF8
111,D24,,#768AE1
112,D25,,#4950C2
113,D26,,#D6C6EB
114,E1,,#F6D4CB
115,E2,,#FCC1DD
116,E3,,#F6BDE8
117,E4,,#E8649E
118,E5,,#F0569F
119,E6,,#EB4172
120,E7,,#C53674
121,E8,,#FDDBE9
122,E9,,#E376C7
123,E10,,#D13B95
124,E11,,#F7DAD4
125,E12,,#F693BF
126,E13,,#B5026A
127,E14,,#FAD4BF
128,E15,,#F5C9CA
129,E16,,#FBF4EC
130,E17,,#F7E3EC
131,E18,,#F9C8DB
132,E19,,#F6BBD1
133,E20,,#D7C6CE
134,E21,,#C09DA4
135,E22,,#B38C9F
136,E23,,#937D8A
137,E24,,#DEBEE5
138,F1,,#FE9381
139,F2,,#F63D4B
140,F3,,#EE4E3E
141,F4,,#FB2A40
142,F5,,#E10328
143,F6,,#913635
144,F7,,#911932
145,F8,,#BB0126
146,F9,,#E0677A
147,F10,,#874628
148,F11,,#592323
149,F12,,#F3536B
150,F13,,#F45C45
151,F14,,#FCADB2
152,F15,,#D50527
153,F16,,#F8C0A9
154,F17,,#E89B7D
155,F18,,#D07F4A
156,F19,,#BE454A
157,F20,,#C69495
158,F21,,#F2B8C6
159,F22,,#F7C3D0
160,F23,,#ED806C
161,F24,,#E09DAF
162,F25,,#E84854
163,G1,,#FFE4D3
164,G2,,#FCC6AC
165,G3,,#F1C4A5
166,G4,,#DCB387
167,G5,,#E7B34E
168,G6,,#E3A014
169,G7,,#985C3A
170,G8,,#713D2F
171,G9,,#E4B685
172,G10,,#DA8C42
173,G11,,#DAC898
174,G12,,#FEC993
175,G13,,#B2714B
176,G14,,#8B684C
177,G15,,#F6F8E3
178,G16,,#F2D8C1
179,G17,,#77544E
180,G18,,#FFE3D5
181,G19,,#DD7D41
182,G20,,#A5452F
183,G21,,#B38561
184,H1,,#FFFFFF
185,H2,,#FBFBFB
186,H3,,#B4B4B4
187,H4,,#878787
188,H5,,#464648
189,H6,,#2C2C2C
190,H7,,#010101
191,H8,,#E7D6DC
192,H9,,#EFEDEE
193,H10,,#EBEBEB
194,H11,,#CDCDCD
195,H12,,#FDF6EE
196,H13,,#F4EDF1
197,H14,,#CED7D4
198,H15,,#9AA6A6
199,H16,,#1B1213
200,H17,,#F0EEEF
201,H18,,#FCFFF6
202,H19,,#F2EEE5
203,H20,,#96A09F
204,H21,,#F8FBE6
205,H22,,#CACAD2
206,H23,,#9B9C94
207,M1,,#BBC6B6
208,M2,,#909994
209,M3,,#697E81
210,M4,,#E0D4BC
211,M5,,#D1CCAF
212,M6,,#B0AA86
213,M7,,#B0A796
214,M8,,#AE8082
215,M9,,#A68862
216,M10,,#C4B3BB
217,M11,,#9D7693
218,M12,,#644B51
219,M13,,#C79266
220,M14,,#C27563
221,M15,,#747D7A
"""

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def normalize_color(c: dict[str, object] | None = None) -> Color:
    c = dict(c or {})
    try:
        index = int(c.get("index", 0))
    except (TypeError, ValueError):
        index = 0
    code = str(c.get("code", "") or "").strip()
    name = str(c.get("name", "") or "").strip()
    hexv = str(c.get("hex", "#FFFFFF") or "").strip()
    m = _HEX_RE.match(hexv)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)  # 3 位缩写展开为 6 位，与前端 hexToRgb 一致
        hexv = "#" + h.upper()
    else:
        hexv = "#FFFFFF"
    return {"index": index, "code": code, "name": name, "hex": hexv}


def normalize_colors(colors: list[dict[str, object]] | None) -> list[Color]:
    out = []
    for i, c in enumerate(colors or [], 1):
        c = dict(c)
        c["index"] = i
        out.append(normalize_color(c))
    return out


def _column_map(header: list[str]) -> dict[str, str]:
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


def read_csv_text(text: str) -> list[Color]:
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


def read_csv(path: str) -> list[Color]:
    with open(path, "r", encoding="utf-8-sig") as fh:
        return read_csv_text(fh.read())


def write_csv(path: str, colors: list[dict[str, object]]) -> None:
    rows = normalize_colors(colors)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=HEADER)
        writer.writeheader()
        for c in rows:
            writer.writerow({"编号": c["index"], "色号": c["code"], "名称": c["name"], "颜色": c["hex"]})
