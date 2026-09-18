/**
 * 11 · 脉冲
 *
 * 教学目标：**周期危险的节奏**。
 *
 * 三道同相位的激光柱（间隔 6 格），关闭窗口 = 周期 2.4s × 关闭占比 0.5 = 1.2 秒，
 * 而跑过 18 格只需要 0.11 秒 —— 所以只要**在对的时机出发**，一次就能全部穿过。
 *
 * 这一关教的是「停」而不是「冲」：玩家第一次会因为闷头跑而死，然后才会抬头看节奏。
 * 激光在开启前有 0.35 秒的闪烁预警，那是留给玩家的决策窗口，
 * 也是「危险必须可预告」这条红线在这一关的具体兑现。
 */

const W = 46;
const H = 24;
const GY = 19;

const LASER_XS = [16, 22, 28];

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

  g[GY - 1][41] = 'E';

  return g.map((r) => r.join(''));
}

/** 三道同相位激光。同相位 = 同时开、同时关，玩家可以一次规划跨越全部三道。 */
const ENTITIES = LASER_XS.map((x) => ({
  type: 'laser',
  from: { x, y: GY - 7 },
  to: { x, y: GY - 1 },
  period: 2.4,
  phase: 0,
  duty: 0.5,
}));

export default {
  id: 'pulse',
  index: 11,
  name: '脉冲',
  chapter: '机关',
  teaches: '激光节奏',
  hint: '激光有节奏 —— 关闭的窗口足够你一口气跑过去',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),
  entities: ENTITIES,

  /**
   * 通关策略：**前方激光开启且很近时停下等**，其余时间向右跑。
   *
   * 这一条断言很关键：一个只会闷头向前的策略在周期危险面前必然送死，
   * 而那是**策略的缺陷，不是关卡的缺陷** ——
   * 激光既然设计了关闭窗口，自动控制就必须有能力利用它。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    // 4 格内有正在开启的激光 → 停下等它关（3 格内才停就来不及刹住了）
    if (ctx.laserAhead(p, 14) < 4) return [];

    return ['right'];
  },
};
