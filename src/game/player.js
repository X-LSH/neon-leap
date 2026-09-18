/**
 * 玩家状态机。纯逻辑，不依赖 DOM / Canvas。
 *
 * 七态：idle / run / jump / fall / wall_slide / climb / dash
 *
 * 这个文件承载了游戏「好不好玩」的全部答案。三条不可违反的红线：
 *  1. **输入永不丢失** —— 土狼时间与跳跃缓冲同时存在，玩家在落地前按下的跳跃必须被兑现。
 *  2. **可变跳跃高度** —— 长按减重力升得更高，短按立刻收力。跳跃高度是玩家表达的旋钮。
 *  3. **冲刺相位分明** —— 冻结（停顿）→ 冲刺（恒速）→ 保留（余速），三段缺一不可。
 *
 * 任何调参都只改 config.js，不要在这里写魔法数字。
 */

import { CFG, PLAYER_W, PLAYER_H } from './config.js';
import { approach } from '../core/loop.js';
import { moveX, moveY, onGround, touchingWall } from './physics.js';

export const STATE = {
  IDLE: 'idle',
  RUN: 'run',
  JUMP: 'jump',
  FALL: 'fall',
  WALL_SLIDE: 'wall_slide',
  CLIMB: 'climb',
  DASH: 'dash',
  DEAD: 'dead',
};

export function createPlayer(x, y) {
  return {
    x, y, w: PLAYER_W, h: PLAYER_H,
    prevX: x, prevY: y,
    vx: 0, vy: 0,
    facing: 1,
    state: STATE.FALL,

    grounded: false,
    wallDir: 0,

    coyote: 0,
    buffer: 0,
    jumpHeld: 0,

    dashesLeft: 1,
    dashTimer: 0,
    dashCd: 0,
    dashDirX: 0,
    dashDirY: 0,
    freeze: 0,

    stamina: CFG.climbStamina,
    wallLock: 0,

    dead: false,
    justLanded: false,
    justJumped: false,
    justDashed: false,
    justWallJumped: false,
  };
}

function beginDash(p) {
  p.dashTimer = CFG.dashTime;
  p.vx = p.dashDirX * CFG.dashSpeed;
  p.vy = p.dashDirY * CFG.dashSpeed;
  p.justDashed = true;
}

function endDash(p) {
  p.dashTimer = 0;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 0) {
    const k = Math.min(1, CFG.dashEndSpeed / speed);
    p.vx *= k;
    p.vy *= k;
  }
}

export function updatePlayer(p, inp, world, dt) {
  p.prevX = p.x;
  p.prevY = p.y;
  p.justLanded = false;
  p.justJumped = false;
  p.justDashed = false;
  p.justWallJumped = false;

  if (p.dead) return;

  if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - dt);
  if (p.wallLock > 0) p.wallLock = Math.max(0, p.wallLock - dt);

  // 跳跃缓冲记账放在最前面，这样冲刺冻结期内的预输入也不会丢。
  if (inp.jump.pressed) p.buffer = CFG.jumpBuffer;
  if (p.buffer > 0) p.buffer = Math.max(0, p.buffer - dt);

  // ── 冲刺触发：先冻结，再爆发
  if (inp.dash.pressed && p.dashesLeft > 0 && p.dashCd <= 0 && p.freeze <= 0 && p.dashTimer <= 0) {
    let dx = inp.moveX;
    let dy = inp.moveY;
    if (dx === 0 && dy === 0) dx = p.facing;
    const len = Math.hypot(dx, dy);
    p.dashDirX = dx / len;
    p.dashDirY = dy / len;
    p.dashesLeft -= 1;
    p.dashCd = CFG.dashCooldown;
    p.freeze = CFG.dashFreeze;
    p.stamina = CFG.climbStamina;
    p.state = STATE.DASH;
  }

  // ── 冻结期：时间暂停，只计时
  if (p.freeze > 0) {
    p.freeze = Math.max(0, p.freeze - dt);
    if (p.freeze === 0) beginDash(p);
    return;
  }

  // ── 冲刺中：无重力恒速，撞到任何东西立即收尾
  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    const blocked = moveX(p, p.vx * dt, world) !== 0 || moveY(p, p.vy * dt, world) !== 0;
    if (blocked || p.dashTimer === 0) endDash(p);
    p.state = STATE.DASH;
    return;
  }

  // ── 土狼时间：用上一步的落地结果，语义才准确
  if (p.grounded) p.coyote = CFG.coyoteTime;
  else if (p.coyote > 0) p.coyote = Math.max(0, p.coyote - dt);

  // ── 水平加速
  const dirX = inp.moveX;
  const targetVx = dirX * CFG.runMax;
  const accel = p.grounded
    ? (dirX === 0 ? CFG.runDecel : CFG.runAccel)
    : (dirX === 0 ? CFG.airDecel : CFG.airAccel);
  p.vx = approach(p.vx, targetVx, accel * dt);

  if (moveX(p, p.vx * dt, world) !== 0) p.vx = 0;

  // ── 墙面感知
  p.wallDir = 0;
  if (!p.grounded) {
    if (touchingWall(p, 1, world)) p.wallDir = 1;
    else if (touchingWall(p, -1, world)) p.wallDir = -1;
  }

  // ── 抓墙攀爬：消耗耐力，可上下爬，水平锁死
  const climbing = inp.grab.held
    && p.wallDir !== 0
    && p.stamina > 0
    && p.wallLock <= 0
    && !p.grounded;

  if (climbing) {
    p.stamina = Math.max(0, p.stamina - dt);
    if (inp.moveY < 0) p.vy = -CFG.climbUpSpeed;
    else if (inp.moveY > 0) p.vy = CFG.climbDownSpeed;
    else p.vy = 0;
    p.vx = 0;
  }

  // ── 跳跃：墙跳优先于普通跳，两者共用同一个缓冲
  if (p.buffer > 0) {
    if (climbing || (p.wallDir !== 0 && p.wallLock <= 0 && !p.grounded)) {
      const away = -p.wallDir;
      p.vx = away * CFG.wallJumpVx;
      p.vy = CFG.wallJumpVy;
      p.facing = away;
      p.wallLock = CFG.wallJumpLock;
      p.stamina = Math.max(0, p.stamina - CFG.climbJumpCost);
      p.jumpHeld = CFG.jumpHoldMax;
      p.buffer = 0;
      p.coyote = 0;
      p.wallDir = 0;
      p.justWallJumped = true;
      p.justJumped = true;
    } else if (p.coyote > 0) {
      p.vy = CFG.jumpSpeed;
      p.buffer = 0;
      p.coyote = 0;
      p.jumpHeld = CFG.jumpHoldMax;
      p.grounded = false;
      p.justJumped = true;
    }
  }

  // ── 重力：长按跳跃期间减半，这是可变跳跃高度的来源
  const holding = p.jumpHeld > 0 && inp.jump.held && p.vy < 0;
  p.vy += CFG.gravity * (holding ? 0.5 : 1) * dt;

  if (p.jumpHeld > 0) p.jumpHeld = Math.max(0, p.jumpHeld - dt);
  if (p.vy >= 0) p.jumpHeld = 0;

  // 松键收力：上升速度按比例衰减（**倍率**而非绝对值 ——
  // 绝对值截断会让短按变成固定的小跳，玩家失去对高度的表达权）
  if (!inp.jump.held && p.jumpHeld > 0 && p.vy < 0) {
    p.vy *= CFG.jumpCutMul;
    p.jumpHeld = 0;
  }

  // ── 墙滑限速
  if (!p.grounded && p.wallDir !== 0 && !climbing && p.wallLock <= 0 && p.vy > CFG.wallSlideMax) {
    p.vy = CFG.wallSlideMax;
  }

  // ── 终端速度
  const terminal = (inp.moveY > 0 && !climbing) ? CFG.fastFall : CFG.maxFall;
  if (p.vy > terminal) p.vy = terminal;

  // ── 垂直推进
  const wasGrounded = p.grounded;
  const landHit = moveY(p, p.vy * dt, world);
  if (landHit === 1) {
    p.vy = 0;
    p.jumpHeld = 0;
  } else if (landHit === -1) {
    p.vy = 0;
  }

  p.grounded = onGround(p, world);
  if (p.grounded && !wasGrounded) p.justLanded = true;

  // 落地恢复：冲刺次数与抓墙耐力同时回满
  if (p.grounded) {
    p.dashesLeft = 1;
    p.stamina = CFG.climbStamina;
  }

  if (dirX !== 0 && !climbing) p.facing = dirX;

  // ── 状态标签（仅供渲染与调试，不影响物理）
  if (p.grounded) {
    p.state = Math.abs(p.vx) > 8 ? STATE.RUN : STATE.IDLE;
  } else if (climbing) {
    p.state = STATE.CLIMB;
  } else if (p.wallDir !== 0 && p.vy > 0) {
    p.state = STATE.WALL_SLIDE;
  } else {
    p.state = p.vy < 0 ? STATE.JUMP : STATE.FALL;
  }
}

export function killPlayer(p) {
  if (p.dead) return;
  p.dead = true;
  p.state = STATE.DEAD;
  p.vx = 0;
  p.vy = 0;
  p.dashTimer = 0;
  p.freeze = 0;
}

export function respawnPlayer(p, x, y) {
  p.x = x; p.y = y;
  p.prevX = x; p.prevY = y;
  p.vx = 0; p.vy = 0;
  p.dead = false;
  p.grounded = false;
  p.wallDir = 0;
  p.coyote = 0;
  p.buffer = 0;
  p.jumpHeld = 0;
  p.dashTimer = 0;
  p.freeze = 0;
  p.dashCd = 0;
  p.dashesLeft = 1;
  p.stamina = CFG.climbStamina;
  p.wallLock = 0;
  p.state = STATE.FALL;
}

/** 渲染插值位置：120Hz 物理 → 60Hz 渲染必须插值，否则看得出抖动。 */
export function interpolated(p, alpha) {
  return {
    x: p.prevX + (p.x - p.prevX) * alpha,
    y: p.prevY + (p.y - p.prevY) * alpha,
  };
}
