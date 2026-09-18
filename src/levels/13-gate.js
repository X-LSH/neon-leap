/**
 * 13 · 门
 *
 * 教学目标：**传送门 —— 动量守恒的位移**。
 *
 * 中间是一道 12 格宽的深渊，远超任何机动能力（最后的空中冲刺组合也只有 7.16 格）。
 * 唯一的通路是横跨深渊的一对传送门。
 *
 * 传送门**保留入射动量**：带着冲刺速度进门，会带着同样的速度出来。
 * 这一点在本关是有用的 —— 出射端紧接着一段崩塌桥，
 * 冲出来的速度正好够一口气跑过去。
 */

const W = 46;
const H = 26;
const GY = 19;

const GAP_FROM = 14;
const GAP_TO = 25;
const PORTAL_IN = 12;
const PORTAL_OUT = 28;

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

  // 深渊
  rect(GAP_FROM, GY, GAP_TO, H - 1, '.');

  // 深渊之后紧接着一段崩塌桥（出射动量正好用来冲过它）
  rect(31, GY, 35, GY + 1, '.');

  g[GY - 1][42] = 'E';

  return g.map((r) => r.join(''));
}

const ENTITIES = [
  { type: 'portal', tag: 'abyss', at: { x: PORTAL_IN, y: GY - 1 }, to: { x: PORTAL_OUT, y: GY - 1 } },
  { type: 'crumble', at: { x: 31, y: GY }, w: 5 },
];

export default {
  id: 'gate',
  index: 13,
  name: '门',
  chapter: '机关',
  teaches: '传送门',
  hint: '深渊跨不过去 —— 走进紫色的门会从另一端出来，速度也会保留',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),
  entities: ENTITIES,

  /**
   * 通关策略：一路向右即可 —— 传送门会自动接住玩家。
   *
   * 但**出射端之后要立刻起跳**：出口紧挨着崩塌桥，
   * 而传送保留了入射速度（跑动 165 u/s），冲出来正好够跨过桥面。
   * 这一段是"动量守恒"这条机制在设计上的直接用途，不是巧合。
   */
  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const keys = ['right'];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (p.grounded) {
      // 出射端之后（28 格往后）遇到崩塌桥就跳过去
      const crumble = ctx.crumbleAhead(p, 4);
      if (p.x > 27 * 15 && crumble <= 3) keys.push('jump');
    }
    return keys;
  },
};
