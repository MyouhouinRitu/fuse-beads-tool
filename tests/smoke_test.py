"""冒烟测试：启动 Flask 服务并验证核心接口。"""

import base64
import hashlib
import io
import json
import os
import random
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime

from PIL import Image, ImageDraw

BASE = "http://127.0.0.1:5001"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app import create_app
from bead import pdf_export as pdfx
from bead import project_file as pj
from bead.web import assets as web_assets
from bead.web.auth import (
    LOGIN_MAX_ATTEMPTS,
    _clear_login_failures,
    _login_rate_limited,
    _record_login_failure,
)
from bead.web.common import safe_name


def test_filename_helpers():
    # 文件名清洗统一入口：替换非法字符 / 可选截断 / 去结尾点与空格 / 回退名
    assert pj.safe_filename("a/b:c?d*e", "x") == "a_b_c_d_e"
    assert pj.safe_filename("trailing. ") == "trailing"
    assert pj.clean_filename("x" * 100, max_length=60) == "x" * 60
    assert len(safe_name("x" * 100)) == 60, "配置名应限制 60 字符"
    assert safe_name(" ") == "未命名"
    # Windows 保留名：加下划线前缀避免创建失败
    assert pj.safe_filename("CON") == "_CON"
    assert pj.safe_filename("con.txt") == "_con.txt"
    assert pj.clean_filename("NUL", max_length=60) == "_NUL"
    print("[OK] 文件名清洗统一入口（safe_filename / clean_filename / safe_name）")


def build_raw_project(entries):
    """手工构造 .ssfbp 原始字节：entry = (name, payload, flags, uncompressed?)"""
    table_size = pj.ENTRY_SIZE * len(entries)
    offset = pj.HEADER_SIZE + table_size
    table = b""
    stored = []
    for item in entries:
        name, payload, flags = item[0], item[1], item[2]
        uncompressed = item[3] if len(item) > 3 else len(payload)
        table += struct.pack(
            "<16sQQQIII",
            pj.section_id(name),
            offset,
            len(payload),
            uncompressed,
            flags,
            zlib.crc32(payload) & 0xFFFFFFFF,
            0,
        )
        stored.append(payload)
        offset += len(payload)
    digest = hashlib.sha256(b"".join(stored)).digest()
    header = pj.MAGIC + struct.pack("<III", pj.FORMAT_VERSION, len(entries), 0) + digest
    return header + table + b"".join(stored)


def test_project_file_guards():
    cases = [
        ("段名重复", [("state", b"{}", 0), ("state", b"{}", 0)], "段名重复"),
        ("未知标志", [("state", b"{}", 2)], "标志不受支持"),
        ("体积超限", [("state", b"{}", 0, pj.MAX_SECTION_BYTES + 1)], "体积超限"),
        ("解压失败", [("state", b"not-zlib", pj.FLAG_ZLIB)], "解压失败"),
    ]
    for label, entries, msg in cases:
        try:
            pj.parse_project_file(build_raw_project(entries))
        except ValueError as e:
            assert msg in str(e), f"{label}：应报「{msg}」，实际「{e}」"
        else:
            raise AssertionError(f"{label}：应拒绝但未报错")
    print("[OK] 项目文件防护：重复段名 / 未知标志 / 解压体积上限 / 损坏数据")


def test_login_rate_limit():
    _clear_login_failures("test-ip")
    for _ in range(LOGIN_MAX_ATTEMPTS):
        _record_login_failure("test-ip")
    assert _login_rate_limited("test-ip"), "达到失败上限后应限流"
    _clear_login_failures("test-ip")
    assert not _login_rate_limited("test-ip"), "清除失败记录后应恢复"
    print("[OK] 登录失败限流（内存态计数 / 清除）")


def test_app_factory_isolation():
    # 同一进程创建两个数据目录不同的应用实例，配置与状态读写应互不串扰
    app1 = create_app(tempfile.mkdtemp(prefix="fuse_app1_"))
    app2 = create_app(tempfile.mkdtemp(prefix="fuse_app2_"))
    c1 = app1.config["BEAD_CONFIG"]
    c2 = app2.config["BEAD_CONFIG"]
    assert c1.data_dir != c2.data_dir
    assert c1.state_file != c2.state_file
    cli1 = app1.test_client()
    cli2 = app2.test_client()
    assert cli1.put("/api/state", json={"owner": "one"}).status_code == 200
    assert cli1.get("/api/state").get_json()["owner"] == "one"
    assert cli2.get("/api/state").get_json() == {}
    print("[OK] 应用工厂隔离：两个数据目录互不串扰")


def test_originals_gc():
    # 启动清理：只保留当前 state.json 引用的原图，其余按内容哈希文件删除
    data_dir = tempfile.mkdtemp(prefix="fuse_gc_")
    app = create_app(data_dir)
    cfg = app.config["BEAD_CONFIG"]
    os.makedirs(cfg.original_dir, exist_ok=True)
    keep = "a" * 64
    stale = "b" * 64
    with open(os.path.join(cfg.original_dir, keep), "wb") as fh:
        fh.write(b"keep")
    with open(os.path.join(cfg.original_dir, stale), "wb") as fh:
        fh.write(b"stale")
    with open(cfg.state_file, "w", encoding="utf-8") as fh:
        json.dump({"original": {"id": keep}}, fh)
    web_assets.gc_originals(cfg)
    assert os.path.exists(os.path.join(cfg.original_dir, keep)), "当前引用的原图应保留"
    assert not os.path.exists(os.path.join(cfg.original_dir, stale)), "未引用的原图应被清理"
    print("[OK] 原图 GC：保留当前引用，清理未引用文件")


def test_auth_gate_with_token():
    # APP_TOKEN 配置化后：未登录 401、错误 Token 401、正确 Token 放行
    os.environ["APP_TOKEN"] = "secret-token"
    try:
        app = create_app(tempfile.mkdtemp(prefix="fuse_auth_"))
        cli = app.test_client()
        assert cli.get("/api/configs").status_code == 401
        assert cli.post("/api/auth/login", json={"token": "wrong"}).status_code == 401
        assert cli.post("/api/auth/login", json={"token": "secret-token"}).status_code == 200
        assert cli.get("/api/configs").status_code == 200
    finally:
        os.environ.pop("APP_TOKEN", None)
    print("[OK] Token 认证门禁（APP_TOKEN 配置化后仍生效）")


def req(method, path, data=None, raw=False):
    headers = {}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            if raw:
                return resp.status, resp.read()
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if raw:
            return e.code, e.read()
        return e.code, json.loads(e.read().decode())


def upload(path, target_pixels, sharpen, original_id=None, mirror=False):
    content = b""
    if path:
        with open(path, "rb") as fh:
            content = fh.read()
    boundary = "----smoke-boundary"
    parts = []
    for name, value in (
        ("targetPixels", str(target_pixels)),
        ("sharpen", "1" if sharpen else "0"),
        ("mirror", "1" if mirror else "0"),
    ):
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        )
    if original_id:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"originalId\"\r\n\r\n"
            f"{original_id}\r\n".encode()
        )
    if path:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"test.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n".encode()
            + content
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    r = urllib.request.Request(
        BASE + "/api/upload",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def upload_project_bytes(content):
    boundary = "----smoke-project-boundary"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.ssfbp\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n".encode()
        + content
        + f"\r\n--{boundary}--\r\n".encode()
    )
    r = urllib.request.Request(
        BASE + "/api/project/open-upload",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def make_test_image(path):
    img = Image.new("RGB", (640, 400), (235, 235, 235))
    d = ImageDraw.Draw(img)
    colors = [(255, 0, 0), (0, 0, 255), (0, 160, 0), (255, 200, 0), (128, 0, 255), (0, 200, 255)]
    for i in range(8):
        x0 = i * 80
        d.rectangle([x0, 0, x0 + 79, 399], fill=random.choice(colors))
    # 添加一些渐变和细节，模拟二次元色块
    for i in range(200):
        x, y = random.randrange(640), random.randrange(400)
        c = random.choice(colors)
        d.ellipse([x, y, x + random.randrange(8, 40), y + random.randrange(8, 40)], fill=c)
    img.save(path, "PNG")


def test_legend_total_and_vertical_center():
    from bead.export import (
        LEGEND_FONT_RATIO,
        _font,
        _legend_metrics,
        _legend_text_top,
        _legend_total_needs_extra_row,
        legend_height,
    )

    legend = [
        {"hex": "#E23B3B", "code": "R1", "count": 3},
        {"hex": "#3B7AE2", "code": "B2", "count": 2},
        {"hex": "#2E7D32", "code": "G3", "count": 1},
    ]
    cell = 28
    font = _font(cell, LEGEND_FONT_RATIO)
    # 窄图：总豆量放不下最后一行，需要额外一行
    assert _legend_total_needs_extra_row(legend, 2 * cell, cell, font)
    _font_size, _sw, row_h = _legend_metrics(cell)
    assert legend_height(len(legend), 2 * cell, cell, extra_row=True) - legend_height(
        len(legend), 2 * cell, cell
    ) == row_h
    # 宽图：总豆量放得下最后一行，不额外加行
    assert not _legend_total_needs_extra_row(legend, 40 * cell, cell, font)
    # 垂直居中：文本包围盒中心应与色块中心重合（容差 0.5px）
    text = "R1 × 3"
    top = _legend_text_top(8, font, text)
    _left, t, _right, b = font.getbbox(text)
    center = top + t + (b - t) / 2
    assert abs(center - 4) <= 0.5, center
    print("[OK] 图例总豆量：额外行判定 / 高度 / 垂直居中")

def make_mirror_test_image(path):
    """120x80 三色竖条（左红/中绿/右蓝），用于镜像的确定性验证。"""
    img = Image.new("RGB", (120, 80), (0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 39, 79), fill=(255, 0, 0))
    d.rectangle((40, 0, 79, 79), fill=(0, 255, 0))
    d.rectangle((80, 0, 119, 79), fill=(0, 0, 255))
    img.save(path)

def make_transparent_image(path):
    img = Image.new("RGBA", (800, 600), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([100, 100, 700, 500], fill=(255, 0, 0, 255))
    img.save(path, "PNG")


def main():
    # 用临时数据目录启动，避免测试状态写入真实 data/（如 state.json）
    data_dir = tempfile.mkdtemp(prefix="fuse_smoke_data_")
    env = {**os.environ, "DATA_DIR": data_dir, "NO_BROWSER": "1"}
    server_log = os.path.join(tempfile.gettempdir(), "fuse_smoke_server.log")
    with open(server_log, "wb") as out:
        proc = subprocess.Popen(
            [sys.executable, "app.py", "--port", "5001"],
            cwd=ROOT,
            env=env,
            stdout=out,
            stderr=subprocess.STDOUT,
        )
    try:
        # 等待服务就绪
        for _ in range(40):
            try:
                req("GET", "/api/configs")
                break
            except Exception:
                time.sleep(0.25)
        else:
            raise RuntimeError("服务启动超时")

        s, page = req("GET", "/", raw=True)
        assert s == 200 and b"<title>" in page, "首页模板应可渲染"
        print("[OK] 首页模板可渲染（GET /）")

        test_filename_helpers()
        test_project_file_guards()
        test_login_rate_limit()
        test_app_factory_isolation()
        test_originals_gc()
        test_auth_gate_with_token()
        test_legend_total_and_vertical_center()

        s, j = req("GET", "/api/configs")
        assert s == 200 and j["configs"], "配置列表为空"
        first = j["configs"][0]
        assert first["paletteHash"] and len(first["paletteHash"]) == 64
        print(f"[OK] 配置列表：{first['name']}（{first['colorCount']}色）")

        s, j = req("GET", "/api/configs/" + urllib.parse.quote(first["name"]))
        assert s == 200 and len(j["colors"]) == first["colorCount"]
        print("[OK] 读取配置详情")

        s, j = req("GET", "/api/configs/" + urllib.parse.quote("不存在的配置"))
        assert s == 404 and j["error"] == "配置不存在"
        print("[OK] 读取不存在的配置返回 404")

        s, j = req("GET", "/api/not-exist")
        assert s == 404 and isinstance(j.get("error"), str), "未知 API 应返回 JSON 404"
        print("[OK] 未知 API 返回 JSON 404")

        cfg_name = f"测试配置_{int(time.time())}"
        s, j = req("POST", "/api/configs", {
            "name": cfg_name,
            "colors": [
                {"index": 1, "code": "T1", "name": "红", "hex": "#FF0000"},
                {"index": 2, "code": "T2", "name": "蓝", "hex": "#0000FF"},
            ],
        })
        assert j["ok"]
        s, j = req("GET", "/api/configs/" + urllib.parse.quote(cfg_name))
        assert j["colors"][0]["hex"] == "#FF0000"
        print("[OK] 创建并读取配置")

        # 重命名冲突 / Windows 保留名（HTTP 层）
        cfg_r1 = f"重命名A_{int(time.time())}"
        cfg_r2 = f"重命名B_{int(time.time())}"
        one_color = [{"index": 1, "code": "R", "name": "红", "hex": "#FF0000"}]
        assert req("POST", "/api/configs", {"name": cfg_r1, "colors": one_color})[0] == 200
        assert req("POST", "/api/configs", {"name": cfg_r2, "colors": one_color})[0] == 200
        s, j = req(
            "POST",
            f"/api/configs/{urllib.parse.quote(cfg_r1)}/rename",
            {"newName": cfg_r2},
        )
        assert s == 400 and "已存在" in j["error"]
        s, j = req(
            "POST",
            f"/api/configs/{urllib.parse.quote(cfg_r1)}/rename",
            {"newName": "CON"},
        )
        assert j["ok"] and j["name"] == "_CON", f"保留名应加前缀，实际 {j.get('name')}"
        s, j = req("POST", "/api/configs", {"name": "NUL", "colors": one_color})
        assert j["ok"] and j["name"] == "_NUL", f"保留名创建应加前缀，实际 {j.get('name')}"
        for name in ("_CON", "_NUL", cfg_r2):
            assert req("DELETE", "/api/configs/" + urllib.parse.quote(name))[0] == 200
        print("[OK] 配置重命名冲突 400 / 保留名自动加前缀")

        # 配置名带 .csv 后缀：应规范化为不含扩展名的名称，避免 name.csv.csv
        cfg_dot = f"带点_{int(time.time())}.csv"
        s, j = req("POST", "/api/configs", {"name": cfg_dot, "colors": one_color})
        assert j["ok"] and j["name"] == cfg_dot[:-4], f"配置名应去掉 .csv，实际 {j.get('name')}"
        dot_stem = cfg_dot[:-4]
        assert os.path.exists(os.path.join(data_dir, "configs", dot_stem + ".csv"))
        s, j = req("GET", "/api/configs/" + urllib.parse.quote(dot_stem))
        assert s == 200 and j["name"] == dot_stem
        assert req("DELETE", "/api/configs/" + urllib.parse.quote(dot_stem))[0] == 200
        print("[OK] 配置名 .csv 后缀规范化（不生成 .csv.csv）")

        s, raw = req("GET", "/api/configs/" + urllib.parse.quote(cfg_name) + "/export", raw=True)
        assert b"\xff\x00\x00" in raw.upper() or b"FF0000" in raw.upper()
        print("[OK] 导出 CSV")

        tmp = tempfile.mkdtemp(prefix="fuse_smoke_")
        # 无效图片：应返回 400 且不落盘（原图目录保持为空）
        bad_path = os.path.join(tmp, "bad.png")
        with open(bad_path, "wb") as fh:
            fh.write(b"not an image")
        s, j = upload(bad_path, 4000, False)
        assert s == 400, f"无效图片应返回 400，实际 {s}"
        assert not os.listdir(os.path.join(data_dir, "originals")), "无效图片不应留下孤儿原图"
        print("[OK] 无效图片返回 400 且不落盘")

        s, j = upload(None, 4000, False)
        assert s == 400 and j["error"] == "未收到图片"
        print("[OK] 未传图片返回 400")

        s, j = req("GET", "/api/originals/" + "z" * 64)
        assert s == 404 and j["error"] == "原图不存在"
        s, j = req("DELETE", "/api/originals/" + "a" * 64)
        assert s == 200 and j["ok"]
        print("[OK] 原图非法/缺失引用：读取 404 / 删除幂等")

        img_path = os.path.join(tmp, "test.png")
        make_test_image(img_path)
        s, j = upload(img_path, 30000, True)
        assert s == 200 and j["width"] * j["height"] <= 30000
        print(f"[OK] 图片压缩：{j['width']} × {j['height']}")
        original_id = j["originalId"]
        assert original_id
        s, raw = req("GET", "/api/originals/" + original_id, raw=True)
        assert s == 200 and raw
        print("[OK] 原图落盘与读取")
        s, j = upload(None, 30000, False, original_id=original_id)
        assert s == 200 and j["originalId"] == original_id
        print("[OK] 按原图引用重新压缩")
        # 水平镜像：无缩放三色条图，mirror=1 的输出应与原输出完全左右翻转一致
        mirror_path = os.path.join(tmp, "mirror_test.png")
        make_mirror_test_image(mirror_path)
        s, j0 = upload(mirror_path, 9600, False)
        assert s == 200, f"普通上传应成功，实际 {s}"
        plain_img = Image.open(io.BytesIO(base64.b64decode(j0["pngBase64"])))
        assert plain_img.size == (120, 80), f"无缩放输出尺寸应为 120x80，实际 {plain_img.size}"
        s, j1 = upload(mirror_path, 9600, False, mirror=True)
        assert s == 200, f"镜像上传应成功，实际 {s}"
        mimg = Image.open(io.BytesIO(base64.b64decode(j1["pngBase64"])))
        assert list(mimg.get_flattened_data()) == list(plain_img.transpose(Image.FLIP_LEFT_RIGHT).get_flattened_data()), "镜像输出应等于原输出水平翻转"
        assert mimg.getpixel((0, 40)) == (0, 0, 255), "镜像后左侧应为蓝色"
        assert mimg.getpixel((119, 40)) == (255, 0, 0), "镜像后右侧应为红色"
        print("[OK] 水平镜像：输出与原图水平翻转一致")

        transp_path = os.path.join(tmp, "transparent.png")
        make_transparent_image(transp_path)
        s, j = upload(transp_path, 30000, False)
        assert s == 200
        timg = Image.open(io.BytesIO(base64.b64decode(j["pngBase64"])))
        assert timg.mode == "RGBA", "透明 PNG 应保留 alpha 通道"
        alpha = timg.getchannel("A")
        assert alpha.getextrema() == (0, 255), "返回图像应同时包含透明与不透明像素"
        hist = alpha.histogram()
        opaque = sum(hist[128:])
        assert abs(opaque - 30000) <= 8000, (
            f"透明图压缩后非空豆量应接近目标 30000，实际 {opaque}"
        )
        print("[OK] 透明 PNG 保留 alpha")

        grid = [-1] * (j["width"] * j["height"])
        palette = [{"index": 0, "hex": "#FF0000"}, {"index": 1, "hex": "#0000FF"}]
        s, raw = req("POST", "/api/export", {
            "width": j["width"],
            "height": j["height"],
            "grid": grid,
            "palette": palette,
            "options": {"cellSize": 8, "gridLines": True, "margins": True, "format": "jpg"},
        }, raw=True)
        assert s == 200 and raw[:3] == b"\xff\xd8\xff", "导出 JPG 应返回 JPEG 二进制流"
        print("[OK] 导出 JPG")

        # 非法导出输入：非法网格返回 400 JSON；非法数值选项回退默认值
        s, j = req("POST", "/api/export", {
            "width": "abc",
            "height": 2,
            "grid": [0, 0, 0, 0],
            "palette": [{"index": 0, "hex": "#FF0000"}],
            "options": {"format": "jpg"},
        })
        assert s == 400 and j["error"] == "网格数据无效"
        s, raw = req("POST", "/api/export", {
            "width": 2,
            "height": 2,
            "grid": [0, 0, 0, 0],
            "palette": [{"index": 0, "hex": "#FF0000"}],
            "options": {"format": "jpg", "cellSize": "abc", "outerPad": "x", "quality": "bad"},
        }, raw=True)
        assert s == 200 and raw[:3] == b"\xff\xd8\xff", "非法数值选项应回退默认并返回 JPEG 二进制流"
        print("[OK] 导出非法输入：非法网格 400 / 非法数值选项回退默认")

        s, j = req("POST", "/api/export-preview", {
            "width": "abc",
            "height": 2,
            "grid": [0, 0, 0, 0],
            "palette": [{"index": 0, "hex": "#FF0000"}],
            "options": {"format": "pdf-a4"},
        })
        assert s == 400 and j["error"] == "网格数据无效"
        print("[OK] 导出预览非法网格返回 400")

        for pdf_fmt in ("pdf-a4", "pdf-multi-a4", "pdf-a3-a4"):
            s, raw = req("POST", "/api/export", {
                "width": 70,
                "height": 75,
                "grid": [0] * (70 * 75),
                "palette": [{"index": 0, "hex": "#FF0000"}],
                "legend": [{"hex": "#FF0000", "code": "R", "count": 5250}],
                "options": {"cellSize": 8, "gridLines": True, "edgeNumbers": True,
                            "showCodes": True, "legend": True, "format": pdf_fmt},
            }, raw=True)
            assert s == 200 and raw[:4] == b"%PDF", f"{pdf_fmt} 应返回 PDF 二进制流"
        print("[OK] 导出 PDF（A4单页 / A4多页 / A3或A4）")

        s, j = req("POST", "/api/export-preview", {
            "width": 70,
            "height": 75,
            "grid": [0] * (70 * 75),
            "palette": [{"index": 0, "hex": "#FF0000"}],
            "legend": [{"hex": "#FF0000", "code": "R", "count": 5250}],
            "options": {"gridLines": True, "edgeNumbers": True,
                        "showCodes": True, "legend": True, "format": "pdf-multi-a4"},
        })
        assert len(j["pages"]) == 5
        assert j["pages"][0]["page"] == "总"
        assert j["pages"][1]["page"] == "1"
        assert all(p["dataUrl"].startswith("data:image/png;base64,") for p in j["pages"])
        print("[OK] PDF 分页预览接口")

        tiles65 = pdfx.page_tiles(65, 60)
        assert [t["width"] for t in tiles65] == [35, 30]
        assert len(pdfx.page_tiles(70, 75)) == 4
        assert len(pdfx.page_tiles(50, 60)) == 1
        print("[OK] PDF 分页算法")

        state = {
            "schemaVersion": 1,
            "savedAt": 1,
            "settings": {"targetPixels": 40000},
            "viewport": {"zoom": 1.25, "pan": {"x": 1, "y": 2}},
            "editor": {"tool": "wand", "brushColor": 2, "dirty": True, "selection": [0, 1]},
            "project": None,
            "undo": {"undoStack": [], "redoStack": []},
            "history": {"items": [], "currentId": None, "nextId": 1},
            "original": None,
        }
        s, j = req("PUT", "/api/state", state)
        assert j["ok"]
        s, j = req("GET", "/api/state")
        assert j["settings"]["targetPixels"] == 40000
        assert j["editor"]["tool"] == "wand"
        print("[OK] 状态保存与恢复")

        s, j = req("PUT", "/api/state", [1, 2, 3])
        assert s == 400 and j["error"] == "状态数据无效"
        print("[OK] 状态写入：非对象载荷返回 400")

        # 损坏的状态文件：读取应返回空态并先备份原文件
        with open(os.path.join(data_dir, "state.json"), "w", encoding="utf-8") as fh:
            fh.write("{broken json")
        s, j = req("GET", "/api/state")
        assert s == 200 and j == {}, "损坏状态文件应返回空态"
        assert os.path.exists(os.path.join(data_dir, "state.json.corrupt")), "损坏文件应被备份"
        print("[OK] 损坏状态文件：备份后返回空态")

        project_doc = {
            "schemaVersion": 1,
            "savedAt": 1,
            "viewport": {"zoom": 1.25, "pan": {"x": 1, "y": 2}},
            "settings": {
                "targetPixels": 40000,
                "useLab": True,
                "sharpen": False,
                "showCodes": True,
                "emptyStyle": "default",
                "compare": False,
                "syncPan": False,
                "brushSize": 1,
                "sameColorSelect": False,
                "wandSensitivity": 20,
            },
            "project": {
                "width": 2,
                "height": 2,
                "grid": [0, 1, 0, 1],
                "baseGrid": [0, 1, 0, 1],
                "sliderN": 2,
                "editedSinceSlider": False,
                "paletteName": "cfg",
                "palette": [{"index": 1, "code": "A", "name": "白", "hex": "#FFFFFF"}],
                "paletteHash": "0" * 64,
                "maxColors": 2,
            },
            "history": {"items": [], "currentId": None, "nextId": 1, "baselineId": None},
            "original": {"name": "测试原图.png"},
        }
        s, j = req("POST", "/api/project/save", {
            "document": project_doc,
        })
        assert j["mode"] == "download"
        assert j["filename"].startswith(datetime.now().strftime("%Y%m%d")), (
            f"默认项目文件名应以日期开头，实际 {j['filename']}"
        )
        assert "测试原图" in j["filename"], (
            f"默认项目文件名应取原图名，实际 {j['filename']}"
        )
        assert j["filename"].endswith("_拼豆图.ssfbp")
        print(f"[OK] 默认项目文件名由后端生成：{j['filename']}")
        raw = base64.b64decode(j["dataBase64"])
        assert pj.parse_project_file(raw)["state"]
        print("[OK] 项目文件生成（浏览器下载）")
        # v2 紧凑网格：前端 autosave 实际发送 gridBase64（小端 Int16Array），保存/打开都应通过
        grid_b64 = base64.b64encode(struct.pack("<4h", 0, 1, 0, 1)).decode("ascii")
        b64_doc = dict(project_doc)
        b64_doc["project"] = {**project_doc["project"], "grid": None, "gridBase64": grid_b64}
        s, j = req("POST", "/api/project/save", {"document": b64_doc})
        assert s == 200 and j["mode"] == "download", f"gridBase64 项目保存应成功，实际 {s} {j}"
        b64_raw = base64.b64decode(j["dataBase64"])
        s, j = upload_project_bytes(b64_raw)
        assert s == 200 and j["document"]["project"]["gridBase64"] == grid_b64, (
            f"gridBase64 项目文件上传打开应成功，实际 {s} {j}"
        )
        print("[OK] 项目保存/打开：gridBase64 紧凑网格")

        bad_b64_doc = dict(project_doc)
        bad_b64_doc["project"] = {**project_doc["project"], "grid": None, "gridBase64": "%%%bad%%%"}
        s, j = req("POST", "/api/project/save", {"document": bad_b64_doc})
        assert s == 400 and "网格" in j["error"], f"损坏的 gridBase64 应返回 400，实际 {j}"
        print("[OK] 项目保存：损坏的 gridBase64 返回 JSON 400")

        s, j = req("POST", "/api/project/save", {"document": {"settings": {}}})
        assert s == 400 and j["error"] == "没有可保存的项目"
        print("[OK] 项目保存缺画布返回 400")

        bad_doc = {
            "project": {"width": 2, "height": 2, "grid": [0, 1]},
        }
        s, j = req("POST", "/api/project/save", {"document": bad_doc})
        assert s == 400 and "网格" in j["error"], f"项目保存应校验网格，实际 {j}"
        print("[OK] 项目保存：网格长度不符返回 JSON 400")

        s, j = upload_project_bytes(raw)
        assert s == 200 and j["document"]["project"]["width"] == 2
        assert j["document"]["viewport"]["zoom"] == 1.25
        print("[OK] 项目文件上传打开")

        bad_doc_bytes = build_raw_project(
            [
                ("meta", pj.meta_json(), 0),
                (
                    "state",
                    json.dumps({"project": {"width": 2, "height": 2, "grid": [0, 1]}}).encode(),
                    0,
                ),
            ]
        )
        s, j = upload_project_bytes(bad_doc_bytes)
        assert s == 400 and "网格" in j["error"], f"损坏项目文档应返回 JSON 400，实际 {j}"
        print("[OK] 项目文件上传：文档级网格校验返回 JSON 400")

        s, j = upload_project_bytes(b"garbage bytes")
        assert s == 400 and "失败" in j["error"]
        print("[OK] 损坏项目文件返回 JSON 400（而非 500）")

        s, j = req("DELETE", "/api/configs/" + urllib.parse.quote(cfg_name))
        assert j["ok"]
        print("[OK] 删除配置")
        print("\n全部冒烟测试通过")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
