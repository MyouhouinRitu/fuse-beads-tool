FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=5000 \
    USE_WAITRESS=1 \
    NO_BROWSER=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 数据目录与启动脚本权限（NAS 常见权限问题在此解决）
RUN mkdir -p /app/data/configs && chmod -R a+rX /app

EXPOSE 5000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
