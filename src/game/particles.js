/**
 * 粒子系统与视觉反馈。
 *
 * ★ 两个硬约束：
 *
 *   1. **固定容量对象池（400）。** 用 TypedArray 预分配，热路径零对象分配。
 *      V8 里一个小对象占 40+ 字节，每帧 spawn 20 个就是 48KB/秒的垃圾 ——
 *      GC 抖动是低端设备掉帧的头号杀手，而它只会间歇性发作，极难定位。
 *
 *   2. **确定性随机。** 粒子形态用 PRNG 而不是 Math.random，
 *      这样「通关录像重放」时画面也完全一致，可以逐帧比对。
 *      粒子不影响物理，但影响「这段录像看起来对不对」。
 *
 * 溢出策略：**环形覆盖最旧的**。宁可丢掉最老的粒子，也不让池子增长 ——
 * 一次容量泄漏在低端设备上就是永久性的帧率下跌。
 */

import { createRng } from '../core/loop.js';

export const KIND = {
  DUST: 0,     // 落地 / 起跳的尘土
  SPARK: 1,    // 冲刺 / 墙滑的火花（沿速度方向的短线）
  GHOST: 2,    // 冲刺残影（玩家轮廓）
  BURST: 3,    // 死亡爆散
  RING: 4,     // 落地冲击环
  RIPPLE: 5,   // 传送门涟漪
};

export const COLOR = { PLAYER: 0, DANGER: 1, PORTAL: 2, BOUNCE: 3 };

export function createParticles({ capacity = 400 } = {}) {
  return {
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    grav: new Float32Array(capacity),
    life: new Float32Array(capacity),
    maxLife: new Float32Array(capacity),
    size: new Float32Array(capacity),
    kind: new Uint8Array(capacity),
    color: new Uint8Array(capacity),
    head: 0,
    total: 0,                        // 累计 spawn 次数（调试与断言用）
    rng: createRng(0x5eed1234),
  };
}

const rand = (p, a, b) => a + (b - a) * p.rng();

/** 写入一个粒子。环形推进：满了就覆盖最旧的那个。 */
function put(p, kind, color, x, y, vx, vy, life, size, grav) {
  const i = p.head;
  p.head = (p.head + 1) % p.capacity;
  p.kind[i] = kind;
  p.color[i] = color;
  p.x[i] = x;
  p.y[i] = y;
  p.vx[i] = vx;
  p.vy[i] = vy;
  p.grav[i] = grav;
  p.life[i] = life;
  p.maxLife[i] = life;
  p.size[i] = size;
  p.total += 1;
  return i;
}

// ─────────────────────────────────────────────────────────────
// 各种效果的发射器。调用方只关心「发生了什么」，不关心参数。
// ─────────────────────────────────────────────────────────────

/** 落地 / 起跳的尘土：向两侧上方散开，受重力落回。 */
export function burstDust(p, x, y, strength = 1, count = 7) {
  for (let i = 0; i < count; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    put(p, KIND.DUST, COLOR.PLAYER,
      x + rand(p, -3, 3), y,
      dir * rand(p, 10, 38) * strength,
      -rand(p, 8, 30) * strength,
      rand(p, 0.16, 0.34),
      rand(p, 1.0, 2.2),
      110);
  }
}

/** 冲刺火花：沿冲刺**反方向**喷射的短线。 */
export function burstSparks(p, x, y, dirX, dirY, count = 9) {
  const base = Math.atan2(dirY, dirX) + Math.PI;
  for (let i = 0; i < count; i++) {
    const a = base + rand(p, -0.55, 0.55);
    const sp = rand(p, 100, 260);
    put(p, KIND.SPARK, COLOR.PLAYER,
      x, y,
      Math.cos(a) * sp, Math.sin(a) * sp,
      rand(p, 0.10, 0.22),
      rand(p, 1.2, 2.8),
      0);
  }
}

/** 冲刺残影：留在原地、快速淡出的玩家轮廓。 */
export function spawnGhost(p, x, y, w) {
  put(p, KIND.GHOST, COLOR.PLAYER, x, y, 0, 0, 0.26, w, 0);
}

/** 死亡爆散：放射状。 */
export function burstDeath(p, x, y, count = 26) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(p, -0.16, 0.16);
    const sp = rand(p, 70, 230);
    put(p, KIND.BURST, COLOR.DANGER,
      x, y,
      Math.cos(a) * sp, Math.sin(a) * sp,
      rand(p, 0.30, 0.65),
      rand(p, 1.4, 3.0),
      200);
  }
}

/** 落地冲击环：一圈向外扩散的圆环。 */
export function spawnRing(p, x, y, danger = false) {
  put(p, KIND.RING, danger ? COLOR.DANGER : COLOR.PLAYER, x, y, 0, 0, 0.30, 7, 0);
}

/** 传送涟漪。 */
export function spawnRipple(p, x, y, color = COLOR.PORTAL) {
  put(p, KIND.RIPPLE, color, x, y, 0, 0, 0.42, 9, 0);
}

/** 墙滑火星：贴着墙面持续掉落。 */
export function spawnWallSpark(p, x, y, wallDir) {
  put(p, KIND.SPARK, COLOR.PLAYER,
    x, y,
    -wallDir * rand(p, 6, 34),
    rand(p, 12, 60),
    rand(p, 0.12, 0.26),
    rand(p, 1.0, 2.0),
    90);
}

/** 弹跳板：向上的爆发。 */
export function burstBounce(p, x, y, count = 14) {
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + rand(p, -0.9, 0.9);
    const sp = rand(p, 60, 190);
    put(p, KIND.SPARK, COLOR.BOUNCE,
      x, y,
      Math.cos(a) * sp, Math.sin(a) * sp,
      rand(p, 0.18, 0.40),
      rand(p, 1.2, 2.4),
      120);
  }
}

// ─────────────────────────────────────────────────────────────
// 推进与查询
// ─────────────────────────────────────────────────────────────

export function updateParticles(p, dt) {
  for (let i = 0; i < p.capacity; i++) {
    const l = p.life[i];
    if (l <= 0) continue;

    const next = l - dt;
    p.life[i] = next;
    if (next <= 0) continue;      // 这一步刚死，不再积分

    p.x[i] += p.vx[i] * dt;
    p.y[i] += p.vy[i] * dt;
    p.vy[i] += p.grav[i] * dt;
  }
}

/** 当前存活粒子数。用于调试面板与断言。 */
export function liveCount(p) {
  let n = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (p.life[i] > 0) n += 1;
  }
  return n;
}

export function clearParticles(p) {
  p.life.fill(0);
  p.head = 0;
}
