/**
 * 绘制工具。
 *
 * ★ 核心决策：**伪辉光**。
 * `ctx.shadowBlur` 是 Canvas 2D 里最诱人也最贵的一个参数 —— 每帧调用成本极高，
 * 低端设备直接跪。这里的替代方案是「同一形状描 3 遍」：
 *   外晕（粗、极淡）→ 中晕（中、半透）→ 核心（细、实色）
 * 成本只剩 3 次 stroke()，霓虹感却一分不少。
 *
 * 规则：glowStroke 禁止出现在高频调用的循环里；玩家与出口可额外叠一层，其余一律三层。
 */

/** 标准三层辉光：宽度（世界单位）、不透明度。 */
export const GLOW_LAYERS = [
  { width: 7, alpha: 0.13 },
  { width: 3.4, alpha: 0.32 },
  { width: 1.3, alpha: 1 },
];

/**
 * 用伪辉光描一条路径。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} color 辉光色
 * @param {(c:CanvasRenderingContext2D)=>void} pathFn 内部需自行 beginPath 并 stroke
 * @param {{layers?:{width:number,alpha:number}[], core?:string}} [opts]
 */
export function glowStroke(ctx, color, pathFn, opts = {}) {
  const layers = opts.layers || GLOW_LAYERS;
  const last = layers.length - 1;
  const prevAlpha = ctx.globalAlpha;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let i = 0; i < layers.length; i++) {
    ctx.globalAlpha = layers[i].alpha;
    ctx.lineWidth = layers[i].width;
    ctx.strokeStyle = i === last && opts.core ? opts.core : color;
    pathFn(ctx);
  }

  ctx.globalAlpha = prevAlpha;
}

/** 直线路径。 */
export function linePath(x1, y1, x2, y2) {
  return (c) => {
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  };
}

/** 矩形描边路径。 */
export function rectPath(x, y, w, h) {
  return (c) => {
    c.beginPath();
    c.rect(x, y, w, h);
    c.stroke();
  };
}

/** 多边形路径。points 为 [[x,y], ...]。 */
export function polyPath(points, close = true) {
  return (c) => {
    c.beginPath();
    c.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
    if (close) c.closePath();
    c.stroke();
  };
}

/** 圆路径。 */
export function circlePath(cx, cy, r) {
  return (c) => {
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
  };
}

/**
 * 实心块 + 受光顶边。
 * 光源方向**恒为正上方**，全站统一 —— 这让所有几何体的体积感一致。
 */
export function litRect(ctx, x, y, w, h, fill, topColor, topWidth = 1.5) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = topColor;
  ctx.fillRect(x, y, w, topWidth);
}
