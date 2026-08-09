# -*- mode: python ; coding: utf-8 -*-
# 拼豆工具 EXE 打包配置（PyInstaller onefile，无控制台窗口）
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

a = Analysis(
    [os.path.join(ROOT, "app.py")],
    pathex=[ROOT],
    binaries=[],
    datas=[
        (os.path.join(ROOT, "templates"), "templates"),
        (os.path.join(ROOT, "static"), "static"),
        (os.path.join(ROOT, "bead"), "bead"),
        (os.path.join(ROOT, "assets"), "assets"),
        (os.path.join(ROOT, "data", "configs"), "data/configs"),
    ],
    hiddenimports=["waitress"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="fuse-beads-tool",
    icon=os.path.join(ROOT, "packaging", "app-icon.ico"),
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # 不显示控制台窗口，双击即用
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
