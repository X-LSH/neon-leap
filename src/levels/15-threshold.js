/**
 * 15 · 越界
 *
 * 终章。**不再引入任何新机制，而是要求连续作答**。
 *
 * 与 14 的区别是节奏：14 在每段之间留了缓冲平地，
 * 这一关把段落压得更紧，而且把「最宽的一跳」放在最后 ——
 * 玩家会在最疲惫的时候面对最需要精准的一跳，这是终章该有的收束感。
 *
 * 关卡名「越界」指的不是地图边界，而是玩家对自己能力边界的认知：
 * 走到这里，他已经把跑、跳、冲刺、抓墙、读节奏全部内化了。
 */

const W = 84;
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

  // ① 3 格坑
  rect(10, GY, 12, GY + 1, '.');

  // ② 激光 + 紧跟一个 3 格坑（读节奏的同时还得跳）
  rect(19, GY, 21, GY + 1, '.');

  // ③ 6 格高柱：抓墙翻越
  rect(29, GY - 6, 30, GY - 1);

  // ④ 崩塌桥
  rect(37, GY, 41, GY + 1, '.');

  // ⑤ 两级台阶 + 6 格坑（冲刺上台阶后立刻跨坑）
  rect(48, GY - 3, 51, GY - 1);
  rect(52, GY, 57, GY + 1, '.');

  // ⑥ 终局：最宽的一跳（7 格，必须跳 + 空中冲刺）
  rect(65, GY, 71, GY + 1, '.');

  g[GY - 1][79] = 'E';

  return g.map((r) => r.join(''));
}

const ENTITIES = [
  { type: 'laser', from: { x: 16, y: GY - 6 }, to: { x: 16, y: GY - 1 }, period: 2.2, phase: 0.15, duty: 0.5 },
  { type: 'laser', from: { x: 44, y: GY - 7 }, to: { x: 44, y: GY - 1 }, period: 2.8, phase: 0.4, duty: 0.5 },
  { type: 'crumble', at: { x: 37, y: GY }, w: 5 },
];

export default {
  id: 'threshold',
  index: 15,
  name: '越界',
  chapter: '综合',
  teaches: '终章',
  hint: '把所有学会的东西连起来 —— 最后一跳要留足助跑',
  spawn: { x: 2, y: GY - 1 },
  tiles: build(),
  entities: ENTITIES,

  solution: (p, ctx) => {
    if (ctx.exitDx(p) < 12) return [];

    const tx = p.x / 15;
    const keys = ['right'];

    // 激光段：等窗口
    if (ctx.laserAhead(p, 14) < 4) return [];

    if (p.jumpHeld > 0) {
      keys.push('jump');
      return keys;
    }

    if (!p.grounded) {
      // 宽坑补冲刺：③ 之后的 52-57，以及终局的 65-71
      const inWideGap = (tx > 50 && tx < 59) || (tx > 63 && tx < 73);
      if (inWideGap && p.dashesLeft > 0 && p.dashTimer <= 0 && p.freeze <= 0 && p.vy < 0) {
        keys.push('dash');
      }
      // 高柱：抓墙翻越
      if (p.wallDir !== 0 && tx > 27 && tx < 33) {
        keys.push('grab', 'up');
      }
      return keys;
    }

    const gap = ctx.gapAhead(p, 10);
    const crumble = ctx.crumbleAhead(p, 4);
    const wall = ctx.wallAhead(p, 1, 5);
    const step = ctx.wallAhead(p, 3, 7);   // 3 格台阶：长按跳够不着，必须右上冲刺

    if (step <= 4) {
      keys.push('up', 'dash');
      return keys;
    }
    // 台阶提前起跳（留出上升行程），坑与崩塌桥贴边起跳
    if (gap <= 1 || crumble <= 2 || wall <= 2) keys.push('jump');
    return keys;
  },
};
