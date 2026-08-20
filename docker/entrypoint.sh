#!/bin/sh
# 拼豆工具容器启动脚本
set -e

cd /app

# 准备数据目录（挂载卷可能为空或由 Docker 自动创建）
mkdir -p data/configs

# Docker 在挂载缺失文件时会创建目录占位，需要清理
if [ -d data/state.json ]; then
  rm -rf data/state.json
fi

# 确保数据目录可写（NAS 挂载场景）
chmod -R a+rwX data

# 按 PUID/PGID 降权运行（默认 1000:1000）
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid "$PUID" --regid "$PGID" --clear-groups python app.py
fi

exec python app.py
