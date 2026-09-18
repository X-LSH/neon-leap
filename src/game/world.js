/**
 * 世界：把字符网格关卡数据变成一个可查询的碰撞世界。
 * 纯逻辑，不依赖 DOM / Canvas。
 *
 * 网格图例：
 *   #  实心墙        .  空
 *   ^  上向尖刺      v  下向尖刺      <  左向尖刺      >  右向尖刺
 *   C  检查点        E  出口          B  弹跳板        ?  崩塌地块
 *
 * 危险物与机关的运行时行为由 entities.js 负责（Phase 2）；
 * 本模块只负责回答「这一格是不是实心」。
 */

import { TILE } from './config.js';

const SOLID_CHARS = new Set(['#']);
const SPIKE_CHARS = new Set(['^', 'v', '<', '>']);

/** 尖刺朝向（世界单位下的法线）。 */
const SPIKE_DIR = {
  '^': { x: 0, y: 1 },
  'v': { x: 0, y: -1 },
  '<': { x: 1, y: 0 },
  '>': { x: -1, y: 0 },
};

export function createWorld(level) {
  const rows = level.tiles;
  const h = rows.length;
  const w = rows[0].length;

  for (let i = 0; i < h; i++) {
    if (rows[i].length !== w) {
      throw new Error(`关卡 ${level.id} 第 ${i} 行宽度 ${rows[i].length}，应为 ${w}`);
    }
  }

  const solid = new Uint8Array(w * h);
  /**
   * 动态实心层。崩塌地块这类「随时间改变实心状态」的机关写在这一层，
   * 与静态地形分开 —— 好处是可以整表清空后按当前帧状态重建，
   * 不必为每个机关维护增量状态，也就不会出现「漏撤销一格」这类脏数据。
   */
  const dynamic = new Uint8Array(w * h);
  const spikes = [];
  const checkpoints = [];
  let exit = null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (SOLID_CHARS.has(ch)) solid[y * w + x] = 1;
      else if (SPIKE_CHARS.has(ch)) spikes.push({ tx: x, ty: y, dir: SPIKE_DIR[ch] });
      else if (ch === 'C') checkpoints.push({ tx: x, ty: y });
      else if (ch === 'E') exit = { tx: x, ty: y };
    }
  }

  /**
   * 越界规则：
   *   左右与上方视为实心（封边，玩家不会跑出关卡）；
   *   下方视为空（掉出去 → 死亡，这是平台跳跃的常识）。
   */
  function isSolid(tx, ty) {
    if (tx < 0 || tx >= w || ty < 0) return true;
    if (ty >= h) return false;
    const i = ty * w + tx;
    return solid[i] === 1 || dynamic[i] === 1;
  }

  /** 把某格标为动态实心（或撤销）。越界安全，越界调用是空操作。 */
  function setDynamicSolid(tx, ty, on) {
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
    dynamic[ty * w + tx] = on ? 1 : 0;
  }

  return {
    level,
    id: level.id,
    name: level.name,
    hint: level.hint || '',
    w,
    h,
    worldW: w * TILE,
    worldH: h * TILE,
    spawn: { ...level.spawn },
    exit,
    checkpoints,
    spikes,
    entities: level.entities ? level.entities.slice() : [],
    isSolid,
    setDynamicSolid,
    clearDynamicSolid() {
      dynamic.fill(0);
    },
  };
}

/** 格子中心的世界坐标。 */
export function tileCenter(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}
