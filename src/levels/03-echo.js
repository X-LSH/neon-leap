/**
 * 03 · 回响
 *
 * 教学目标：**坑的宽度决定起跳时机**。
 *
 * 前两关各自只教了一招（长按跳 / 贴边跳），这一关开始要求玩家**组合**它们：
 * 2 格的坑提前跳就能过，4 格的坑必须贴到边缘 —— 而更宽的坑还得先助跑到满速。
 * 玩家需要在这一关建立起「看坑宽 → 决定何时起跳」的条件反射。
 *
 * 尺寸依据（SPEC §2.5，满速长按跳水平覆盖 5.5 格）：
 *   2 格坑 → 提前 2 格起跳也够（余量 1.5 格）
 *   4 格坑 → 必须贴边起跳（余量 0.5 格，容错很薄）
 */

const W = 62;
const H = 24;
const GY = 19;

/** 坑：[起点, 宽度]（格）。刻意让两种宽度交替出现。 */
const GAPS = [
  [10, 2],
  [20, 3],
  [34, 2],
  [46, 3],
];

function build() {
  const g = Array.from({ length: H }, () => new Array(W).fill('.'));
  const rect = (x0, y0, x1, y1, ch = '#') => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = ch;
    }
  };

  rect(1, GY, W - 2, GY + 1);
  rect(0, 0, 0, GY + 1);
  rect(W - 1, 0, W - 1, GY + 1);

  for (const [x0, w] of GAPS) rect(x0, GY, x0 + w - 1, GY + 1, '.');

  // 两个 1 格台阶，制造落点变化（跳上去之后马上又是坑）
  rect(26, GY - 1, 27, GY - 1);
  rect(52, GY - 1, 53, GY - 1);

  g[GY - 1][58] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'echo',
  index: 3,
  name: '回响',
  chapter: '起步',
  teaches: '起跳时机',
  hint: '坑越宽，起跳就要越贴边',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：统一采用「贴边起跳」。
   *
   * 这不是偷懒 —— 贴边起跳对 2~4 格的坑都成立（4 格坑余量 0.5 格），
   * 而它恰恰是本关要让玩家形成的条件反射。
   * 策略如果按坑宽分档反而验证不了「玩家能不能用统一手法过关」这件事。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];   // 出口不在右边远处就松手（用 abs 会在冲过头后重新按右，反而撞墙）

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }
    if (p.grounded) {
      const gap = ctx.gapAhead(p, 6);
      const wall = ctx.wallAhead(p, 1, 4);
      // 坑贴边起跳；台阶提前一格起跳（留出上升时间）
      if (gap <= 1 || wall <= 2) keys.push('jump');
    }
    return keys;
  },
};
