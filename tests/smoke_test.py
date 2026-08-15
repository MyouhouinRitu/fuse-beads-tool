"""冒烟测试：启动 Flask 服务并验证核心接口。"""

import base64
import io
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse

from PIL import Image, ImageDraw

BASE = "http://127.0.0.1:5001"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from bead import project_file as pj
from bead import pdf_export as pdfx


def req(method, path, data=None, raw=False):
    headers = {}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=30) as resp:
        if raw:
            return resp.status, resp.read()
        return resp.status, json.loads(resp.read().decode())


def upload(path, target_pixels, sharpen, original_id=None):
    content = b""
    if path:
        with open(path, "rb") as fh:
            content = fh.read()
    boundary = "----smoke-boundary"
    parts = []
    for name, value in (("targetPixels", str(target_pixels)), ("sharpen", "1" if sharpen else "0")):
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
    with urllib.request.urlopen(r, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode())


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
    with urllib.request.urlopen(r, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode())


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


def make_transparent_image(path):
    img = Image.new("RGBA", (800, 600), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([100, 100, 700, 500], fill=(255, 0, 0, 255))
    img.save(path, "PNG")


def main():
    # 用临时数据目录启动，避免测试状态写入真实 data/（如 state.json）
    data_dir = tempfile.mkdtemp(prefix="fuse_smoke_data_")
    env = {**os.environ, "DATA_DIR": data_dir}
    proc = subprocess.Popen(
        [sys.executable, "app.py", "--port", "5001"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
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

        s, j = req("GET", "/api/configs")
        assert s == 200 and j["configs"], "配置列表为空"
        first = j["configs"][0]
        assert first["paletteHash"] and len(first["paletteHash"]) == 64
        print(f"[OK] 配置列表：{first['name']}（{first['colorCount']}色）")

        s, j = req("GET", "/api/configs/" + urllib.parse.quote(first["name"]))
        assert s == 200 and len(j["colors"]) == first["colorCount"]
        print("[OK] 读取配置详情")

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

        s, raw = req("GET", "/api/configs/" + urllib.parse.quote(cfg_name) + "/export", raw=True)
        assert b"\xff\x00\x00" in raw.upper() or b"FF0000" in raw.upper()
        print("[OK] 导出 CSV")

        tmp = tempfile.mkdtemp(prefix="fuse_smoke_")
        img_path = os.path.join(tmp, "test.png")
        make_test_image(img_path)
        s, j = upload(img_path, 40000, True)
        assert s == 200 and j["width"] * j["height"] <= 40000
        print(f"[OK] 图片压缩：{j['width']} × {j['height']}")
        original_id = j["originalId"]
        assert original_id
        s, raw = req("GET", "/api/originals/" + original_id, raw=True)
        assert s == 200 and raw
        print("[OK] 原图落盘与读取")
        s, j = upload(None, 30000, False, original_id=original_id)
        assert s == 200 and j["originalId"] == original_id
        print("[OK] 按原图引用重新压缩")

        transp_path = os.path.join(tmp, "transparent.png")
        make_transparent_image(transp_path)
        s, j = upload(transp_path, 40000, False)
        assert s == 200
        timg = Image.open(io.BytesIO(base64.b64decode(j["pngBase64"])))
        assert timg.mode == "RGBA", "透明 PNG 应保留 alpha 通道"
        alpha = timg.getchannel("A")
        assert alpha.getextrema() == (0, 255), "返回图像应同时包含透明与不透明像素"
        opaque = sum(1 for v in alpha.getdata() if v >= 128)
        assert abs(opaque - 40000) <= 8000, (
            f"透明图压缩后非空豆量应接近目标 40000，实际 {opaque}"
        )
        print("[OK] 透明 PNG 保留 alpha")

        grid = [-1] * (j["width"] * j["height"])
        palette = [{"index": 0, "hex": "#FF0000"}, {"index": 1, "hex": "#0000FF"}]
        s, j = req("POST", "/api/export", {
            "width": j["width"],
            "height": j["height"],
            "grid": grid,
            "palette": palette,
            "options": {"cellSize": 8, "gridLines": True, "margins": True, "format": "jpg"},
        })
        assert j["dataUrl"].startswith("data:image/jpeg;base64,")
        print("[OK] 导出 JPG")

        for pdf_fmt in ("pdf-a4", "pdf-multi-a4", "pdf-a3-a4"):
            s, j = req("POST", "/api/export", {
                "width": 70,
                "height": 75,
                "grid": [0] * (70 * 75),
                "palette": [{"index": 0, "hex": "#FF0000"}],
                "legend": [{"hex": "#FF0000", "code": "R", "count": 5250}],
                "options": {"cellSize": 8, "gridLines": True, "edgeNumbers": True,
                            "showCodes": True, "legend": True, "format": pdf_fmt},
            })
            assert j["dataUrl"].startswith("data:application/pdf;base64,")
            raw_pdf = base64.b64decode(j["dataUrl"].split(",", 1)[1])
            assert raw_pdf[:4] == b"%PDF"
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
            "original": None,
        }
        s, j = req("POST", "/api/project/save", {
            "document": project_doc,
            "filename": "测试.ssfbp",
        })
        assert j["mode"] == "download"
        raw = base64.b64decode(j["dataBase64"])
        assert pj.parse_project_file(raw)["state"]
        print("[OK] 项目文件生成（浏览器下载）")

        s, j = upload_project_bytes(raw)
        assert s == 200 and j["document"]["project"]["width"] == 2
        assert j["document"]["viewport"]["zoom"] == 1.25
        print("[OK] 项目文件上传打开")

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
