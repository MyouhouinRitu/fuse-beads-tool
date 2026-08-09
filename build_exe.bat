@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 安装依赖（含 PyInstaller）...
python -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto :err

echo 生成应用图标...
python packaging\make_icon.py
if errorlevel 1 goto :err

echo 开始打包 EXE...
python -m PyInstaller packaging\fuse_beads.spec --noconfirm --clean --distpath dist --workpath build
if errorlevel 1 goto :err

echo.
echo 打包完成：dist\fuse-beads-tool.exe
echo 双击 exe 后右下角出现托盘图标（双击图标打开网页，右键退出），数据保存在 exe 同级的 data 目录。
echo 如需更换图标，替换 assets\app-icon.png 后重新打包即可。
pause
exit /b 0

:err
echo 打包失败，请检查上方错误信息。
pause
exit /b 1