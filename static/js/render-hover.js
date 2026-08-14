// hover 边框：按工具模式绘制指向格的边框 / 3D 凸起 / 画笔橡皮矩形。

import { isLightColor, rgbFromPacked } from './colors.js';
import {
  HIGHLIGHT_FRAME_DARK,
  HIGHLIGHT_FRAME_LIGHT,
  HOVER_BRUSH_STROKE_RATIO,
  HOVER_DASH_MIN,
  HOVER_DASH_RATIO,
  HOVER_MIN_SCREEN_CELL,
  HOVER_STROKE_RATIO,
  RAISED_BEVEL_DARK_ALPHA,
  RAISED_BEVEL_LIGHT_ALPHA,
  RAISED_GLOSS_ALPHA,
  RAISED_SHADOW_ALPHA,
  TOOLS,
} from './constants.js';

// 右下角投影（L 形细线），用于 3D 凸起 / 画笔悬停
function drawDropShadow(ctx, bx0, by0, bw, bh) {
  ctx.strokeStyle = `rgba(0, 0, 0, ${RAISED_SHADOW_ALPHA})`;
  ctx.beginPath();
  ctx.moveTo(bx0 + bw + 0.5, by0 + 1.5);
  ctx.lineTo(bx0 + bw + 0.5, by0 + bh + 0.5);
  ctx.lineTo(bx0 + 1.5, by0 + bh + 0.5);
  ctx.stroke();
}

// 3D 凸起矩形：右下投影 + 上左高光斜面 + 下右暗斜面 + 左上高光点（取色 / 画笔共用）
export function drawRaisedRect(ctx, bx0, by0, bw, bh, hlw, gloss) {
  ctx.save();
  ctx.lineWidth = hlw;
  // 投影（落在矩形右下外侧）
  drawDropShadow(ctx, bx0, by0, bw, bh);
  // 高光斜面：上 / 左
  ctx.strokeStyle = `rgba(255, 255, 255, ${RAISED_BEVEL_LIGHT_ALPHA})`;
  ctx.beginPath();
  ctx.moveTo(bx0 + 0.5, by0 + 0.5);
  ctx.lineTo(bx0 + bw - 0.5, by0 + 0.5);
  ctx.moveTo(bx0 + 0.5, by0 + 0.5);
  ctx.lineTo(bx0 + 0.5, by0 + bh - 0.5);
  ctx.stroke();
  // 暗斜面：下 / 右
  ctx.strokeStyle = `rgba(0, 0, 0, ${RAISED_BEVEL_DARK_ALPHA})`;
  ctx.beginPath();
  ctx.moveTo(bx0 + 0.5, by0 + bh - 0.5);
  ctx.lineTo(bx0 + bw - 0.5, by0 + bh - 0.5);
  ctx.moveTo(bx0 + bw - 0.5, by0 + 0.5);
  ctx.lineTo(bx0 + bw - 0.5, by0 + bh - 0.5);
  ctx.stroke();
  // 左上角高光点（矩形足够大时才画）
  if (gloss) {
    ctx.fillStyle = `rgba(255, 255, 255, ${RAISED_GLOSS_ALPHA})`;
    ctx.beginPath();
    ctx.ellipse(bx0 + 5, by0 + 5, 2, 1.5, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 鼠标指向像素的 hover 边框：按工具模式区分样式
// - select ：黑白相间虚线
// - brush ：每格颜色边框 + 黑色外框 + 阴影，按画笔尺寸显示矩形区域
// - picker：3D 凸起（把格子“吸起来”）
// - eraser：亮度自适应边框 + 对角 X，按尺寸显示矩形区域
// 画笔/橡皮悬停矩形的几何：边长 = 2×size−1 格，以目标格为中心
function brushRect(originX, originY, cell, hover, size) {
  const r = size - 1;
  const bx0 = originX + (hover.x - r) * cell;
  const by0 = originY + (hover.y - r) * cell;
  const side = (2 * r + 1) * cell;
  return { bx0, by0, bw: side, bh: side, r };
}

// 只渲染在图案区域内，不覆盖四周行列号条
function clipToPattern(ctx, originX, originY, width, height, cell) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(originX, originY, width * cell, height * cell);
  ctx.clip();
}

export function drawHover(ctx, state) {
  const {
    hover,
    tool,
    brushRgb,
    brushSize,
    width,
    height,
    displayIdx,
    displayRgb,
    originX,
    originY,
    cell,
    zoom,
  } = state;
  if (!hover || !tool || cell * zoom < HOVER_MIN_SCREEN_CELL) return;
  const p = hover.y * width + hover.x;
  if (p < 0 || p >= width * height) return;
  // 取色只作用于非空位（橡皮按矩形区域判断，见 eraser 分支）
  if (tool === TOOLS.PICKER && displayIdx[p] < 0) return;
  if (tool === TOOLS.BRUSH && !brushRgb) return;
  const size = brushSize || 1;

  const x0 = originX + hover.x * cell;
  const y0 = originY + hover.y * cell;
  // 画布线宽只随格尺寸等比变化，屏幕上的粗细由 CSS 缩放呈现，
  // 这样缩放时边框会跟着格子一起变粗/变细，直到低于隐藏阈值
  const hlw = Math.max(1, Math.round(cell * HOVER_STROKE_RATIO));
  const inset = hlw / 2;

  if (tool === TOOLS.SELECT || tool === TOOLS.WAND) {
    // 选择模式 / 魔棒：双色错位虚线，黑先画，白偏移半个虚线周期后叠加，形成相间效果
    const dash = Math.max(HOVER_DASH_MIN, Math.round(cell * HOVER_DASH_RATIO));
    ctx.save();
    ctx.lineWidth = hlw;
    ctx.setLineDash([dash, dash]);
    ctx.strokeStyle = '#000000';
    ctx.lineDashOffset = 0;
    ctx.strokeRect(x0 + inset, y0 + inset, cell - inset * 2, cell - inset * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineDashOffset = dash;
    ctx.strokeRect(x0 + inset, y0 + inset, cell - inset * 2, cell - inset * 2);
    ctx.restore();
    return;
  }

  if (tool === TOOLS.PICKER) {
    // 3D 凸起效果：像把格子“吸起来”
    drawRaisedRect(ctx, x0, y0, cell, cell, hlw, cell >= 14);
    return;
  }

  if (tool === TOOLS.BRUSH) {
    // 内部每一格边缘涂上画笔颜色，大方形外圈加黑色细实线，右下保留阴影；
    // 按画笔尺寸显示整个矩形（边长 2n-1，不裁剪，保持形状一致）
    const { bx0, by0, bw, bh, r } = brushRect(originX, originY, cell, hover, size);
    const brushHlw = Math.max(1, Math.round(cell * HOVER_BRUSH_STROKE_RATIO));
    clipToPattern(ctx, originX, originY, width, height, cell);
    // 右下阴影
    ctx.lineWidth = hlw;
    drawDropShadow(ctx, bx0, by0, bw, bh);
    // 每一格边缘涂上画笔颜色
    ctx.lineWidth = brushHlw;
    ctx.strokeStyle = `rgb(${brushRgb[0]}, ${brushRgb[1]}, ${brushRgb[2]})`;
    for (let gy = 0; gy < 2 * r + 1; gy++) {
      for (let gx = 0; gx < 2 * r + 1; gx++) {
        const cx0 = bx0 + gx * cell;
        const cy0 = by0 + gy * cell;
        ctx.strokeRect(cx0 + brushHlw / 2, cy0 + brushHlw / 2, cell - brushHlw, cell - brushHlw);
      }
    }
    // 大方形外边框：黑色细实线（画在颜色边框之上）
    ctx.lineWidth = hlw;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(bx0 + hlw / 2, by0 + hlw / 2, bw - hlw, bh - hlw);
    ctx.restore();
    return;
  }

  // eraser：亮度自适应边框 + 对角 X；按橡皮尺寸显示整个矩形（不裁剪，X 不随边缘/角落形变）
  const { bx0, by0, bw, bh, r } = brushRect(originX, originY, cell, hover, size);
  // 图案范围内至少一个非空位才显示（空位擦了没意义），描边颜色取第一个非空位格子的亮度
  let ref = -1;
  for (
    let yy = Math.max(0, hover.y - r);
    yy <= Math.min(height - 1, hover.y + r) && ref < 0;
    yy++
  ) {
    for (let xx = Math.max(0, hover.x - r); xx <= Math.min(width - 1, hover.x + r); xx++) {
      const pp = yy * width + xx;
      if (displayIdx[pp] >= 0) {
        ref = displayRgb[pp];
        break;
      }
    }
  }
  if (ref < 0) return;
  const rgb = rgbFromPacked(ref);
  const frame = isLightColor(rgb)
    ? `rgba(0, 0, 0, ${HIGHLIGHT_FRAME_LIGHT})`
    : `rgba(255, 255, 255, ${HIGHLIGHT_FRAME_DARK})`;
  clipToPattern(ctx, originX, originY, width, height, cell);
  ctx.lineWidth = hlw;
  ctx.strokeStyle = frame;
  ctx.strokeRect(bx0 + inset, by0 + inset, bw - inset * 2, bh - inset * 2);
  ctx.beginPath();
  ctx.moveTo(bx0 + hlw, by0 + hlw);
  ctx.lineTo(bx0 + bw - hlw, by0 + bh - hlw);
  ctx.moveTo(bx0 + bw - hlw, by0 + hlw);
  ctx.lineTo(bx0 + hlw, by0 + bh - hlw);
  ctx.stroke();
  ctx.restore();
}
