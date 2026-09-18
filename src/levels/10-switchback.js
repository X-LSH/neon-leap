/**
 * 10 · 折返
 *
 * 教学目标：**连续墙跳**（把 08 的单次反射变成可持续的上升）。
 *
 * 本关是墙面章节的收束：通道更高（7 格）、没有顶部封板挡住视线，
 * 而且**终点在通道顶部的右侧平台**，玩家必须真的爬出通道再横移一段。
 *
 * 与 08 一样，抓墙爬是可行解，墙跳是更快的路线。
 * 这个原则贯穿整个墙面章节 —— **永远给玩家一条不依赖高阶技巧的保底路径**。
 */

const W = 50;
const H = 26;
const GY = 21;

const LEFT_X = 19;
const RIGHT_X = 24;
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

  rect(LEFT_X, TOP, LEFT_X, GY - 2);
  rect(RIGHT_X, TOP, RIGHT_X, GY - 1);

  // 出口放在通道顶部右侧的落脚平台上（爬出通道后向右走即达）
  rect(RIGHT_X, TOP - 1, RIGHT_X + 4, TOP - 1);
  g[TOP - 2][RIGHT_X + 3] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'switchback',
  index: 10,
  name: '折返',
  chapter: '墙面',
  teaches: '连续墙跳',
  hint: '爬出通道后往左走 —— 出口在顶上',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  solution: (p, ctx) => {
    const inShaft = p.x > LEFT_X * 15 + 8 && p.x < RIGHT_X * 15;
    const cleared = p.y < (TOP - 1) * 15 - 20;

    // 出通道后向左走（出口在顶部平台的左端）
    if (cleared) {
      if (Math.abs(ctx.exitDx(p)) < 12) return [];
      return [ctx.exitDx(p) > 0 ? 'right' : 'left'];
    }

    if (!inShaft) {
      if (ctx.exitDx(p) < 12) return [];
      return ['right'];
    }

    if (!p.grounded) {
      if (p.wallDir === 0) return ['right'];
      if (p.stamina > 0.3) return ['grab', 'up'];
      if (p.wallLock > 0) return [];
      return ['jump'];
    }
    // 站在通道底部：跳起来去贴墙（少了这一行玩家会站在原地永远不动）
    return ['right', 'jump'];
  },
};
