/**
 * 机关实体：创建、时间推进、几何查询。
 *
 * 纯逻辑，不依赖 DOM / Canvas，可在 Node 裸跑。
 *
 * 六种实体：
 *   spike     方向尖刺（静态，来自字符网格）
 *   laser     周期激光（开启前有预警）
 *   platform  线性往返平台（会携带玩家）
 *   bounce    弹跳板（大跳 + 重置冲刺）
 *   crumble   崩塌地块（踩上后延时消失，再恢复）
 *   portal    成对传送门（保留动量）
 *
 * ★ 时间推进是「纯函数式」的：给定 time 就能算出状态，不依赖上一帧。
 *   这样测试可以任意跳转时间（比如直接跳到周期中点）来验证时序，
 *   而不需要「跑满一个周期再看」——测试既快又不受帧率影响。
 *   唯一的例外是平台速度，它需要上一帧位置才能求出。
 */

import { TILE, CFG } from './config.js';

export const ENTITY = {
  SPIKE: 'spike',
  LASER: 'laser',
  PLATFORM: 'platform',
  BOUNCE: 'bounce',
  CRUMBLE: 'crumble',
  PORTAL: 'portal',
};

export const CRUMBLE_STATE = { IDLE: 'idle', SHAKING: 'shaking', GONE: 'gone' };

/** 把任意实数折到 [0, 1)，用于周期计算（负数也正确）。 */
function wrap01(v) {
  const f = v % 1;
  return f < 0 ? f + 1 : f;
}

const tile = (n) => n * TILE;

// ─────────────────────────────────────────────────────────────
// 创建
// ─────────────────────────────────────────────────────────────

function createLaser(def, id) {
  return {
    id,
    kind: ENTITY.LASER,
    x0: tile(def.from.x) + TILE / 2,
    y0: tile(def.from.y) + TILE / 2,
    x1: tile(def.to.x) + TILE / 2,
    y1: tile(def.to.y) + TILE / 2,
    thickness: def.thickness || 3.5,
    period: def.period || 2,
    phase: def.phase || 0,
    duty: def.duty === undefined ? 0.55 : def.duty,
    on: false,
    warn: false,
  };
}

function createPlatform(def, id) {
  const w = (def.w || 2) * TILE;
  const h = def.h ? def.h * TILE : TILE * 0.55;
  const fromX = tile(def.from.x);
  const fromY = tile(def.from.y);
  return {
    id,
    kind: ENTITY.PLATFORM,
    fromX, fromY,
    toX: tile(def.to.x),
    toY: tile(def.to.y),
    period: def.period || 3,
    phase: def.phase || 0,
    w, h,
    x: fromX,
    y: fromY,
    px: fromX,
    py: fromY,
    vx: 0,
    vy: 0,
  };
}

function createBounce(def, id) {
  return {
    id,
    kind: ENTITY.BOUNCE,
    x: tile(def.at.x),
    y: tile(def.at.y) + TILE * 0.6,
    w: (def.w || 1) * TILE,
    h: TILE * 0.4,
    cooldown: 0,
  };
}

function createCrumble(def, id) {
  return {
    id,
    kind: ENTITY.CRUMBLE,
    tx: def.at.x,
    ty: def.at.y,
    tw: def.w || 1,
    state: CRUMBLE_STATE.IDLE,
    timer: 0,
  };
}

function createPortal(def, id) {
  return {
    id,
    kind: ENTITY.PORTAL,
    tag: def.tag || 'a',
    ax: tile(def.at.x) + TILE / 2,
    ay: tile(def.at.y) + TILE / 2,
    bx: tile(def.to.x) + TILE / 2,
    by: tile(def.to.y) + TILE / 2,
    cooldown: 0,
  };
}

/**
 * 从世界解析出实体列表。
 * 尖刺来自字符网格，其余来自 level.entities。
 */
export function createEntities(world) {
  const list = [];
  let nextId = 1;

  for (const s of world.spikes) {
    list.push({ id: nextId++, kind: ENTITY.SPIKE, tx: s.tx, ty: s.ty, dir: s.dir });
  }

  for (const def of world.entities) {
    switch (def.type) {
      case 'laser': list.push(createLaser(def, nextId++)); break;
      case 'platform': list.push(createPlatform(def, nextId++)); break;
      case 'bounce': list.push(createBounce(def, nextId++)); break;
      case 'crumble': list.push(createCrumble(def, nextId++)); break;
      case 'portal': list.push(createPortal(def, nextId++)); break;
      default: break;
    }
  }

  return { list, time: 0 };
}

// ─────────────────────────────────────────────────────────────
// 时间推进
// ─────────────────────────────────────────────────────────────

function updateLaser(e, time) {
  const t = wrap01(time / e.period + e.phase);
  e.on = t < e.duty;
  // 关闭期的末端是预警窗：危险必须可预告，否则就是不可归因的死亡
  const warnStart = 1 - CFG.laserWarn / e.period;
  e.warn = !e.on && t >= warnStart;
}

function updatePlatform(e, time, dt) {
  const t = wrap01(time / e.period + e.phase);
  const k = t < 0.5 ? t * 2 : (1 - t) * 2;         // 三角波：0 → 1 → 0
  const nx = e.fromX + (e.toX - e.fromX) * k;
  const ny = e.fromY + (e.toY - e.fromY) * k;
  e.px = e.x; e.py = e.y;
  e.vx = dt > 0 ? (nx - e.x) / dt : 0;
  e.vy = dt > 0 ? (ny - e.y) / dt : 0;
  e.x = nx; e.y = ny;
}

function updateCrumble(e, dt, world) {
  if (e.state === CRUMBLE_STATE.SHAKING) {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = CRUMBLE_STATE.GONE;
      e.timer = CFG.crumbleRespawn;
    }
  } else if (e.state === CRUMBLE_STATE.GONE) {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = CRUMBLE_STATE.IDLE;
      e.timer = 0;
    }
  }
  // 只有 idle / shaking 是实心；gone 期间把格子让出来
  if (e.state !== CRUMBLE_STATE.GONE) {
    for (let i = 0; i < e.tw; i++) world.setDynamicSolid(e.tx + i, e.ty, true);
  }
}

/** 踩上崩塌地块。已经崩塌中或已消失时不重复触发。 */
export function triggerCrumble(e) {
  if (e.state !== CRUMBLE_STATE.IDLE) return false;
  e.state = CRUMBLE_STATE.SHAKING;
  e.timer = CFG.crumbleShake;
  return true;
}

export function updateEntities(ents, world, dt) {
  ents.time += dt;
  // 动态实心层每帧整表重建 —— 见 world.js 里对 dynamic 的说明
  world.clearDynamicSolid();

  for (const e of ents.list) {
    switch (e.kind) {
      case ENTITY.LASER: updateLaser(e, ents.time); break;
      case ENTITY.PLATFORM: updatePlatform(e, ents.time, dt); break;
      case ENTITY.CRUMBLE: updateCrumble(e, dt, world); break;
      case ENTITY.BOUNCE: if (e.cooldown > 0) e.cooldown = Math.max(0, e.cooldown - dt); break;
      case ENTITY.PORTAL: if (e.cooldown > 0) e.cooldown = Math.max(0, e.cooldown - dt); break;
      default: break;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 几何查询
// ─────────────────────────────────────────────────────────────

/** 尖刺的**致命判定框**。
 *
 *  取等腰三角形的**最大内切矩形**（宽高各为格子的一半），
 *  这样判定框严格落在视觉体积之内，绝不会出现「看着没碰到却死了」。
 *
 *  注意不能简单地把整个格子内缩一点了事：尖刺是三角形，
 *  靠近尖端处视觉宽度趋近于 0，而矩形判定框不会 —— 那会造成不可归因的死亡。
 *  这是「死亡必可归因」这条红线在代码里的具体落点。 */
export function spikeHitbox(e) {
  const q = TILE * 0.25;
  const half = TILE - q * 2;
  const bx = e.tx * TILE;
  const by = e.ty * TILE;

  if (e.dir.y === 1) return { x: bx + q, y: by + q * 2, w: half, h: half };       // ^ 底座在下
  if (e.dir.y === -1) return { x: bx + q, y: by, w: half, h: half };              // v 底座在上
  if (e.dir.x === 1) return { x: bx + q * 2, y: by + q, w: half, h: half };       // < 底座在右
  return { x: bx, y: by + q, w: half, h: half };                                  // > 底座在左
}

export function laserBox(e) {
  const t = e.thickness;
  return {
    x: Math.min(e.x0, e.x1) - t / 2,
    y: Math.min(e.y0, e.y1) - t / 2,
    w: Math.abs(e.x1 - e.x0) + t,
    h: Math.abs(e.y1 - e.y0) + t,
  };
}

export function platformBox(e) {
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

export function bounceBox(e) {
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

/** 传送门的两个端口各自一个圆，用方形包围盒近似即可（判定用的是圆心距）。 */
export function portalBox(e, end) {
  const cx = end === 'b' ? e.bx : e.ax;
  const cy = end === 'b' ? e.by : e.ay;
  const r = TILE * 1.1;
  return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
}

export function portalCenter(e, end) {
  return end === 'b' ? { x: e.bx, y: e.by } : { x: e.ax, y: e.ay };
}

/** 崩塌地块占用的格范围（用于渲染与触发判定）。 */
export function crumbleTiles(e) {
  const out = [];
  for (let i = 0; i < e.tw; i++) {
    out.push({ tx: e.tx + i, ty: e.ty });
  }
  return out;
}

/**
 * 把关卡内所有机关恢复到初始状态（崩塌地块复位、弹跳板/传送冷却清零）。
 * 关卡重开与考区跳转都要走这里 —— 放在 entities.js 是因为
 * 「机关的状态」本来就只有这里知道，散落到场景层就会出现两处各写一半的修复。
 */
export function resetEntities(ents, world) {
  ents.time = 0;
  world.clearDynamicSolid();
  for (const e of ents.list) {
    if (e.kind === ENTITY.CRUMBLE) {
      e.state = CRUMBLE_STATE.IDLE;
      e.timer = 0;
    } else if (e.kind === ENTITY.BOUNCE || e.kind === ENTITY.PORTAL) {
      e.cooldown = 0;
    }
  }
}
