/**
 * 关卡注册表。顺序即解锁顺序。
 */

import testbed from './testbed.js';
import firstLight from './01-first-light.js';
import inertia from './02-inertia.js';
import echo from './03-echo.js';
import refraction from './04-refraction.js';

/** 开发用的手感测试场，不属于正式流程。 */
export const TESTBED = testbed;

/** 正式关卡（按 index 升序）。 */
export const LEVELS = [firstLight, inertia, echo, refraction];

export function levelByIndex(n) {
  return LEVELS.find((l) => l.index === n) || null;
}

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}
