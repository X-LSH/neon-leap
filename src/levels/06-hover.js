/**
 * 06 · 悬停
 *
 * 教学目标：**冲刺的恢复**。
 *
 * 空中只能冲刺一次 —— 想连续冲刺，就必须先落回地面。
 * 这一关把平台间隔设成 **7 格**，而「跳 + 空中冲刺」的覆盖是 7.16 格：
 * 差一点就到不了，逼玩家把跳跃与冲刺压到极限；但只要踩到下一个平台，
 * 冲刺次数就会立刻恢复 —— 这就是本关要建立的条件反射。
 *
 * 尺寸依据：跳 + 空中冲刺 = 7.16 格（跳 4.31 + 冲刺额外 2.85）
 */

const W = 56;
const H = 24;
const GY = 19;

/** 平台起点（格）。间隔 9 格 = 3 格台面 + 6 格虚空。 */
const PLATFORMS = [2, 11, 20, 29, 38, 47];
const PLAT_W = 3;

function build() {
  const g = Array.from({ length: H }, () => new Array(W).fill('.'));
  const rect = (x0, y0, x1, y1, ch = '#') => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = ch;
    }
  };

  for (const x0 of PLATFORMS) rect(x0, GY, x0 + PLAT_W - 1, GY + 1);
  rect(52, GY, W - 1, GY + 1);
  rect(W - 1, 0, W - 1, GY + 1);

  g[GY - 1][54] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'hover',
  index: 6,
  name: '悬停',
  chapter: '冲刺',
  teaches: '冲刺恢复',
  hint: '空中只能冲一次 —— 踩到地面就会回满',
  spawn: { x: 3, y: GY - 1 },
  tiles: build(),

  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      const gap = ctx.gapAhead(p, 12);
      if (gap <= 1) keys.push('jump');   // 贴边起跳
      return keys;
    }

    // 空中补一次冲刺（每落一次地就恢复一次，所以每段平台之间都能用）
    if (p.dashesLeft > 0 && p.dashTimer <= 0 && p.freeze <= 0 && p.vy < 0) {
      keys.push('dash');
    }
    return keys;
  },
};
