/**
 * 01 · 初光
 *
 * 教学目标：移动与跳跃（含可变跳跃高度）。
 * 全关无任何危险物 —— 第一章的任务是让玩家**敢于按跳跃键**，
 * 而不是考验他。所有障碍都落在「长按跳 1.59 格」的安全范围内。
 *
 * 尺寸依据（见 SPEC §2.5 能力标尺）：
 *   台阶高度 1 格 ≤ 1.4 格安全值
 *   坑洞宽度 2 格 ≤ 4.5 格安全值
 */

const W = 48;
const H = 24;
const GY = 19;

function build() {
  const g = Array.from({ length: H }, () => new Array(W).fill('.'));
  const rect = (x0, y0, x1, y1, ch = '#') => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = ch;
    }
  };

  // 地面（两层厚，下方留空 → 视觉上是浮空平台）+ 左右封边
  rect(1, GY, W - 2, GY + 1);
  rect(0, 0, 0, GY + 1);
  rect(W - 1, 0, W - 1, GY + 1);

  // 两处 2 格坑：足够宽到必须真的跳，又足够窄到不会卡住新手
  rect(12, GY, 13, GY + 1, '.');
  rect(28, GY, 29, GY + 1, '.');

  // 一级台阶
  rect(23, GY - 1, 26, GY - 1);

  // 结尾两级台阶，最后一跳后落地即出口
  rect(38, GY - 1, 41, GY - 1);
  rect(42, GY - 2, 44, GY - 1);

  // 出口位置是按「玩家减速滑行后的实际停点」定的：
  // 跑速 165 u/s 下松手后要滑行约 9 单位，所以停点会在出口中心右侧一点。
  // 放在第 45 格时实测停点差 1.5 单位够不着，第 46 格正好。
  g[GY - 1][46] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'first-light',
  index: 1,
  name: '初光',
  chapter: '起步',
  teaches: '移动与跳跃',
  hint: '方向键移动 · Z 跳跃（按住跳得更高）',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：一直向右跑；前方是坑或台阶就跳；起跳后持续按住把跳跃顶到最高。
   *
   * ⚠️ 第二段 `p.jumpHeld > 0` 是必需的，不是优化：
   * 只在「需要跳」的瞬间按住 jump，起跳后第一帧就会松开，
   * 触发松键收力（`vy *= 0.5`）—— 跳跃高度直接砍半，滞空只剩 0.2 秒，
   * 连 2 格的坑都跨不过去。**策略必须理解手感机制，否则它验证的是一个不存在的游戏。**
   *
   * 判定阈值 `gap <= 2` 的依据：从距坑 2 格处起跳，长按跳的水平覆盖约 5.5 格。
   */
  solution: (p, ctx) => {
    // 到出口就停下 —— 策略一路按住方向键，不撒手就会冲过出口撞上右封边墙
    if (ctx.exitDx(p) < 12) return [];   // 出口不在右边远处就松手（用 abs 会在冲过头后重新按右，反而撞墙）

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');            // 跳跃上升期：继续按住，跳到最高
      return keys;
    }
    if (p.grounded) {
      const gap = ctx.gapAhead(p, 4);
      const wall = ctx.wallAhead(p, 1, 4);
      // ⚠️ 台阶判据必须留出「上升时间」：
      // 玩家跑速 165 u/s，而上升到 1 格高需要 0.078s —— 那 0.078s 里会前进 12.9 单位。
      // 所以起跳点距台阶不能少于 0.86 格，否则起跳瞬间就撞在台阶侧壁上（速度归零）。
      // 这也是为什么用 2 而不是 1。
      if (gap <= 2 || wall <= 2) keys.push('jump');
    }
    return keys;
  },
};
