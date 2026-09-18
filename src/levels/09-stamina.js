/**
 * 09 · 耐力
 *
 * 教学目标：**攀爬耐力是会耗尽的**。
 *
 * 墙高 **12 格**，而单次攀爬只能上 7.06 格 ——
 * 玩家爬到一半会发现角色开始闪红，然后掉下去。
 * 这一关就是要让他经历这件事，并学会：**力竭之前先蹬墙**（墙跳会回满耐力）。
 *
 * 尺寸依据：单次攀爬 7.06 格 < 墙高 12 格（刻意超出，逼出技巧）
 */

const W = 46;
const H = 26;
const GY = 19;

const WALL_X = 22;
const WALL_W = 2;
const WALL_H = 12;

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

  rect(WALL_X, GY - WALL_H, WALL_X + WALL_W - 1, GY - 1);

  // 出口放在墙顶右侧的落脚平台上（不是直接踩在墙顶，给一个明确的落点）
  rect(WALL_X + WALL_W, GY - WALL_H, WALL_X + WALL_W + 3, GY - WALL_H);
  g[GY - WALL_H - 1][WALL_X + WALL_W + 2] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'stamina',
  index: 9,
  name: '耐力',
  chapter: '墙面',
  teaches: '耐力管理',
  hint: '爬到角色闪红就快撑不住了 —— 这时候蹬墙可以回满',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：贴墙就爬，**耐力见底时蹬墙续力**，然后再贴回来继续爬。
   *
   * 这就是 07 关没有教、而这一关必须自己悟出来的那一步。
   * 阈值取 0.35 而不是 0：要留出「蹬墙 → 飞离 → 飞回 → 重新贴上」这段时间，
   * 等到真正归零才动，玩家已经在往下掉了。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const keys = ['right'];

    if (!p.grounded && p.wallDir !== 0) {
      if (p.stamina > 0.35) {
        keys.push('grab', 'up');      // 还有余量 → 继续爬
      } else {
        keys.push('jump');            // 快撑不住 → 蹬墙，顺带回满耐力
      }
      return keys;
    }

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      const wall = ctx.wallAhead(p, 4, 12);
      if (wall <= 3) keys.push('jump');
    }
    return keys;
  },
};
