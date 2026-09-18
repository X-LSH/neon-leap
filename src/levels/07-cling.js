/**
 * 07 · 攀附
 *
 * 教学目标：**抓墙与攀爬**（本作的第二个新动词）。
 *
 * 墙高 **6 格**，正好在朴素解法（跳 + 抓墙爬 = 7.06 格）的覆盖之内 ——
 * 玩家不需要任何技巧循环，只要「跳上去 → 按住抓墙键 → 按住上」就能翻过去。
 * 这是有意为之：**先让玩家建立对墙的信任**，再在 09、10 关才要求技巧。
 */

const W = 46;
const H = 24;
const GY = 19;

const WALL_X = 22;
const WALL_W = 2;
const WALL_H = 6;

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

  // 6 格高墙：玩家必须靠攀爬翻过去
  rect(WALL_X, GY - WALL_H, WALL_X + WALL_W - 1, GY - 1);

  g[GY - 1][41] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'cling',
  index: 7,
  name: '攀附',
  chapter: '墙面',
  teaches: '抓墙攀爬',
  hint: '贴着墙时按住 C 抓住，再用 ↑ 往上爬',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：跑到墙边 → 起跳 → 贴墙 → 抓 + 上爬。
   *
   * 判据用 `wallAhead(p, 6, 10)`：探到 6 格高的墙就起跳贴上去。
   * 起跳太早会在半空抓不到墙（水平距离不够），太晚则撞在墙根上。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const keys = ['right'];

    // 已经贴在墙上：抓住并向上爬
    if (!p.grounded && p.wallDir !== 0) {
      keys.push('grab', 'up');
      return keys;
    }

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      const wall = ctx.wallAhead(p, WALL_H, 10);
      if (wall <= 3) keys.push('jump');   // 距墙 3 格起跳，飞行途中正好贴上
    }
    return keys;
  },
};
