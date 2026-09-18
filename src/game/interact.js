/**
 * 玩家与机关的交互。纯逻辑，不依赖 DOM / Canvas。
 *
 * 这里最容易出 bug 的地方是**时序**，不是公式：
 *   - 平台先移动，玩家后物理，最后才修正 —— 顺序错了就会被甩飞或穿模。
 *   - 「是否站在平台上」必须用**上一帧**的位置判断，
 *     否则平台移动后玩家已经悬空，判定自然失败。
 *
 * 三条不变式：
 *   1. 携带速度：站在平台上的玩家必须跟着平台走，而不是被平台甩下。
 *   2. 动量守恒：穿过传送门不改变速度矢量。
 *   3. 死亡可归因：所有致命判定框都**不大于**对应机关的视觉体积。
 */

import { CFG, TILE } from './config.js';
import { overlaps } from './physics.js';
import {
  ENTITY, spikeHitbox, laserBox, platformBox, bounceBox,
  portalCenter, triggerCrumble,
} from './entities.js';

/** 判定盒内缩量：让玩家在「视觉上没碰到」时不会被判死。 */
const HURT_INSET = 1.5;

function playerBox(p) {
  return { x: p.x + HURT_INSET, y: p.y + HURT_INSET, w: p.w - HURT_INSET * 2, h: p.h - HURT_INSET * 2 };
}

function playerCenter(p) {
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

/**
 * 生成一个「脚下是否有平台」的回调，供 updatePlayer 使用。
 * 平台刻意不写进 world.isSolid —— 那样会变成实心墙，玩家从下方跳不上去。
 * 它必须是**单向**的：只能从上面站住。
 */
export function makePlatformGroundCheck(ents) {
  return (p) => {
    const feet = p.y + p.h;
    for (const e of ents.list) {
      if (e.kind !== ENTITY.PLATFORM) continue;
      if (feet < e.y - 1 || feet > e.y + 4) continue;
      if (p.x + p.w <= e.x + 1 || p.x >= e.x + e.w - 1) continue;
      return true;
    }
    return false;
  };
}

/** 平台携带：用**上一帧**的站位判断，再按平台位移平移玩家。 */
function carryByPlatforms(p, ents) {
  for (const e of ents.list) {
    if (e.kind !== ENTITY.PLATFORM) continue;
    const wasStanding =
      Math.abs((p.prevY + p.h) - e.py) <= 2.5 &&
      p.prevX + p.w > e.px + 1 &&
      p.prevX < e.px + e.w - 1;
    if (!wasStanding) continue;

    p.x += e.x - e.px;
    p.y += e.y - e.py;
    p.prevX += e.x - e.px;
    p.prevY += e.y - e.py;
  }
}

/** 从上方落到平台顶面的吸附（平台在下落路径上时把玩家接住）。 */
function snapToPlatforms(p, ents) {
  for (const e of ents.list) {
    if (e.kind !== ENTITY.PLATFORM) continue;
    const box = platformBox(e);
    if (p.vy < 0) continue;
    if (p.x + p.w <= box.x + 1 || p.x >= box.x + box.w - 1) continue;

    const feet = p.y + p.h;
    // 这一帧的脚越过了顶面，且上一帧还在上方 —— 才算「落上去」
    if (feet >= box.y && feet <= box.y + box.h + 6) {
      p.y = box.y - p.h;
      p.vy = 0;
      p.grounded = true;
      p.dashesLeft = 1;
      p.stamina = CFG.climbStamina;
    }
  }
}

function stepOnBounce(p, e, events) {
  if (e.cooldown > 0 || p.vy < 0) return;
  const box = bounceBox(e);
  const feet = p.y + p.h;
  if (p.x + p.w <= box.x + 1 || p.x >= box.x + box.w - 1) return;
  if (feet < box.y || feet > box.y + box.h + 5) return;

  p.y = box.y - p.h;
  p.vy = CFG.bounceSpeed;
  p.jumpHeld = 0;               // 弹跳板高度不受长按影响，是确定的
  p.dashesLeft = 1;
  p.stamina = CFG.climbStamina;
  p.grounded = false;
  p.coyote = 0;
  p.justJumped = true;
  e.cooldown = 0.2;
  events.push({ type: 'bounce', id: e.id });
}

function stepOnCrumble(p, e, events) {
  const bx = e.tx * TILE;
  const bw = e.tw * TILE;
  const by = e.ty * TILE;
  if (p.x + p.w <= bx || p.x >= bx + bw) return;
  if (p.y + p.h <= by || p.y >= by + TILE) return;
  if (triggerCrumble(e)) events.push({ type: 'crumble', id: e.id });
}

function usePortal(p, e, events) {
  if (e.cooldown > 0) return;
  const c = playerCenter(p);
  const r = TILE * 0.85;

  const ends = [
    { from: portalCenter(e, 'a'), to: portalCenter(e, 'b') },
    { from: portalCenter(e, 'b'), to: portalCenter(e, 'a') },
  ];

  for (const end of ends) {
    const dx = c.x - end.from.x;
    const dy = c.y - end.from.y;
    if (dx * dx + dy * dy > r * r) continue;

    // 动量守恒：只搬运位置，速度矢量原封不动
    p.x = end.to.x - p.w / 2;
    p.y = end.to.y - p.h / 2;
    p.prevX = p.x;
    p.prevY = p.y;
    e.cooldown = CFG.portalCooldown;
    events.push({ type: 'portal', id: e.id });
    return;
  }
}

/**
 * 解算本帧玩家与全部机关的交互。
 * 必须在 updatePlayer **之后**调用。
 *
 * @returns {{killed:boolean, cause:('spike'|'laser'|null), events:Array}}
 */
export function resolveInteractions(p, ents) {
  const events = [];

  if (!p.dead) {
    carryByPlatforms(p, ents);
    snapToPlatforms(p, ents);

    for (const e of ents.list) {
      if (e.kind === ENTITY.BOUNCE) stepOnBounce(p, e, events);
      else if (e.kind === ENTITY.CRUMBLE) stepOnCrumble(p, e, events);
      else if (e.kind === ENTITY.PORTAL) usePortal(p, e, events);
    }

    const hurt = playerBox(p);
    for (const e of ents.list) {
      if (e.kind === ENTITY.SPIKE && overlaps(hurt, spikeHitbox(e))) {
        return { killed: true, cause: 'spike', events };
      }
      if (e.kind === ENTITY.LASER && e.on && overlaps(hurt, laserBox(e))) {
        return { killed: true, cause: 'laser', events };
      }
    }
  }

  return { killed: false, cause: null, events };
}
