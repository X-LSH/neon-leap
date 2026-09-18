#!/usr/bin/env node
/**
 * 关卡可解性调试工具。
 *
 * 平台跳跃没法用 BFS 证明有解，所以「可解」的定义是：
 * **存在一条确定性策略能通关**。这个脚本把策略跑一遍并报告结果；
 * 失败时打印失败前的轨迹与最后位置，用来定位是哪一步过不去。
 *
 * 用法：
 *   node scripts/trace.mjs           # 全部关卡
 *   node scripts/trace.mjs 1         # 指定关卡（按 index 或 id）
 *   node scripts/trace.mjs 1 -v      # 附带轨迹表
 */

import { createWorld } from '../src/game/world.js';
import { playPolicy } from '../src/game/replay.js';
import { TILE } from '../src/game/config.js';
import { LEVELS } from '../src/levels/index.js';

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const target = args.find((a) => !a.startsWith('-'));

const list = target
  ? LEVELS.filter((l) => String(l.index) === target || l.id === target)
  : LEVELS;

if (list.length === 0) {
  process.stdout.write(`没有匹配的关卡：${target}\n`);
  process.exit(1);
}

let failed = 0;
let missing = 0;

for (const level of list) {
  const label = `${String(level.index).padStart(2, '0')} ${level.name}`.padEnd(14);

  if (typeof level.solution !== 'function') {
    missing += 1;
    process.stdout.write(`\x1b[33m? \x1b[0m${label}未配可解性策略\n`);
    continue;
  }

  const world = createWorld(level);
  const r = playPolicy(world, level.solution, { trace: verbose ? true : 0 });
  const secs = r.timeSec.toFixed(2);

  if (r.ok) {
    process.stdout.write(`\x1b[32m✓\x1b[0m ${label}通关 ${secs}s（${r.frames} 帧）\n`);
  } else {
    failed += 1;
    const s = r.trace[r.trace.length - 1];
    const where = s
      ? `  最后位置 ${(s.x / TILE).toFixed(1)} 格 / 高度 ${(s.y / TILE).toFixed(1)} 格 · ${s.st}`
      : '';
    process.stdout.write(`\x1b[31m✗\x1b[0m ${label}失败于 ${secs}s · ${r.reason}${where}\n`);
  }

  if (verbose && r.trace.length) {
    process.stdout.write('      帧    时间    x(格)    y(格)     vx    vy  状态\n');
    const step = Math.max(1, Math.floor(r.trace.length / 32));
    for (let i = 0; i < r.trace.length; i += step) {
      const s = r.trace[i];
      process.stdout.write(
        `  ${String(s.f).padStart(5)} ${String(s.t).padStart(7)} ` +
        `${(s.x / TILE).toFixed(1).padStart(8)} ${(s.y / TILE).toFixed(1).padStart(8)} ` +
        `${String(s.vx).padStart(6)} ${String(s.vy).padStart(5)}  ${s.st}\n`,
      );
    }
  }
}

process.stdout.write('\n');
if (failed > 0) {
  process.stdout.write(`\x1b[31m${failed} 关不可通关\x1b[0m\n\n`);
  process.exitCode = 1;
} else if (missing > 0) {
  process.stdout.write(`\x1b[33m${missing} 关尚未配策略\x1b[0m\n\n`);
} else {
  process.stdout.write(`\x1b[32m全部 ${list.length} 关可通关\x1b[0m\n\n`);
}
