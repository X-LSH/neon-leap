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
import { moveX, moveY, onGround, touchingWall, atLedge } from './physics.js';
import { updateDash } from './dash.js';

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
    mantleTimer: 0,

    dead: false,
    justLanded: false,
    justJumped: false,
    justDashed: false,
    justWallJumped: false,
    justMantled: false,
  };
}

/** 冲刺的三段相位（冻结 / 恒速 / 保留）在 dash.js，见那里的说明。 */

/**
 * @param {object} p 玩家状态
 * @param {object} inp 本步意图
 * @param {object} world 世界（只含静态地形 + 动态实心）
 * @param {number} dt 固定步长
 * @param {((p:object)=>boolean)|null} [extraGround]
 *        外部地面回调。移动平台是**单向**的，不能写进 world.isSolid
 *        （那样会变成实心墙，玩家从下方跳不上去），
 *        所以要用这个回调告诉玩家「你脚下还踩着东西」。
 */
export function updatePlayer(p, inp, world, dt, extraGround = null) {
  p.prevX = p.x;
  p.prevY = p.y;
  p.justLanded = false;
  p.justJumped = false;
  p.justDashed = false;
  p.justWallJumped = false;
  p.justMantled = false;

  if (p.dead) return;

  if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - dt);
  if (p.wallLock > 0) p.wallLock = Math.max(0, p.wallLock - dt);
  if (p.mantleTimer > 0) p.mantleTimer = Math.max(0, p.mantleTimer - dt);

  // 跳跃缓冲记账放在最前面，这样冲刺冻结期内的预输入也不会丢。
  if (inp.jump.pressed) p.buffer = CFG.jumpBuffer;
  if (p.buffer > 0) p.buffer = Math.max(0, p.buffer - dt);

  // ── 冲刺：三段相位整段独占本步（冻结 / 恒速 / 保留）
  if (updateDash(p, inp, world, dt)) {
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

  // 撞墙清零水平速度 —— **但翻越窗口内不清零**。
  // 翻越时玩家朝墙冲，会被墙沿挡住；若在这里归零，它就永远移不到墙顶上方。
  // 保留速度，等玩家升过墙顶后那点水平速度会自然生效。
  if (moveX(p, p.vx * dt, world) !== 0 && p.mantleTimer <= 0) p.vx = 0;

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
    && p.mantleTimer <= 0      // 翻越过程中不再抓墙
    && !p.grounded;

  if (climbing) {
    // ★ 翻越（mantle）：向上爬时到达墙沿 → 自动翻上去。
    //   必须在「还贴着墙、但脚下方已经没有墙」的这一刻介入 ——
    //   等 touchingWall 自己变假就晚了，那时玩家已在下落，且恰好悬在墙沿外侧。
    if (inp.moveY < 0 && atLedge(p, p.wallDir, world)) {
      p.mantleTimer = CFG.mantleTime;
      p.vy = CFG.mantleVy;
      p.vx = p.wallDir * CFG.mantleVx;
      p.grounded = false;
      p.justJumped = true;
      p.justMantled = true;      // 翻越有自己的音效，不该混进「起跳」
    } else {
      p.stamina = Math.max(0, p.stamina - dt);
      if (inp.moveY < 0) p.vy = -CFG.climbUpSpeed;
      else if (inp.moveY > 0) p.vy = CFG.climbDownSpeed;
      else p.vy = 0;
      p.vx = 0;
    }
  }

  // ── 跳跃：墙跳优先于普通跳，两者共用同一个缓冲
  if (p.buffer > 0) {
    if (climbing || (p.wallDir !== 0 && p.wallLock <= 0 && !p.grounded)) {
      const away = -p.wallDir;
      p.vx = away * CFG.wallJumpVx;
      p.vy = CFG.wallJumpVy;
      p.facing = away;
      p.wallLock = CFG.wallJumpLock;

      // ★ 墙跳重置空中机动（Celeste 规则，不可删）。
      // 没有这一条，「贴墙」会退化成劣势：单面墙跳到力竭只能爬 3.9 格，
      // 反而低于空手组合的 7.0 格 —— 贴着墙比不贴还差，反直觉且违背直觉优先级。
      // 重置之后，贴墙能爬多高由「墙有多高」决定，而不是由耐力上限决定。
      p.dashesLeft = 1;
      p.stamina = CFG.climbStamina;

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
  //    ⚠️ 抓墙攀爬时必须**完全跳过重力**：climbing 分支每帧把 vy 设成 climbUpSpeed，
  //    但紧接着重力又加回 13.3 u/s —— 标称 45 实际只有 31.7，
  //    耐力 2.6 秒本该爬 7.8 格、实际只爬 5.5 格，玩家永远够不到高墙的顶。
  if (!climbing) {
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

  p.grounded = onGround(p, world) || (extraGround ? extraGround(p) === true : false);
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
