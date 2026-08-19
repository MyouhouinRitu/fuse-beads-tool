// 全局常量配置：把散落各处的魔法数字集中到这里统一命名，避免理解错误。
// 跨语言同步约束（不只靠注释约定，由 tests/constants_sync_test.mjs 强制执行）：
// - 布局参数（面板宽度、折叠宽度、动画时长、九宫格尺寸）与 static/css/style.css 保持一致；
// - 渲染参数（图例/网格线/色号/空位样式/导出默认值）与 bead/export.py 保持一致；
// - 修改任一侧后需运行该测试确认未漂移。

// ---------- 画布 / 渲染 ----------
export const APP_VERSION = '0.7.0'; // 应用版本号（与 package.json / bead/version.py 同步，见 constants_sync_test）
export const CELL = 28; // 每格拼豆在画布上的像素尺寸
export const CANVAS_EDGE_CELLS = 1; // 画布四周行列号条的格数（图案外侧 1 格）
export const OUTER_PAD = 20; // 导出时图案外侧纯白边距（像素）
export const DEFAULT_TARGET_PIXELS = 4000; // 「目标像素量」输入框默认值
export const TARGET_PIXELS_MIN = 100; // 「目标像素量」下限（与 bead/compress.py MIN_TARGET_PIXELS 一致）
export const TARGET_PIXELS_MAX = 30000; // 「目标像素量」上限（与 bead/compress.py HARD_CAP_PIXELS 一致）
export const TARGET_PIXELS_STEP = 100; // 「目标像素量」输入框步长（与模板 input step 一致）
export const TARGET_PIXEL_PRESETS = [
  {
    value: 400,
    tip: '初次尝试拼豆的儿童建议量，可以适当增加，但不建议超过500，且强烈建议使用5mm的豆并在监护人陪同下体验',
  },
  { value: 2000, tip: '初次尝试拼豆的成人推荐量，不建议超过 3000' },
  { value: 4000, tip: '有一定经验的成人推荐量，可以适当增加，但不建议超过 5500' },
  {
    value: 8000,
    tip: '8000以上的豆很可能要花2天时间，并且长/宽大于100可能不方便用烫豆机熨烫，谨慎选择',
  },
];
export const BRUSH_SIZE_MIN = 1; // 画笔 / 橡皮最小尺寸
export const BRUSH_SIZE_MAX = 10; // 画笔 / 橡皮最大尺寸（与模板中滑块 max 一致）

// ---------- 工具模式 ----------
export const TOOLS = {
  SELECT: 'select',
  BRUSH: 'brush',
  ERASER: 'eraser',
  PICKER: 'picker',
  CROP: 'crop',
  WAND: 'wand',
  MIRROR: 'mirror',
};

// ---------- 魔棒 ----------
export const WAND_SENSITIVITY_MIN = 0; // 容差最小值：只选同色
export const WAND_SENSITIVITY_MAX = 100; // 容差最大值（与模板中滑块 max 一致）
export const WAND_SENSITIVITY_DEFAULT = 20; // 默认容差

// ---------- 通用交互阈值 ----------
export const DRAG_THRESHOLD_PX = 4; // 判定为拖拽的最小位移（屏幕像素）

// ---------- 裁剪工具 ----------
export const CROP_MAGNIFIER_MIN_SCREEN_CELL = 14; // 格屏宽低于该值时启用放大镜（参考 hover 隐藏阈值）
export const CROP_MAGNIFIER_SIZE = 11; // 放大镜窗口边长（格，11×11，奇数使悬停格居中）
export const CROP_MAGNIFIER_SCALE = 2.5; // 放大镜放大倍率
export const CROP_EDGE_HIT_PX = 8; // 边缘命中阈值（屏幕像素）
export const CROP_EDGE_COLOR = '#ff3b30'; // 裁剪边框（未选中）
export const CROP_EDGE_ACTIVE_COLOR = '#3b82f6'; // 裁剪边框（选中/拖拽边）
export const CROP_MASK_RGBA = 'rgba(0, 0, 0, 0.4)'; // 裁剪模式工作区蒙版（与 style.css --crop-mask-rgba 一致）
export const CROP_MAGNIFIER_MIN_CELL = 16; // 放大镜每格最小尺寸（像素）
export const CROP_MAGNIFIER_GAP = 16; // 放大镜与鼠标的间距（像素）
export const CROP_MAGNIFIER_WINDOW_MARGIN = 8; // 放大镜与窗口边缘的最小间距（像素）
export const CROP_MAGNIFIER_OUTSIDE = { light: '#e8eaee', dark: '#3a424c' }; // 放大镜图案外底色（日/夜）

// ---------- 网格细节缩放阈值（格屏宽 = 格尺寸 × 缩放） ----------
export const GRID_FINE_MIN_SCREEN_CELL = 8; // 低于该值时隐藏格内细线与色号
export const GRID_THICK_MIN_SCREEN_CELL = 4; // 低于该值时隐藏每 5/10 格粗虚线/实线

export const SCREEN_CELL_MIN = 2; // 超大图案自动缩小格时的最小格尺寸
export const SCREEN_CELL_MAX_DIM = 28000; // 画布允许的最大边长（像素）
export const SCREEN_CELL_MAX_AREA = 30000000; // 画布允许的最大面积（像素²，与 3 万格上限配套，防止极端长宽比下内存失控）
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
export const FIT_ZOOM_CAP = 1.5; // 「适应窗口」的最大缩放
export const VIEWPORT_PADDING = 24; // 适应窗口时四周预留的像素
export const ZOOM_WHEEL_FACTOR = 1.15; // 滚轮缩放倍率
export const ZOOM_BUTTON_FACTOR = 1.25; // +/- 按钮缩放倍率

// ---------- 颜色明暗判断 ----------
export const LUMINANCE_THRESHOLD = 150; // 感知亮度阈值：≥ 该值视为亮色

// ---------- 颜色清单高亮 ----------
export const HIGHLIGHT_STROKE_RATIO = 0.14; // 描边宽 = 格尺寸 × 该比例
export const HIGHLIGHT_MIN_SCREEN_STROKE = 2.5; // 描边至少的屏幕像素
export const HIGHLIGHT_FRAME_DARK = 0.95; // 暗色格子的浅色描边透明度
export const HIGHLIGHT_FRAME_LIGHT = 0.9; // 亮色格子的深色描边透明度

// ---------- 鼠标指向像素高亮（hover 边框） ----------
export const HOVER_MIN_SCREEN_CELL = 7; // 格子屏幕尺寸（格尺寸 × 缩放）低于该值时隐藏 hover 边框
export const HOVER_STROKE_RATIO = 0.03; // 边框线宽 = 格尺寸 × 该比例（默认格约 1px，随缩放等比变化）
export const HOVER_BRUSH_STROKE_RATIO = 0.12; // 画笔模式当前颜色边框线宽 = 格尺寸 × 该比例（默认格约 3px）
export const HOVER_DASH_RATIO = 0.22; // 选择模式虚线每段长度 = 格尺寸 × 该比例（默认格约 6px）
export const HOVER_DASH_MIN = 3; // 虚线每段最小长度（画布像素）

// ---------- 选区显示（虚线外轮廓，缩小时保持可读） ----------
export const SELECTION_MIN_SCREEN_STROKE = 2; // 选区线宽至少的屏幕像素
export const SELECTION_MIN_SCREEN_DASH = 4; // 选区虚线段至少的屏幕像素

// ---------- 3D 凸起效果（取色/画笔/九宫格目标格） ----------
export const RAISED_SHADOW_ALPHA = 0.35; // 右下投影透明度
export const RAISED_BEVEL_LIGHT_ALPHA = 0.85; // 上/左高光斜面透明度
export const RAISED_BEVEL_DARK_ALPHA = 0.45; // 下/右暗斜面透明度
export const RAISED_GLOSS_ALPHA = 0.45; // 左上高光点透明度

// ---------- 边缘行列号 ----------
export const EDGE_NUMBER_MIN_CELL = 8; // 格尺寸小于该值时隐藏边缘行列号
export const EDGE_NUMBER_FONT_RATIO = 0.5; // 行列号字号 = 格尺寸 × 该比例
export const EDGE_NUMBER_BG = '#D6E6F7'; // 行列号格底色（浅蓝）

// ---------- 对比原图 ----------
export const ORIG_MAX_DIM = 2000; // 原图画布最大边长，超出按比例降采样

// ---------- D 键九宫格 ----------
export const QUICK_PICKER_MAX = 9; // 九宫格候选颜色数量上限
export const QUICK_PICKER_COLS = 3; // 九宫格按钮列数（与 CSS #quick-picker 一致）
export const QUICK_PICKER_CELL = 54; // 九宫格按钮格宽（与 CSS #quick-picker 一致）
export const QUICK_PICKER_PAD = 22; // 九宫格弹出框横向额外留白
export const QUICK_PICKER_HEIGHT = 250; // 九宫格弹出框预估高度（用于定位防溢出）
export const QUICK_PICKER_EDGE_MARGIN = 8; // 九宫格与窗口边缘的最小间距
export const QUICK_PICKER_OFFSET_CELLS = 1.5; // 九宫格相对像素的纵向偏移（格）

// ---------- 导出 ----------
export const EXPORT_CELL_MIN = 5;
export const EXPORT_CELL_MAX = 100;
export const EXPORT_CELL_DEFAULT = 28; // 导出「每格大小」输入为空的默认值
export const EXPORT_PAD_MAX = 200;
export const EXPORT_PREVIEW_CELL = 8; // 导出预览的格子像素
export const EXPORT_PREVIEW_MAX_W = 290; // 预览画布最大宽
export const EXPORT_PREVIEW_MAX_H = 250; // 预览画布最大高
export const EXPORT_QUALITY = 95; // 导出 JPG 默认质量（与 bead/export.py DEFAULT_QUALITY 一致）
export const EXPORT_COMPLETE_DELAY_MS = 900; // 导出完成后停留显示时长

// ---------- 渲染参数（与 bead/export.py 保持一致，由 constants_sync_test 增强约束） ----------
// 图例布局
export const LEGEND_ENTRY_W = 7.0; // 图例每项预估宽度（以格为单位），用于分行的保守估算
export const LEGEND_PAD_RATIO = 0.9; // 图例左右留白（格）
export const LEGEND_BOTTOM_GAP_RATIO = 0.6; // 图例下方留白（格）
export const LEGEND_TOP_OFFSET_RATIO = 0.6; // 图例起始纵偏移（格）
export const LEGEND_FONT_RATIO = 0.9; // 图例字体大小（格）
export const LEGEND_FONT_MIN = 12; // 图例字号下限（PIL 侧共用 FONT_MIN=8，见 sync 测试例外表）
export const LEGEND_SWATCH_RATIO = 1.1; // 图例色块大小（格）
export const LEGEND_SWATCH_MIN = 8; // 图例色块下限
export const LEGEND_ROW_EXTRA_H = 10; // 图例行高在色块外追加的高度
export const LEGEND_ROW_FONT_EXTRA = 20; // 图例行高在字体外追加的高度
export const LEGEND_TEXT_GAP = 8; // 色块与文字间距
export const LEGEND_SWATCH_BORDER = '#999999';
export const LEGEND_TEXT_COLOR = '#333333';

// ---------- 导出底部署名（图案与图例之间、右侧对齐；与 bead/export.py ATTRIBUTION_* 对应） ----------
export const ATTRIBUTION_TEXT = '由 解音知弦 (SoulString) 研发的拼豆工具生成';
export const ATTRIBUTION_FONT_RATIO = 0.7; // 署名字号 = 格尺寸 × 该比例（下限见 ATTRIBUTION_FONT_MIN）
export const ATTRIBUTION_FONT_MIN = 11; // 署名字号下限
export const ATTRIBUTION_TOP_GAP_RATIO = 0.4; // 署名上方间距（格）
export const ATTRIBUTION_BOTTOM_GAP_RATIO = 0.4; // 署名下方间距（格）
export const ATTRIBUTION_TEXT_COLOR = '#8A8A8A'; // 署名文字颜色（弱化的小字）
// 网格线
export const GRID_LINE_THIN_RATIO = 0.04; // 细网格线宽（格）
export const GRID_LINE_THICK_RATIO = 0.1; // 每 5 格加粗线宽（格）
export const GRID_DASH_RATIO = 0.5; // 每 5 格虚线每段长度（格）
export const GRID_LINE_COLOR = '#9A9A9A'; // 格内灰色网格线
export const GRID_BOUNDARY_COLOR = '#000000'; // 图片边缘粗黑线
// 格内色号
export const CODE_MIN_CELL = 8; // 格尺寸小于该值时不在格内显示色号
export const CODE_FONT_RATIO = 0.4; // 格内色号字号（格）
export const CODE_FONT_MIN = 8; // 格内色号字号下限
// 空位格（橡皮擦除后）使用同一底色与斜线
export const EMPTY_STYLES = {
  default: { bg: '#ECECEC', line: '#C8C8C8' },
  black: { bg: '#000000', line: '#C8C8C8' },
  white: { bg: '#FFFFFF', line: '#C8C8C8' },
};

// ---------- 定时 / 节流（毫秒） ----------
export const TOAST_DURATION_MS = 2600;
export const HINT_THROTTLE_MS = 3000;
export const AUTOSAVE_DELAY_MS = 800;
export const SLIDER_APPLY_DELAY_MS = 150; // 颜色数量滑块输入防抖：拖动停顿后再重算
export const CONFIG_SAVE_DELAY_MS = 500;
export const HIGHLIGHT_BLINK_MS = 500;
export const PANEL_ANIMATION_MS = 180; // 侧边栏宽度过渡时长（与 CSS 一致）

// ---------- 侧边栏折叠 ----------
export const PANEL_COLLAPSED_WIDTH = 32; // 收起后的窄条宽度（与 CSS 一致）
export const PANEL_FULL_WIDTH = {
  // 展开宽度（与 CSS 中 aside 宽度一致）
  'left-panel': 320,
  'color-highlight-panel': 168,
  'right-panel': 280,
};
export const PANEL_IDS = ['left-panel', 'color-highlight-panel', 'right-panel'];
export const PANEL_STORAGE_KEY = 'fuse-beads.panel-collapsed';

// ---------- 主题 ----------
export const THEME_STORAGE_KEY = 'fuse-theme';
