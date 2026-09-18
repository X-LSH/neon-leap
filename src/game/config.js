/**
 * ★ 全部手感常量。改手感只改这个文件，不动一行业务代码。
 *
 * 单位：世界单位（u）与秒（s）。TILE = 15 世界单位。
 *
 * ⚠️ 以下均为**起点值**，必须在测试场里实测微调。
 *    参数之间的「比例」比绝对值重要：改 runMax 时请同步考虑 dashSpeed 的倍数关系，
 *    改 gravity 时请同步考虑 jumpSpeed（跳跃高度 ≈ jumpSpeed² / (2 × gravity)）。
 */

/** 一格的世界单位数。 */
export const TILE = 15;

/** 视口纵向格数。固定它，关卡设计才有确定性。 */
export const VIEW_TILES_H = 18;

/** 视口高度（世界单位）。 */
export const VIEW_H = TILE * VIEW_TILES_H;

/** 玩家碰撞盒。刻意小于一格，保证狭窄通道可通过。 */
export const PLAYER_W = 10;
export const PLAYER_H = 12;

/** 物理固定步长。120Hz 让跳跃截断的时机足够精准。 */
export const FIXED_DT = 1 / 120;

/** 单帧最多推进的物理步数（防死亡螺旋）。 */
export const MAX_STEPS_PER_FRAME = 8;

export const CFG = {
  // ── 重力与下落
  gravity: 1600,        // u/s² 基础重力
  maxFall: 300,         // u/s  常态终端下落速度
  fastFall: 460,        // u/s  按住「下」时的终端速度

  // ── 水平移动
  runMax: 165,          // u/s  地面最高水平速度
  runAccel: 1100,       // u/s² 地面加速度（≈0.15s 到顶速）
  runDecel: 1500,       // u/s² 地面减速度（松手即停，不滑冰）
  airAccel: 700,        // u/s² 空中加速度（弱于地面，保留空中微调）
  airDecel: 500,        // u/s² 空中减速度

  // ── 跳跃
  jumpSpeed: -200,      // u/s  跳跃初速（短按 ≈0.6 格，长按减重力后 ≈1.6 格）
  jumpHoldMax: 0.20,    // s    长按延长上升的最长时间
  jumpCutMul: 0.5,      // 松键时上升速度的保留比例（可变跳跃高度的实现方式）
  coyoteTime: 0.10,     // s    土狼时间：离地后仍可跳的宽容窗口
  jumpBuffer: 0.12,     // s    跳跃缓冲：落地前预输入的记账窗口

  // ── 冲刺
  dashSpeed: 450,       // u/s  冲刺速度（≈2.7 倍跑速）
  dashTime: 0.15,       // s    冲刺持续时长
  dashEndSpeed: 190,    // u/s  冲刺结束时的保留速度
  dashCooldown: 0.20,   // s    冲刺冷却
  dashFreeze: 0.05,     // s    冲刺前的短暂停顿（打击感来源）

  // ── 墙面
  wallSlideMax: 65,     // u/s  贴墙下滑终端速度
  wallJumpVx: 215,      // u/s  墙跳水平初速（自动背离墙面）
  wallJumpVy: -215,     // u/s  墙跳垂直初速
  wallJumpLock: 0.12,   // s    墙跳后水平输入锁定（防止立刻贴回）

  // ── 抓墙攀爬
  climbStamina: 1.10,   // s    抓墙耐力（限制**单次**攀爬窗口；墙跳会立刻回满，见 player.js）
  climbUpSpeed: 45,     // u/s  向上攀爬速度
  climbDownSpeed: 80,   // u/s  向下攀爬速度

  // ── 机关
  bounceSpeed: -420,    // u/s  弹跳板初速（≈3.7 格，必须明显高于长按跳，否则弹跳板没有存在意义）
  crumbleShake: 0.5,    // s    踩上崩塌地块后到开始崩塌的延迟 —— 这段就是玩家的撤离窗口
  crumbleRespawn: 2.5,  // s    崩塌后恢复原状的时间
  portalCooldown: 0.35, // s    传送冷却，防止在出口原地反复触发
  laserWarn: 0.35,      // s    激光开启前的预警时长（危险必须可预告，否则就是不可归因的死亡）

  // ── 其他
  floorSnap: 1.0,       // u    地面探测容差（防高速穿透）
};

/**
 * 三条「不公平感消除」红线，任何调参都不得违反：
 *  1. 输入永不丢失   → coyoteTime 与 jumpBuffer 必须同时存在且均 ≥ 0.08s
 *  2. 死亡必可归因   → 杀伤判定框必须与视觉体积一致
 *  3. 检查点即安全区 → 复活时给 0.3s 无敌
 */
export const INVULN_ON_RESPAWN = 0.3;

/**
 * 派生量：**全程按住**的跳跃顶点高度（世界单位）。
 * 分两段推导：长按窗口内重力减半 → 窗口结束后恢复全重力，从残余速度继续减速。
 * 关卡设计的所有纵向尺寸都应以这个数为标尺：它必须 > 1 格，否则玩家跳不上台阶。
 */
export const JUMP_APEX = (() => {
  const half = CFG.gravity * 0.5;
  const v1 = CFG.jumpSpeed + half * CFG.jumpHoldMax;
  const d1 = -(CFG.jumpSpeed * CFG.jumpHoldMax + 0.5 * half * CFG.jumpHoldMax * CFG.jumpHoldMax);
  const d2 = (v1 * v1) / (2 * CFG.gravity);
  return d1 + d2;
})();

/** 派生量：一次冲刺的水平覆盖距离（世界单位，未计余速滑行）。 */
export const DASH_REACH = CFG.dashSpeed * CFG.dashTime;

/** 派生量：抓满一次墙能爬升的高度（世界单位）。 */
export const CLIMB_REACH = CFG.climbUpSpeed * CFG.climbStamina;
