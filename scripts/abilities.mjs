#!/usr/bin/env node
/**
 * 能力探针：在当前 config.js 的参数下，玩家究竟能做到什么。
 *
 * 为什么需要它：
 * 关卡设计里每个障碍物都必须落在「实测可达区间」内。
 * 靠估算（"跳跃大概 2 格"）设计出来的高度，实测经常差 0.2 格而把玩家卡死 ——
 * 而这种缺陷在自检里看不出来，它既不违反物理，也不违反状态机。
 *
 * 用法：node scripts/abilities.mjs
 * 改完 config.js 就应该跑一次，看能力边界有没有整体位移。
 */

import { TILE, FIXED_DT, PLAYER_H, JUMP_APEX, DASH_REACH, CLIMB_REACH, CFG } from '../src/game/config.js';
import { createPlayer, updatePlayer } from '../src/game/player.js';

const IDLE = {
  moveX: 0, moveY: 0,
  jump: { held: false, pressed: false },
  dash: { held: false, pressed: false },
  grab: { held: false, pressed: false },
};
const mix = (over) => ({ ...IDLE, ...over });

const GROUND_TY = 20;
const GROUND_Y = GROUND_TY * TILE - PLAYER_H;

const FLAT = { isSolid: (_tx, ty) => ty >= GROUND_TY };
const spawnGround = { x: 5 * TILE, y: GROUND_Y };
const HOLD_FRAMES = Math.round(CFG.jumpHoldMax / FIXED_DT);

const results = [];
const px = (u) => u.toFixed(1) + 'u';
const cells = (u) => (u / TILE).toFixed(2) + '格';
function record(name, value, note = '') {
  results.push({ name, value, note });
}

/** 从头跑一段，返回最大升高。 */
function probeRise({ world, spawn, inputFor, frames = 480 }) {
  const p = createPlayer(spawn.x, spawn.y);
  let peak = p.y;
  for (let i = 0; i < frames; i++) {
    updatePlayer(p, inputFor(i, p), world, FIXED_DT);
    if (p.y < peak) peak = p.y;
  }
  return spawn.y - peak;
}

/** 先让玩家站稳/助跑，再测量一段位移。 */
function probeTravel({ world, spawn, preFrames = 20, preInput = IDLE, inputFor, frames = 90 }) {
  const p = createPlayer(spawn.x, spawn.y);
  for (let i = 0; i < preFrames; i++) updatePlayer(p, preInput, world, FIXED_DT);
  const x0 = p.x;
  for (let i = 0; i < frames; i++) updatePlayer(p, inputFor(i, p), world, FIXED_DT);
  return p.x - x0;
}

// ── 平地：垂直能力 ────────────────────────────────────────────
{
  const shortRise = probeRise({
    world: FLAT, spawn: spawnGround,
    inputFor: (i) => mix({ jump: { held: i < 3, pressed: i === 0 } }),
  });
  record('短按跳', cells(shortRise), px(shortRise));
}

record('长按跳', cells(probeRise({
  world: FLAT, spawn: spawnGround,
  inputFor: (i) => mix({ jump: { held: i < 40, pressed: i === 0 } }),
})));

record('原地向上冲刺', cells(probeRise({
  world: FLAT, spawn: spawnGround,
  inputFor: (i) => mix({ moveY: -1, dash: { held: false, pressed: i === 0 } }),
})));

record('跳 → 顶点上冲', cells(probeRise({
  world: FLAT, spawn: spawnGround,
  inputFor: (i) => mix({
    moveY: -1,
    jump: { held: i < HOLD_FRAMES, pressed: i === 0 },
    dash: { held: false, pressed: i === HOLD_FRAMES + 2 },
  }),
})));

record('跳 → 起跳即上冲', cells(probeRise({
  world: FLAT, spawn: spawnGround,
  inputFor: (i) => mix({
    moveY: -1,
    jump: { held: i < 40, pressed: i === 0 },
    dash: { held: false, pressed: i === 1 },
  }),
})), '对照：过早冲会浪费跳跃速度');

// ── 平地：水平能力 ────────────────────────────────────────────
record('原地水平冲刺（含滑行）', cells(Math.abs(probeTravel({
  world: FLAT, spawn: spawnGround, preFrames: 20,
  inputFor: (i) => mix({ moveX: i < 6 ? 1 : 0, dash: { held: false, pressed: i === 0 } }),
  frames: 90,
}))));

// 满速助跑跳：必须测「起跳 → 落地」的真实滞空位移。
// 早先版本测的是「固定 0.5 秒内的位移」—— 而实际滞空只有 0.4 秒，
// 多出来的那 0.1 秒是落地之后的跑动。结果把 4.4 格报成了 5.5 格，
// 直接导致按错误标尺设计的关卡在实测中「差半格掉下去」。
{
  const p = createPlayer(spawnGround.x, spawnGround.y);
  for (let i = 0; i < 60; i++) updatePlayer(p, mix({ moveX: 1 }), FLAT, FIXED_DT);

  const x0 = p.x;
  let airFrames = 0;
  let leftGround = false;
  for (let i = 0; i < 300; i++) {
    updatePlayer(p, mix({ moveX: 1, jump: { held: i < HOLD_FRAMES, pressed: i === 0 } }), FLAT, FIXED_DT);
    if (!p.grounded) { leftGround = true; airFrames += 1; }
    else if (leftGround && i > 1) break;
  }
  record('满速助跑跳（起跳→落地）', cells(p.x - x0), `滞空 ${(airFrames * FIXED_DT).toFixed(2)}s`);
}

// ── 靠墙：垂直能力（「特别高的障碍物」的关键） ────────────────
const WALL_TX = 10;
const WALL = { isSolid: (tx, ty) => tx >= WALL_TX || ty >= GROUND_TY || tx < 0 || ty < 0 };
const SPAWN_AT_WALL = { x: WALL_TX * TILE - 30, y: GROUND_Y };

record('贴墙：跳 + 抓墙爬到力竭', cells(probeRise({
  world: WALL, spawn: SPAWN_AT_WALL,
  inputFor: (i) => mix({
    moveX: 1, moveY: -1,
    jump: { held: i < HOLD_FRAMES, pressed: i === 0 },
    grab: { held: i > 4 },
  }),
  frames: 600,
})), '不墙跳的纯攀爬');

{
  // 单面墙的真实上限：抓墙爬到力竭 → 墙跳 → 向上冲刺 → 再抓墙，如此循环。
  // 注意「墙跳后靠空气加速折返」是条死路：折返要 0.6s，而墙跳只给 0.96 格，
  // 还没飞回来就掉光了。唯一有效的循环必须借助冲刺（冲刺期间无重力）。
  let wallJumps = 0;
  let dashCount = 0;
  let pendingDash = false;

  const rise = probeRise({
    world: WALL, spawn: SPAWN_AT_WALL,
    inputFor: (i, p) => {
      if (p.grounded) {
        return mix({ moveX: 1, moveY: -1, jump: { held: true, pressed: true } });
      }

      const atWall = p.wallDir !== 0 && p.wallLock <= 0;

      if (atWall && p.stamina > 0.05) {
        // 还有耐力 → 贴着墙往上爬（最省力的上升方式）
        return mix({ moveX: 1, moveY: -1, grab: { held: true }, jump: { held: true } });
      }
      if (atWall) {
        // 力竭 → 墙跳脱离，顺便靠墙跳规则回满耐力与冲刺
        wallJumps += 1;
        pendingDash = true;
        return mix({ moveX: -1, moveY: -1, jump: { held: true, pressed: true } });
      }
      if (pendingDash && p.dashesLeft > 0) {
        // 墙跳之后立刻向上冲刺：冲刺无重力，能把墙跳的动能兑现成净上升
        pendingDash = false;
        dashCount += 1;
        return mix({ moveY: -1, dash: { held: false, pressed: true } });
      }
      // 其余时间朝墙飞回去
      return mix({ moveX: 1, moveY: -1, jump: { held: true } });
    },
    frames: 2400,
  });

  record('单面墙：爬→墙跳→上冲 循环', cells(rise), '墙跳 ' + wallJumps + ' 次，上冲 ' + dashCount + ' 次');
}

// ── 双面墙槽：交替墙跳 ────────────────────────────────────────
{
  const L = 10, R = 14;
  const SLOT = { isSolid: (tx, ty) => tx <= L || tx >= R || ty >= GROUND_TY || tx < 0 || ty < 0 };
  const spawnSlot = { x: (L + 1) * TILE + 4, y: GROUND_Y };

  let wallJumps = 0;
  let aim = 1;
  const rise = probeRise({
    world: SLOT, spawn: spawnSlot,
    inputFor: (i, p) => {
      if (p.grounded) {
        return mix({ moveX: 1, jump: { held: false, pressed: i > 40 && i % 14 === 0 } });
      }
      const dir = p.wallDir;
      if (dir !== 0 && p.wallLock <= 0) {
        aim = -dir;
        wallJumps += 1;
        return mix({ moveX: aim, jump: { held: true, pressed: true } });
      }
      return mix({ moveX: aim, jump: { held: true } });
    },
    frames: 1500,
  });
  record('双面墙：交替墙跳', cells(rise), '触发 ' + wallJumps + ' 次墙跳');
}

// ── 输出 ─────────────────────────────────────────────────────
const w = Math.max(...results.map((r) => r.name.length)) + 2;
process.stdout.write('\n\x1b[1m玩家能力探针\x1b[0m   TILE=' + TILE + '  物理 ' + (1 / FIXED_DT).toFixed(0) + 'Hz\n');
process.stdout.write('─'.repeat(w + 42) + '\n');
for (const r of results) {
  process.stdout.write('  ' + r.name.padEnd(w) + '\x1b[36m' + r.value.padEnd(10) + '\x1b[0m' + r.note + '\n');
}

/** 不借助墙面的垂直手段，取其中最高者 = 无墙环境的天花板。 */
const OFF_WALL = ['短按跳', '长按跳', '原地向上冲刺', '跳 → 顶点上冲', '跳 → 起跳即上冲'];
const vertical = Math.max(
  ...results.filter((r) => OFF_WALL.includes(r.name)).map((r) => parseFloat(r.value)),
);

process.stdout.write('\n\x1b[38;5;245m理论参考：JUMP_APEX=' + JUMP_APEX.toFixed(1) + 'u   DASH_REACH=' +
  DASH_REACH.toFixed(1) + 'u   CLIMB_REACH=' + CLIMB_REACH.toFixed(1) + 'u\x1b[0m\n');
process.stdout.write('\x1b[33m▸ 离墙垂直天花板：' + vertical.toFixed(2) +
  ' 格（无墙可借时，高于它的障碍物无法通过）\x1b[0m\n\n');
