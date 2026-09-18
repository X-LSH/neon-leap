/**
 * 02 · 惯性
 *
 * 教学目标：移动惯性 + **边缘起跳**。
 *
 * 设计关键：平台间隔必须**略微超出「从平台中部起跳」的能力，
 * 但落在「从平台末端起跳」的能力之内**。
 * 这样玩家会自己发现「要踩到最边缘再跳」，
 * 而不是被一行文字提示告知 —— 后者学不会，前者一次就记住。
 *
 * ⚠️ 尺寸依据（SPEC §2.5 **修正后**的实测值）：
 *   满速长按跳的**真实滞空位移 = 4.4 格**（滞空 0.40 秒 × 跑速 165 u/s）
 *   平台 3 格宽、间隔 3 格（平台起点间隔 6 格）
 *   → 从平台末端（第 4 格，x≈65u）起跳，落点 x≈131u，落在对岸（120u 起）✓
 *   → 从平台中部（第 3.5 格，x≈52u）起跳，落点 x≈118u —— **差 2 单位掉下去**
 *
 *   早先按「5.5 格」设计的版本实测直接失败。那个数字来自一个**测错的探针**：
 *   它量的是固定 0.5 秒内的位移，而实际滞空只有 0.4 秒，多出来的是落地后的跑动。
 *   这就是为什么能力标尺必须由探针产出、而不能靠推算 —— 推算不会发现自己量错了。
 */

const W = 54;
const H = 24;
const GY = 19;

/** 平台起点（格）。间隔 6 格 = 3 格台面 + 3 格虚空。 */
const PLATFORMS = [2, 8, 14, 20, 26, 32, 38, 44];
const PLAT_W = 3;

function build() {
  const g = Array.from({ length: H }, () => new Array(W).fill('.'));
  const rect = (x0, y0, x1, y1, ch = '#') => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = ch;
    }
  };

  // 悬空平台：只有两层厚，下方是虚空 —— 掉下去就是死，没有"爬回来"的可能
  for (const x0 of PLATFORMS) rect(x0, GY, x0 + PLAT_W - 1, GY + 1);

  // 收尾的实心地面 + 封边
  rect(50, GY, W - 1, GY + 1);
  rect(W - 1, 0, W - 1, GY + 1);

  g[GY - 1][52] = 'E';

  return g.map((r) => r.join(''));
}

export default {
  id: 'inertia',
  index: 2,
  name: '惯性',
  chapter: '起步',
  teaches: '边缘起跳',
  hint: '踩到最边缘再跳 —— 半格的差距就是生死',
  spawn: { x: 3, y: GY - 1 },
  tiles: build(),

  /**
   * 通关策略：跑到平台最边缘才起跳。
   *
   * 这里**必须用 `gap <= 1`**（而 01 关用的是 `gap <= 2`）：
   * 提前两格起跳的落点是 8.5 格，正好落进虚空里。
   * 关卡设计的意图就是逼出「贴边起跳」，策略也必须贴着这个意图走。
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
      if (gap <= 1) keys.push('jump');
    }
    return keys;
  },
};
