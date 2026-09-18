/**
 * 12 · 崩解
 *
 * 教学目标：**崩塌地块 —— 时间压力下的路径选择**。
 *
 * 两段崩塌桥，中间隔着一小段实地。
 *   单段宽 5 格，跑过要 0.45 秒，而崩塌延迟是 0.5 秒 —— 刚好够，但不能停。
 *   中间那段实地是**故意的喘息点**：它让玩家能分两段处理，而不是一口气赌到底。
 *
 * 崩塌地块在踩上后会先**抖动 0.5 秒**才消失，那 0.5 秒就是撤离窗口；
 * 消失期间会留下虚线残影，告诉玩家"这里还会回来"。
 */

const W = 48;
const H = 24;
const GY = 19;

/** 两段崩塌桥：[起点, 宽度]。 */
const BRIDGES = [
  { at: 13, w: 5 },
  { at: 23, w: 5 },
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

  // 把崩塌桥所在的地面挖空 —— 桥面由 crumble 实体临时铺上
  for (const b of BRIDGES) rect(b.at, GY, b.at + b.w - 1, GY + 1, '.');

  g[GY - 1][43] = 'E';

  return g.map((r) => r.join(''));
}

const ENTITIES = BRIDGES.map((b) => ({
  type: 'crumble',
  at: { x: b.at, y: GY },
  w: b.w,
}));

export default {
  id: 'collapse',
  index: 12,
  name: '崩解',
  chapter: '机关',
  teaches: '时间压力',
  hint: '踩上去会先抖一下再塌 —— 别停，一口气跑过去',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),
  entities: ENTITIES,

  /**
   * 通关策略：一路向右，遇到崩塌桥就跳着加速通过。
   *
   * 为什么要在桥前**起跳**：跑过 5 格需要 0.45 秒，而崩塌延迟 0.5 秒 ——
   * 只有 0.05 秒余量。跳跃能让玩家在桥面上少待一点时间（起跳瞬间就离地），
   * 而且万一塌了还能靠滞空多飞一段。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      // 崩塌桥就在眼前 → 起跳，尽量少压在桥面上
      const crumble = ctx.crumbleAhead(p, 3);
      if (crumble <= 2) keys.push('jump');
    }
    return keys;
  },
};
