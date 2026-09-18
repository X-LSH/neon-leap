/**
 * 04 · 折射
 *
 * 教学目标：八向冲刺（本关只用到水平方向）。
 *
 * 两种坑，两种解法：
 *   5 格坑 → 地面冲刺就能过（冲刺水平覆盖 5.5 格）
 *   7 格坑 → 必须「起跳 + 空中冲刺」（跳跃 4.5 格 + 冲刺额外 2.85 格 ≈ 7.35 格）
 *
 * 为什么不能「跳和冲同时按」：冲刺判定优先于跳跃，同帧按下时跳跃会被整个吞掉，
 * 玩家得到的是一次纯水平冲刺。所以正确手法是**先跳、升到空中再冲**——
 * 这个顺序本身就是本关要教的东西。
 */

const W = 54;
const H = 24;
const GY = 19;

import { TILE } from '../game/config.js';

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

  rect(12, GY, 16, GY + 1, '.');   // 5 格坑：跳 + 空中冲刺
  rect(27, GY, 32, GY + 1, '.');   // 7 格坑：更宽的跳 + 冲

  g[GY - 1][49] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'refraction',
  index: 4,
  name: '折射',
  chapter: '冲刺',
  teaches: '冲刺跨坑',
  hint: 'X 冲刺 · 大坑要先跳起来再冲',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略。
   *
   * 用了关卡特定的坐标常量（大坑起点），而不全靠通用感知 ——
   * 这是刻意为之：**策略要证明的是「存在一条通关路径」，不是「通用 AI 能玩所有关」**。
   * 强行追求通用性，只会让每一条策略都变得既长又脆。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];   // 出口不在右边远处就松手（用 abs 会在冲过头后重新按右，反而撞墙）

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      const gap = ctx.gapAhead(p, 12);
      if (gap <= 1) keys.push('jump');   // 一律先跳，升空后再补冲刺
      return keys;
    }

    // 空中：位于两个坑之一的区间内、还没用过冲刺 → 补一次。
    // 判据用区间而不是单一阈值：上一版写成 `x > bigGapStart - 120`（=19 格）
    // 而第一个坑在 12 格，条件永远不成立，冲刺从来没触发过。
    const inGapZone = (p.x > 10 * TILE && p.x < 20 * TILE)
                   || (p.x > 25 * TILE && p.x < 36 * TILE);
    if (inGapZone && p.dashesLeft > 0 && p.dashTimer <= 0 && p.freeze <= 0 && p.vy < 0) {
      keys.push('dash');
    }
    return keys;
  },
};
