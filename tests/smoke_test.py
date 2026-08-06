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


def upload(path, target_pixels, sharpen):
    with open(path, "rb") as fh:
        content = fh.read()
    boundary = "----smoke-boundary"
    parts = []
    for name, value in (("targetPixels", str(target_pixels)), ("sharpen", "1" if sharpen else "0")):
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        )
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
    proc = subprocess.Popen(
        [sys.executable, "app.py", "--port", "5001"],
        cwd=ROOT,
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

        transp_path = os.path.join(tmp, "transparent.png")
        make_transparent_image(transp_path)
        s, j = upload(transp_path, 40000, False)
        assert s == 200
        timg = Image.open(io.BytesIO(base64.b64decode(j["pngBase64"])))
        assert timg.mode == "RGBA", "透明 PNG 应保留 alpha 通道"
        alpha = timg.getchannel("A")
        assert alpha.getextrema() == (0, 255), "返回图像应同时包含透明与不透明像素"
        print("[OK] 透明 PNG 保留 alpha")

        grid = [-1] * (j["width"] * j["height"])
        palette = [{"index": 0, "hex": "#FF0000"}, {"index": 1, "hex": "#0000FF"}]
        s, j = req("POST", "/api/export", {
            "width": j["width"],
            "height": j["height"],
            "grid": grid,
            "palette": palette,
            "options": {"cellSize": 8, "gridLines": True, "margins": True, "outline": True, "format": "jpg"},
        })
        assert j["dataUrl"].startswith("data:image/jpeg;base64,")
        print("[OK] 导出 JPG")

        state = {"settings": {"targetPixels": 40000}, "project": None, "tree": {"nodes": {}, "rootId": None, "currentId": None, "nextId": 1}}
        s, j = req("PUT", "/api/state", state)
        assert j["ok"]
        s, j = req("GET", "/api/state")
        assert j["settings"]["targetPixels"] == 40000
        print("[OK] 状态保存与恢复")

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
