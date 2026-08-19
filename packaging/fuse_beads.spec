# -*- mode: python ; coding: utf-8 -*-
# 拼豆工具 EXE 打包配置（PyInstaller onefile，无控制台窗口）
import os
import re

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

# 版本号与 bead/version.py 保持一致，并生成 EXE 文件属性（版本 / 产品名 / 版权）
_ver_match = re.search(
    r'APP_VERSION = "([^"]+)"',
    open(os.path.join(ROOT, "bead", "version.py"), encoding="utf-8").read(),
)
APP_VERSION = _ver_match.group(1) if _ver_match else "0.0.0"
_ver_parts = [int(x) for x in APP_VERSION.split(".")] + [0, 0, 0, 0]
_filevers = tuple(_ver_parts[:4])

VERSION_INFO = os.path.join(ROOT, "build", "version_info.txt")
os.makedirs(os.path.dirname(VERSION_INFO), exist_ok=True)
with open(VERSION_INFO, "w", encoding="utf-8") as f:
    f.write(f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={_filevers!r},
    prodvers={_filevers!r},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          '080404b0',
          [
            StringStruct('CompanyName', 'SoulString-Dev'),
            StringStruct('FileDescription', '拼豆工具（fuse-beads-tool）'),
            StringStruct('FileVersion', '{APP_VERSION}'),
            StringStruct('InternalName', 'fuse-beads-tool'),
            StringStruct('LegalCopyright', '© 2026 SoulString-Dev (解音知弦)'),
            StringStruct('OriginalFilename', 'fuse-beads-tool.exe'),
            StringStruct('ProductName', '拼豆工具'),
            StringStruct('ProductVersion', '{APP_VERSION}')
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct('Translation', [2052, 1200])])
  ]
)
""")

a = Analysis(
    [os.path.join(ROOT, "app.py")],
    pathex=[ROOT],
    binaries=[],
    datas=[
        (os.path.join(ROOT, "templates"), "templates"),
        (os.path.join(ROOT, "static"), "static"),
        (os.path.join(ROOT, "bead"), "bead"),
        (os.path.join(ROOT, "assets"), "assets"),
        (os.path.join(ROOT, "LICENSE"), "."),
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
    version=VERSION_INFO,
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
