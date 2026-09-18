/**
 * 08 · 之字
 *
 * 教学目标：**墙跳**（在两面墙之间左右弹跳上升）。
 *
 * 通道高 **7 格**，正好在单次攀爬（7.06 格）的覆盖之内 ——
 * 所以「抓住一面墙直接爬上去」就能通关，墙跳是**更快的替代路线**而不是唯一解。
 *
 * 这是刻意的取舍：把墙跳做成硬门槛，会让没有教学提示的关卡变成劝退点；
 * 把它做成"更快的路"，愿意钻研的玩家能获得掌控感，不想钻研的也能过。
 */

const W = 46;
const H = 24;
const GY = 19;

const LEFT_X = 18;
const RIGHT_X = 23;
const TOP = GY - 7;

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

  // 左墙底部留 2 格入口（玩家高 12 单位、站立时占 GY-1 那一行，堵住就走不进去）
  rect(LEFT_X, TOP, LEFT_X, GY - 2);
  rect(RIGHT_X, TOP, RIGHT_X, GY - 1);

  rect(LEFT_X, TOP - 1, RIGHT_X, TOP - 1);   // 顶部封板
  g[TOP - 1][RIGHT_X + 4] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'zigzag',
  index: 8,
  name: '之字',
  chapter: '墙面',
  teaches: '墙跳',
  hint: '贴着墙按 Z 会蹬着墙跳开 —— 左右交替就越升越高',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：进通道 → 贴上墙 → 抓住往上爬 → 力竭前蹬墙续力。
   *
   * ⚠️ 最关键的一行是 `if (p.wallDir === 0) return ['right']` ——
   * 空中**没贴墙时必须松开跳跃键**。策略若每帧都返回 jump，
   * 它会一直处于 held 状态、永远不再产生 pressed 边沿，
   * 而墙跳和普通跳都只认边沿 —— 玩家按住跳跃键贴墙的那一刻反而蹬不出去。
   */
  solution: (p, ctx) => {
    const inShaft = p.x > LEFT_X * 15 + 8 && p.x < RIGHT_X * 15;
    const cleared = p.y < (TOP - 1) * 15;

    if (!inShaft || cleared) {
      if (ctx.exitDx(p) < 12) return [];
      return ['right'];
    }

    if (!p.grounded) {
      if (p.wallDir === 0) return ['right'];
      if (p.stamina > 0.3) return ['grab', 'up'];
      if (p.wallLock > 0) return [];      // 给一帧空档让锁定走完
      return ['jump'];                     // 力竭 → 蹬墙
    }
    // 站在通道底部：跳起来去贴墙（少了这一行玩家会站在原地永远不动）
    return ['right', 'jump'];
  },
};
