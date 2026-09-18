/**
 * 冲刺。三段相位：**冻结 → 恒速 → 保留**。
 *
 * 从 player.js 抽出来的原因不是行数，是**它整段独占物理步**：
 * 一旦进入（不管是冻结还是冲刺中），常规的重力、水平加速、墙面感知全都不该跑。
 * 单独放一个文件之后，player.js 剩下的部分通篇是「常规移动 + 跳跃 + 抓墙」，
 * 读起来不再被这个横插一段的状态转移打断。
 *
 * 三段缺一不可：
 *   **冻结**（dashFreeze）—— 打击感的来源。没有它，冲刺只是「变快」，不是「发力」。
 *   **恒速**（dashTime）—— 期间无重力、恒速，撞到任何东西立即收尾。
 *   **保留**（dashEndSpeed）—— 结束后按比例保留速度，让冲刺能顺势接上跑动。
 *
 * 状态标签留在 player.js 里写：STATES 是玩家状态机的词汇表，
 * 不该为了少一个循环依赖就被拆成两处。
 */

import { CFG } from './config.js';
import { moveX, moveY } from './physics.js';

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

/**
 * 推进冲刺。
 * @returns {boolean} true 表示本步已被冲刺独占，调用方应直接结束这一帧
 */
export function updateDash(p, inp, world, dt) {
  // 触发：先冻结，再爆发
  if (inp.dash.pressed && p.dashesLeft > 0 && p.dashCd <= 0 && p.freeze <= 0 && p.dashTimer <= 0) {
    let dx = inp.moveX;
    let dy = inp.moveY;
    if (dx === 0 && dy === 0) dx = p.facing;   // 没有方向输入就朝面朝方向
    const len = Math.hypot(dx, dy);
    p.dashDirX = dx / len;
    p.dashDirY = dy / len;
    p.dashesLeft -= 1;
    p.dashCd = CFG.dashCooldown;
    p.freeze = CFG.dashFreeze;
    p.stamina = CFG.climbStamina;              // 冲刺顺带回满抓墙耐力
  }

  // 冻结期：时间暂停，只计时
  if (p.freeze > 0) {
    p.freeze = Math.max(0, p.freeze - dt);
    if (p.freeze === 0) beginDash(p);
    return true;
  }

  // 冲刺中：无重力恒速，撞到任何东西立即收尾
  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    const blocked = moveX(p, p.vx * dt, world) !== 0 || moveY(p, p.vy * dt, world) !== 0;
    if (blocked || p.dashTimer === 0) endDash(p);
    return true;
  }

  return false;
}
