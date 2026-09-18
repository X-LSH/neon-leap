/**
 * 物理求解。纯函数，不依赖 DOM / Canvas —— 这是 `verify.mjs` 能在 Node 裸跑的前提。
 *
 * 策略：分轴推进（先 X 后 Y），每轴内部再按 TILE/2 拆成子步。
 * 之所以不写完整的扫掠 AABB，是因为本作最高速度（460 u/s）
 * 在 1/120s 步长下单步位移仅 3.83 单位，远小于一格（15），
 * 子步分解已足够杜绝穿透 —— 简单且可证明正确。
 */

import { TILE } from './config.js';

/** 浮点比较容差。 */
const EPS = 1e-6;

/** 探针外扩量：让「贴着地面」在浮点误差下依然成立。 */
const PROBE = 0.5;

function moveXOnce(body, dx, world) {
  body.x += dx;

  const y0 = Math.floor((body.y + EPS) / TILE);
  const y1 = Math.floor((body.y + body.h - EPS) / TILE);

  if (dx > 0) {
    const tx = Math.floor((body.x + body.w - EPS) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (world.isSolid(tx, ty)) {
        body.x = tx * TILE - body.w;
        return 1;
      }
    }
  } else {
    const tx = Math.floor((body.x + EPS) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (world.isSolid(tx, ty)) {
        body.x = (tx + 1) * TILE;
        return -1;
      }
    }
  }
  return 0;
}

function moveYOnce(body, dy, world) {
  body.y += dy;

  const x0 = Math.floor((body.x + EPS) / TILE);
  const x1 = Math.floor((body.x + body.w - EPS) / TILE);

  if (dy > 0) {
    const ty = Math.floor((body.y + body.h - EPS) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (world.isSolid(tx, ty)) {
        body.y = ty * TILE - body.h;
        return 1;
      }
    }
  } else {
    const ty = Math.floor((body.y + EPS) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (world.isSolid(tx, ty)) {
        body.y = (ty + 1) * TILE;
        return -1;
      }
    }
  }
  return 0;
}

/**
 * 水平推进并解算碰撞。
 * @returns {0|1|-1} 0 未碰撞，1 撞右墙，-1 撞左墙
 */
export function moveX(body, dx, world) {
  if (dx === 0) return 0;
  const steps = Math.ceil(Math.abs(dx) / (TILE * 0.5)) || 1;
  const d = dx / steps;
  for (let i = 0; i < steps; i++) {
    const hit = moveXOnce(body, d, world);
    if (hit !== 0) return hit;
  }
  return 0;
}

/**
 * 垂直推进并解算碰撞。
 * @returns {0|1|-1} 0 未碰撞，1 落地，-1 撞头
 */
export function moveY(body, dy, world) {
  if (dy === 0) return 0;
  const steps = Math.ceil(Math.abs(dy) / (TILE * 0.5)) || 1;
  const d = dy / steps;
  for (let i = 0; i < steps; i++) {
    const hit = moveYOnce(body, d, world);
    if (hit !== 0) return hit;
  }
  return 0;
}

/** 脚下是否有实心格（带 PROBE 容差，形成自然的「地面吸附」）。 */
export function onGround(body, world) {
  const ty = Math.floor((body.y + body.h + PROBE) / TILE);
  const x0 = Math.floor((body.x + EPS) / TILE);
  const x1 = Math.floor((body.x + body.w - EPS) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    if (world.isSolid(tx, ty)) return true;
  }
  return false;
}

/** 指定方向是否贴着墙。dir = 1 右，-1 左。 */
export function touchingWall(body, dir, world) {
  const tx = dir > 0
    ? Math.floor((body.x + body.w + PROBE) / TILE)
    : Math.floor((body.x - PROBE) / TILE);
  const y0 = Math.floor((body.y + EPS) / TILE);
  const y1 = Math.floor((body.y + body.h - EPS) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    if (world.isSolid(tx, ty)) return true;
  }
  return false;
}

/** 头顶是否撞到实心格。 */
export function headBlocked(body, world) {
  const ty = Math.floor((body.y - PROBE) / TILE);
  const x0 = Math.floor((body.x + EPS) / TILE);
  const x1 = Math.floor((body.x + body.w - EPS) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    if (world.isSolid(tx, ty)) return true;
  }
  return false;
}

/**
 * 玩家是否已爬到**墙沿**：贴着墙，且头顶已经到达（或高于）墙顶。
 *
 * ★ 这是「翻越（mantle）」的触发条件 —— 也是**抓墙这个动词最容易漏掉的边界情形**。
 *
 * ⚠️ 判据必须用「头顶到达墙顶」，**不能用「脚下方没有墙」**。
 *    后者要求玩家整个人升到墙顶之上才成立，而墙越高、玩家爬得越低，
 *    这个条件就越晚满足 —— 我在 7 格高的墙上实测：它要玩家爬到 10.2 格，
 *    而耐力只够爬到 13 格。**触发条件被设在了玩家够不到的地方**，翻越永远不触发。
 *
 * 用「头顶到达墙顶」则是玩家真正需要帮助的那一刻：
 * 再往上爬一步墙就消失了，而那时他恰好悬在墙沿外侧。
 */
export function atLedge(body, dir, world) {
  if (!touchingWall(body, dir, world)) return false;

  const x = dir > 0 ? body.x + body.w + PROBE : body.x - PROBE;
  const tx = Math.floor(x / TILE);

  // 从玩家头部所在格向上找这面墙的顶端
  let top = Math.floor((body.y + EPS) / TILE);
  while (top > 0 && world.isSolid(tx, top - 1)) top -= 1;

  return body.y <= top * TILE + 2;
}

/** 两轴 AABB 相交判定（用于危险物判定，Phase 2 使用）。 */
export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
