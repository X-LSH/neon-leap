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
import pulse from './11-pulse.js';
import collapse from './12-collapse.js';
import gate from './13-gate.js';
import confluence from './14-confluence.js';
import threshold from './15-threshold.js';

/** 开发用的手感测试场，不属于正式流程。 */
export const TESTBED = testbed;

/** 正式关卡（按 index 升序）。 */
// zigzag(08) 与 switchback(10) 暂缓：它们暴露了一个**引擎缺口** ——
// 抓墙时水平速度锁死为 0，玩家爬到墙顶那一刻墙消失、原地掉落，永远翻不上去。
// 需要补一个「翻越（mantle）」动作，属于引擎改动而非关卡调参，详见 docs/SPEC.md 待办。
export const LEVELS = [firstLight, inertia, echo, refraction, thrust, hover, cling, stamina, zigzag, pulse, collapse, switchback, gate, confluence, threshold];

export function levelByIndex(n) {
  return LEVELS.find((l) => l.index === n) || null;
}

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}
