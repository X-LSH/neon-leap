/**
 * 05 · 突进
 *
 * 教学目标：**八向冲刺**（本关专教朝上）。
 *
 * 台阶高度刻意设为 **3 格**：
 *   长按跳只能上 1.59 格 → 够不着
 *   右上冲刺垂直分量 3.2 格 → 刚好够
 * 玩家会发现「原来冲刺不只能往前」—— 这是本作第一个真正的新动词。
 *
 * 尺寸依据（SPEC §2.5）：
 *   向上冲刺 5.45 格 · 右上冲刺（45°）垂直与水平各 3.2 格
 *   无墙环境垂直障碍必须 ≤ 6 格
 */

const W = 54;
const H = 24;
const GY = 19;

/**
 * 三级台阶：**紧挨着**排布，每级只比前一级高 3 格。
 *
 * ⚠️ 这一点是踩过坑的：最初把台阶做成三根独立的柱子，
 * 结果玩家从**地面**直接面对第二级（高 6 格）—— 而右上冲刺只有 3.2 格垂直分量，上不去。
 * 台阶必须连成阶梯，让玩家始终从**前一级的顶面**出发，
 * 每一跳的高度差才是可控的 3 格。
 */
const STEPS = [
  { x: 10, w: 5, top: GY - 3 },
  { x: 15, w: 5, top: GY - 6 },
  { x: 20, w: 5, top: GY - 9 },
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

  // 每级台阶都是一根从顶面落地的实心柱，避免出现「跳进柱子里」的歧义
  for (const s of STEPS) rect(s.x, s.top, s.x + s.w - 1, GY - 1);

  // 出口放在地面上（GY-1）。写成 GY-10 会让它悬在离地 10 格高的半空里，
  // 玩家跑到位置也触发不了 —— 关卡数据的坐标差一格就是这种静默失败。
  g[GY - 1][45] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'thrust',
  index: 5,
  name: '突进',
  chapter: '冲刺',
  teaches: '八向冲刺',
  hint: '冲刺不只能往前 —— 按住 ↑ 再按 X 可以向上冲',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：遇到高度 ≥2 格的墙就用「右上冲刺」。
   *
   * 为什么是右上而不是正上：纯向上冲刺会把水平速度清零，玩家原地升起又原地落下，
   * 永远落不到台阶上。45° 的右上冲刺同时给出 3.2 格水平和 3.2 格垂直，
   * 正好把玩家送进台阶顶面。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      // ⚠️ 判据必须留够起跳距离：右上冲刺会先冻结 0.05 秒，
      // 然后以 318 u/s 的水平速度冲出去 —— 贴着墙再冲，第一帧就撞在台阶侧壁上。
      // 距墙 4 格启动，冲刺结束时正好落进台阶顶面。
      const wall = ctx.wallAhead(p, 2, 8);
      if (wall <= 4) {
        keys.push('up', 'dash');   // 同帧按下时冲刺优先，所以这是一次干净的右上冲刺
        return keys;
      }
    }
    return keys;
  },
};
