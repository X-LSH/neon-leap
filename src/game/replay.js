/**
 * 可解性验证：用确定性策略重放关卡，断言玩家能抵达出口。
 *
 * ★ 为什么需要它
 *
 * 平台跳跃的状态空间是连续的（位置和速度都是浮点），
 * 没法像华容道那样用 BFS 枚举状态来证明「这关有解」。
 * 替代方案是「录一段通关过程，重放它，断言抵达出口」——
 * 而**这个方案能成立的前提是物理完全确定性**：
 * 固定步长 + 全程禁用 Math.random()。这两件事从第一天就守住了
 * （见 core/loop.js 的 createRng），当时的取舍在这里兑现。
 *
 * ★ 为什么用「策略」而不是「精确录像」
 *
 * 精确录像（逐帧输入）对时序极度敏感：0.01 秒的偏差就足以让跳跃落点差半格，
 * 于是每改一次关卡参数、每调一条手感常量，15 段录像全部作废要重录。
 * 那种维护成本会让人最终选择「不验证」。
 *
 * 策略的语义是「**现在按着哪些键**」，按下与松开的边沿由框架自己 diff 出来。
 * 它同样是「存在一条通关路径」的构造性证明，
 * 但对时序的容错高得多 —— 因为它读的是世界状态，不是死记的时间点。
 * 而且它是**可读的**：直接就能看出「这一关是怎么过的」。
 */

import { TILE, FIXED_DT } from './config.js';
import { createPlayer, updatePlayer } from './player.js';
import { createEntities, updateEntities } from './entities.js';
import { resolveInteractions, makePlatformGroundCheck } from './interact.js';

/** 把秒换算成帧数。写策略时用秒更直观。 */
export const sec = (s) => Math.round(s / FIXED_DT);

/**
 * 给策略用的世界感知工具。
 * 策略不该直接啃 world 的位图 —— 那会让每关的策略都写得很啰嗦。
 */
export function makeContext(world, ents) {
  const solid = (tx, ty) => world.isSolid(tx, ty);

  return {
    solid,
    tileOf: (v) => Math.floor(v / TILE),

    /** 关卡出口的格子坐标。 */
    exit: world.exit ? { tx: world.exit.tx, ty: world.exit.ty } : null,

    /** 玩家中心到出口中心的水平距离（世界单位，右为正）。 */
    exitDx(p) {
      if (!world.exit) return 0;
      return (world.exit.tx * TILE + TILE / 2) - (p.x + p.w / 2);
    },

    /**
     * 脚下往前探：返回**第一处空洞**的偏移格数；一路都是地面则返回 Infinity。
     * 这是「前方有坑」最直接的问法。
     */
    gapAhead(p, maxCells = 5) {
      const ty = Math.floor((p.y + p.h + 2) / TILE);
      const start = Math.floor((p.x + p.w) / TILE);
      for (let i = 0; i < maxCells; i++) {
        if (!solid(start + i, ty)) return i;
      }
      return Infinity;
    },

    /**
     * 下一个坑的**宽度**（格）；前方没有坑返回 0。
     * 有了它，策略才能回答「这个坑需不需要冲刺」——
     * 而不是把所有坑都当成同一种障碍。
     */
    gapWidth(p, maxCells = 10) {
      const ty = Math.floor((p.y + p.h + 2) / TILE);
      const start = Math.floor((p.x + p.w) / TILE);

      let i = 0;
      while (i < maxCells && solid(start + i, ty)) i += 1;
      if (i >= maxCells) return 0;

      let w = 0;
      while (w < maxCells && !solid(start + i + w, ty)) w += 1;
      return w;
    },

    /** 前方是否有一堵高度 ≥ minCells 的墙，返回遇到的第一个距离（格）或 Infinity。 */
    wallAhead(p, minCells = 1, maxCells = 5) {
      const ty0 = Math.floor((p.y + p.h - 1) / TILE);
      const start = Math.floor((p.x + p.w) / TILE);
      for (let i = 0; i < maxCells; i++) {
        let h = 0;
        for (let k = 0; k < minCells + 1; k++) {
          if (solid(start + i, ty0 - k)) h += 1;
        }
        if (h >= minCells) return i;
      }
      return Infinity;
    },

    /** 头顶是否被挡住（用于判断能不能起跳）。 */
    ceilingAbove(p, cells = 2) {
      const ty = Math.floor(p.y / TILE);
      const x0 = Math.floor(p.x / TILE);
      const x1 = Math.floor((p.x + p.w - 1) / TILE);
      for (let k = 1; k <= cells; k++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (solid(tx, ty - k)) return true;
        }
      }
      return false;
    },
  };
}

/** 把「当前按住的键」转成带边沿的意图对象。 */
function toIntent(keys, prevKeys) {
  const has = (k) => keys.includes(k);
  return {
    moveX: (has('right') ? 1 : 0) - (has('left') ? 1 : 0),
    moveY: (has('down') ? 1 : 0) - (has('up') ? 1 : 0),
    jump: { held: has('jump'), pressed: has('jump') && !prevKeys.includes('jump') },
    dash: { held: has('dash'), pressed: has('dash') && !prevKeys.includes('dash') },
    grab: { held: has('grab'), pressed: has('grab') && !prevKeys.includes('grab') },
  };
}

/** 玩家是否与出口格重叠。 */
export function atExit(p, world) {
  if (!world.exit) return false;
  const ex = world.exit.tx * TILE;
  const ey = world.exit.ty * TILE;
  return p.x < ex + TILE && p.x + p.w > ex && p.y < ey + TILE && p.y + p.h > ey;
}

function snapshot(i, p) {
  return {
    f: i,
    t: +(i * FIXED_DT).toFixed(2),
    x: +p.x.toFixed(1),
    y: +p.y.toFixed(1),
    vx: Math.round(p.vx),
    vy: Math.round(p.vy),
    st: p.state,
    g: p.grounded,
  };
}

/**
 * 用一段策略重放关卡。
 *
 * @param {object} world createWorld() 的产物
 * @param {(p:object, ctx:object)=>string[]} policy 返回「当前按住的键名数组」
 * @param {{maxFrames?:number, trace?:boolean|number}} [opts]
 * @returns {{ok:boolean, reason:string, frames:number, timeSec:number, trace:Array}}
 */
export function playPolicy(world, policy, opts = {}) {
  const maxFrames = opts.maxFrames || sec(60);
  const traceEvery = opts.trace === true ? 12 : (opts.trace | 0);

  const ents = createEntities(world);
  const groundCheck = makePlatformGroundCheck(ents);
  const ctx = makeContext(world, ents);
  const p = createPlayer(world.spawn.x * TILE, world.spawn.y * TILE);
  const trace = [];

  let prevKeys = [];

  for (let i = 0; i < maxFrames; i++) {
    updateEntities(ents, world, FIXED_DT);

    const keys = policy(p, ctx) || [];
    updatePlayer(p, toIntent(keys, prevKeys), world, FIXED_DT, groundCheck);
    prevKeys = keys;

    const hit = resolveInteractions(p, ents);

    if (traceEvery > 0 && i % traceEvery === 0) trace.push(snapshot(i, p));

    if (hit.killed) {
      trace.push(snapshot(i, p));
      return { ok: false, reason: `killed:${hit.cause}`, frames: i, timeSec: i * FIXED_DT, trace };
    }
    if (p.y > world.worldH + 60) {
      trace.push(snapshot(i, p));
      return { ok: false, reason: 'fell', frames: i, timeSec: i * FIXED_DT, trace };
    }
    if (atExit(p, world)) {
      trace.push(snapshot(i, p));
      return { ok: true, reason: 'exit', frames: i, timeSec: i * FIXED_DT, trace };
    }
  }

  trace.push(snapshot(maxFrames - 1, p));
  return { ok: false, reason: 'timeout', frames: maxFrames, timeSec: maxFrames * FIXED_DT, trace };
}

/** 关卡是否配了可解性策略。 */
export function hasPolicy(level) {
  return typeof level.solution === 'function';
}
