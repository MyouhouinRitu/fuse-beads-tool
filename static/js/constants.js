// 全局常量配置：把散落各处的魔法数字集中到这里统一命名，避免理解错误。
// 注意：部分数值与 static/css/style.css 的样式保持一致（如侧边栏宽度、工具栏高度），
// 改动时需要同步更新。

// ---------- 画布 / 渲染 ----------
export const CELL = 26;                       // 每格拼豆在画布上的像素尺寸
export const GRID_MARGIN_CELLS = 5;           // 图案外侧灰色 × 边距格数
export const OUTER_PAD = 20;                  // 导出时图案外侧纯白边距（像素）
export const DEFAULT_TARGET_PIXELS = 40000;   // 「目标像素量」输入框默认值
export const SCREEN_CELL_MIN = 2;             // 超大图案自动缩小格时的最小格尺寸
export const SCREEN_CELL_MAX_DIM = 28000;     // 画布允许的最大边长（像素）
export const SCREEN_CELL_MAX_AREA = 80000000; // 画布允许的最大面积（像素²）
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
export const FIT_ZOOM_CAP = 1.5;              // 「适应窗口」的最大缩放
export const VIEWPORT_PADDING = 24;           // 适应窗口时四周预留的像素
export const ZOOM_WHEEL_FACTOR = 1.15;        // 滚轮缩放倍率
export const ZOOM_BUTTON_FACTOR = 1.25;       // +/− 按钮缩放倍率

// ---------- 颜色明暗判断 ----------
export const LUMINANCE_THRESHOLD = 150;       // 感知亮度阈值：≥ 该值视为亮色

// ---------- 颜色清单高亮 ----------
export const HIGHLIGHT_STROKE_RATIO = 0.14;       // 描边宽 = 格尺寸 × 该比例
export const HIGHLIGHT_MIN_SCREEN_STROKE = 2.5;   // 描边至少的屏幕像素
export const HIGHLIGHT_WASH_DARK = 0.36;          // 暗色格子叠白色覆盖层的透明度
export const HIGHLIGHT_WASH_LIGHT = 0.30;         // 亮色格子叠黑色覆盖层的透明度
export const HIGHLIGHT_FRAME_DARK = 0.95;         // 暗色格子的浅色描边透明度
export const HIGHLIGHT_FRAME_LIGHT = 0.90;        // 亮色格子的深色描边透明度

// ---------- 像素选中（拖拽模式单击高亮） ----------
export const SELECTION_COLOR = '#1976D2';
export const SELECTION_STROKE_MIN = 3;
export const SELECTION_STROKE_RATIO = 0.15;

// ---------- 鼠标指向像素高亮（hover 边框） ----------
export const HOVER_MIN_SCREEN_CELL = 7;        // 格子屏幕尺寸（格尺寸 × 缩放）低于该值时隐藏 hover 边框
export const HOVER_STROKE_RATIO = 0.03;        // 边框线宽 = 格尺寸 × 该比例（默认格约 1px，随缩放等比变化）
export const HOVER_DASH_RATIO = 0.22;          // 拖拽模式虚线每段长度 = 格尺寸 × 该比例（默认格约 6px）
export const HOVER_DASH_MIN = 3;               // 虚线每段最小长度（画布像素）

// ---------- 对比原图 ----------
export const ORIG_MAX_DIM = 2000;             // 原图画布最大边长，超出按比例降采样

// ---------- D 键九宫格 ----------
export const QUICK_PICKER_MAX = 9;            // 九宫格候选颜色数量上限
export const QUICK_PICKER_COLS = 3;           // 九宫格按钮列数（与 CSS #quick-picker 一致）
export const QUICK_PICKER_CELL = 54;          // 九宫格按钮格宽（与 CSS #quick-picker 一致）
export const QUICK_PICKER_PAD = 22;           // 九宫格弹出框横向额外留白
export const QUICK_PICKER_HEIGHT = 250;       // 九宫格弹出框预估高度（用于定位防溢出）
export const QUICK_PICKER_EDGE_MARGIN = 8;    // 九宫格与窗口边缘的最小间距
export const QUICK_PICKER_OFFSET_CELLS = 1.5; // 九宫格相对像素的纵向偏移（格）

// ---------- 导出预览 ----------
export const EXPORT_CELL_MIN = 5;
export const EXPORT_CELL_MAX = 100;
export const EXPORT_CELL_DEFAULT = 20;        // 导出「每格大小」输入为空时的默认值
export const EXPORT_PAD_MAX = 200;
export const EXPORT_PREVIEW_CELL = 8;         // 导出预览的格子像素
export const EXPORT_PREVIEW_MAX_W = 290;      // 预览画布最大宽
export const EXPORT_PREVIEW_MAX_H = 250;      // 预览画布最大高

// ---------- 定时 / 节流（毫秒） ----------
export const TOAST_DURATION_MS = 2600;
export const HINT_THROTTLE_MS = 3000;
export const AUTOSAVE_DELAY_MS = 800;
export const CONFIG_SAVE_DELAY_MS = 500;
export const HIGHLIGHT_BLINK_MS = 500;
export const PANEL_ANIMATION_MS = 180;        // 侧边栏宽度过渡时长（与 CSS 一致）

// ---------- 侧边栏折叠 ----------
export const PANEL_COLLAPSED_WIDTH = 32;      // 收起后的窄条宽度（与 CSS 一致）
export const PANEL_FULL_WIDTH = {             // 展开宽度（与 CSS 中 aside 宽度一致）
  'left-panel': 320,
  'color-highlight-panel': 168,
  'right-panel': 280,
};
export const PANEL_IDS = ['left-panel', 'color-highlight-panel', 'right-panel'];
export const PANEL_STORAGE_KEY = 'fuse-beads.panel-collapsed';
