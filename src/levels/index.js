/**
 * 关卡注册表。顺序即解锁顺序。
 */

import testbed from './testbed.js';
import firstLight from './01-first-light.js';
import inertia from './02-inertia.js';
import echo from './03-echo.js';
import refraction from './04-refraction.js';
import thrust from './05-thrust.js';
import hover from './06-hover.js';
import cling from './07-cling.js';
import zigzag from './08-zigzag.js';
import stamina from './09-stamina.js';
import switchback from './10-switchback.js';

/** 开发用的手感测试场，不属于正式流程。 */
export const TESTBED = testbed;

/** 正式关卡（按 index 升序）。 */
// zigzag(08) 与 switchback(10) 是竖井类关卡，可解性策略尚未调通（见 docs/SPEC.md 待办），
// 暂时不注册进关卡表 —— 宁可少两关，也不交付「玩家可能卡死」的关卡。
export const LEVELS = [firstLight, inertia, echo, refraction, thrust, hover, cling, stamina];

export function levelByIndex(n) {
  return LEVELS.find((l) => l.index === n) || null;
}

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}
