/**
 * 配色令牌 —— 全站唯一颜色来源。
 *
 * 色相纪律：只有三个色相参与语义。
 *   青  #35e0ff  我 · 安全 · 助力
 *   品红 #ff2d7a  危险 · 会杀死你的一切
 *   紫  #c16bff  位移
 * 其余一律用明度分级。危险物颜色不得被装饰性元素打破。
 */

export const PAL = {
  void: '#05060a',
  bg: '#0a0d16',
  gridFar: '#101828',
  gridNear: '#1b2a47',

  player: '#35e0ff',
  playerCore: '#eaffff',
  trail: '#35e0ff',

  // 地形四级：内部格纹 → 体填充 → 暴露侧边 → 受光顶边（核心最亮）
  // 明度台阶必须拉得开，否则大块实心会糊成一坨死黑
  platformInner: '#0d1a2a',
  platformFill: '#17293e',
  platformEdge: '#255a7d',
  platformTop: '#3ba9d6',
  platformGlow: '#9ceaff',

  bounce: '#5ff0d8',
  danger: '#ff2d7a',
  dangerCore: '#ffd0e2',
  portal: '#c16bff',

  exit: '#e8eef7',
  checkpoint: '#35e0ff',

  uiText: '#e8eef7',
  uiDim: '#6b7a90',
  debug: '#4a5668',
};

/** 把十六进制色转成带透明度的 rgba()。Canvas 不支持 8 位 hex 简写。 */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
