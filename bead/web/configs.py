"""调色板配置管理路由与目录缓存。"""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request, send_file

from bead import palette as pal
from bead.web.common import (
    DEFAULT_CONFIG_NAME,
    BeadConfig,
    cfg,
    config_path,
    config_stem,
    err,
    safe_name,
)

configs_bp = Blueprint("configs", __name__)

_configs_cache: dict[str, tuple[object, list[dict[str, object]]]] = {}


def list_configs(config: BeadConfig) -> list[dict[str, object]]:
    """配置列表：按目录内容（文件名/修改时间/大小）缓存，避免每次请求重读全部 CSV。"""
    key = (config.data_dir, _configs_cache_signature(config))
    cached = _configs_cache.get(config.data_dir)
    if cached is not None and cached[0] == key:
        return list(cached[1])

    names: list[dict[str, object]] = []
    for fn in sorted(os.listdir(config.config_dir)):
        if not fn.lower().endswith(".csv"):
            continue
        path = os.path.join(config.config_dir, fn)
        try:
            colors = pal.read_csv(path)
        except Exception:
            continue
        names.append(
            {
                "name": fn[:-4],
                "colorCount": len(colors),
                "updatedAt": os.path.getmtime(path),
                "paletteHash": pal.palette_hash(colors),
            }
        )
    names.sort(key=lambda c: (c["name"] != DEFAULT_CONFIG_NAME, c["name"]))
    _configs_cache[config.data_dir] = (key, names)
    return names


def _configs_cache_signature(config: BeadConfig) -> tuple[tuple[str, int, int], ...] | None:
    try:
        with os.scandir(config.config_dir) as it:
            entries = []
            for de in it:
                if not de.name.lower().endswith(".csv") or not de.is_file():
                    continue
                st = de.stat()
                entries.append((de.name, st.st_mtime_ns, st.st_size))
    except OSError:
        return None
    return tuple(sorted(entries))


def _invalidate_configs_cache(config: BeadConfig | None = None) -> None:
    """配置列表缓存失效：指定应用清对应目录，未指定时全部清空。"""
    if config is None:
        _configs_cache.clear()
    else:
        _configs_cache.pop(config.data_dir, None)


def ensure_default_config(config: BeadConfig) -> None:
    """首次启动生成内置色板：模板的权威定义在 bead/palette.py（代码），不依赖仓库文件。"""
    names = [c["name"] for c in list_configs(config)]
    if not names:
        pal.write_csv(os.path.join(config.config_dir, "default_48.csv"), pal.DEFAULT_PALETTE)
        pal.write_csv(
            os.path.join(config.config_dir, f"{DEFAULT_CONFIG_NAME}.csv"),
            pal.read_csv_text(pal.MARD_221_PALETTE_CSV),
        )
        _invalidate_configs_cache(config)
    elif DEFAULT_CONFIG_NAME not in names:
        pal.write_csv(
            os.path.join(config.config_dir, f"{DEFAULT_CONFIG_NAME}.csv"),
            pal.read_csv_text(pal.MARD_221_PALETTE_CSV),
        )
        _invalidate_configs_cache(config)


@configs_bp.get("/api/configs")
def api_configs():
    return jsonify({"configs": list_configs(cfg())})


@configs_bp.get("/api/configs/<name>")
def api_config_get(name: str):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    return jsonify({"name": config_stem(name), "colors": pal.read_csv(path)})


@configs_bp.post("/api/configs")
def api_config_create():
    data = request.get_json(force=True)
    name = config_stem(data.get("name", ""))
    path = config_path(name)
    if os.path.exists(path):
        return err(f"配置「{name}」已存在")
    colors = pal.normalize_colors(data.get("colors", []))
    if not colors:
        return err("颜色列表不能为空")
    pal.write_csv(path, colors)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True, "name": name, "colors": colors})


@configs_bp.put("/api/configs/<name>")
def api_config_update(name: str):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    data = request.get_json(force=True)
    colors = pal.normalize_colors(data.get("colors", []))
    if not colors:
        return err("颜色列表不能为空")
    pal.write_csv(path, colors)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True})


@configs_bp.post("/api/configs/<name>/rename")
def api_config_rename(name: str):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    new_name = config_stem(request.get_json(force=True).get("newName", ""))
    new_path = config_path(new_name)
    if new_path == path:
        return jsonify({"ok": True, "name": new_name})
    if os.path.exists(new_path):
        return err(f"配置「{new_name}」已存在")
    os.replace(path, new_path)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True, "name": new_name})


@configs_bp.delete("/api/configs/<name>")
def api_config_delete(name: str):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    try:
        os.remove(path)
    except OSError:
        return err("删除配置失败", 500)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True})


@configs_bp.post("/api/configs/import")
def api_config_import():
    f = request.files.get("file")
    if not f:
        return err("未收到文件")
    text = f.read().decode("utf-8-sig", errors="replace")
    colors = pal.read_csv_text(text)
    if not colors:
        return err("CSV 中没有找到有效的颜色列（需要包含「编号、色号、名称、颜色」或英文表头）")
    stem = request.form.get("name") or os.path.splitext(f.filename or "配置")[0]
    name = safe_name(stem)
    path = config_path(name)
    suffix = 2
    while os.path.exists(path):
        path = config_path(f"{name} ({suffix})")
        suffix += 1
    pal.write_csv(path, colors)
    _invalidate_configs_cache(cfg())
    return jsonify({"ok": True, "name": os.path.splitext(os.path.basename(path))[0], "colors": colors})


@configs_bp.get("/api/configs/<name>/export")
def api_config_export(name: str):
    path = config_path(name)
    if not os.path.exists(path):
        return err("配置不存在", 404)
    return send_file(
        path,
        mimetype="text/csv; charset=utf-8",
        as_attachment=True,
        download_name=f"{config_stem(name)}.csv",
    )
