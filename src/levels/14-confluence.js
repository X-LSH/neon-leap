/**
 * 14 · 汇流
 *
 * 教学目标：**把前 13 关教的动词串起来**。
 *
 * 这一关刻意不再引入任何新东西 —— 它是一份"检查清单"：
 *   跳跃过坑（01-03）· 冲刺跨宽坑（04-06）· 抓墙攀爬（07）· 周期危险（11）· 崩塌地块（12）
 * 玩家如果在这里卡住，说明前面某一关的教学没有真正落地。
 *
 * 段落之间留了足够的缓冲平地 —— **综合关的难度应该来自组合，而不是来自连续紧张**。
 */

const W = 78;
const H = 26;
const GY = 19;

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

  // ① 3 格坑：常规跳跃
  rect(12, GY, 14, GY + 1, '.');

  // ② 6 格坑：必须跳 + 空中冲刺
  rect(22, GY, 27, GY + 1, '.');

  // ③ 5 格高柱：抓墙攀爬翻过去
  rect(36, GY - 5, 37, GY - 1);

  // ④ 崩塌桥
  rect(45, GY, 49, GY + 1, '.');

  // ⑤ 7 格坑：跳 + 冲刺（与 ② 同型，但更宽，作为本章的收束考验）
  rect(58, GY, 64, GY + 1, '.');

  g[GY - 1][73] = 'E';

  return g.map((r) => r.join(''));
}

const ENTITIES = [
  { type: 'laser', from: { x: 32, y: GY - 6 }, to: { x: 32, y: GY - 1 }, period: 2.6, phase: 0.1, duty: 0.5 },
  { type: 'crumble', at: { x: 45, y: GY }, w: 5 },
];

export default {
  id: 'confluence',
  index: 14,
  name: '汇流',
  chapter: '综合',
  teaches: '全动词组合',
  hint: '前面学过的都会用到 —— 卡住说明某一关没吃透',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),
  entities: ENTITIES,

  /**
   * 通关策略：按段落依次处理。
   *
   * 用「玩家当前所在的格区间」来分段，而不是试图写一个通吃的启发式 ——
   * 综合关的解法本来就是分段的，硬凑通用逻辑只会让它又长又脆。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const tx = p.x / 15;
    const keys = ['right'];

    // 激光段：前方有开启的激光就等
    if (ctx.laserAhead(p, 14) < 4) return [];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    // 空中：宽坑补冲刺（② 与 ⑤ 两段）
    if (!p.grounded) {
      const inWideGap = (tx > 20 && tx < 29) || (tx > 56 && tx < 66);
      if (inWideGap && p.dashesLeft > 0 && p.dashTimer <= 0 && p.freeze <= 0 && p.vy < 0) {
        keys.push('dash');
      }
      // 贴到高柱 → 抓住往上爬
      if (p.wallDir !== 0 && tx > 33 && tx < 40) {
        keys.push('grab', 'up');
      }
      return keys;
    }

    // 地面：坑前起跳；崩塌桥前也起跳（少压在桥面上）
    const gap = ctx.gapAhead(p, 10);
    const crumble = ctx.crumbleAhead(p, 4);
    const wall = ctx.wallAhead(p, 1, 5);   // 高柱：跳起来贴上去，空中段会抓住
    if (gap <= 1 || crumble <= 2 || wall <= 2) keys.push('jump');
    return keys;
  },
};
