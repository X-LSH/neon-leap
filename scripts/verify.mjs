#!/usr/bin/env node
/**
 * 纯逻辑自检。不需要浏览器。
 *
 * 这不是「锦上添花的测试」，而是分层架构的直接红利：
 * 因为 game/ 层完全不碰 DOM 与 Canvas，物理、状态机、关卡数据
 * 都能在 Node 里裸跑断言。任何一条断言失败都不应进入下一阶段。
 *
 * 特别提醒：语法检查必须**逐文件**执行。
 * `node --check src/main.js` 不会跟随 import —— 曾因此漏掉整个页面起不来的语法错误。
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { CFG, TILE, PLAYER_W, PLAYER_H, FIXED_DT, JUMP_APEX, DASH_REACH, CLIMB_REACH } from '../src/game/config.js';
import { moveX, moveY, touchingWall } from '../src/game/physics.js';
import { createPlayer, updatePlayer } from '../src/game/player.js';
import { createWorld } from '../src/game/world.js';
import {
  createEntities, updateEntities, ENTITY, CRUMBLE_STATE, triggerCrumble, spikeHitbox,
} from '../src/game/entities.js';
import { resolveInteractions } from '../src/game/interact.js';
import {
  createParticles, updateParticles, liveCount, clearParticles,
  spawnGhost, spawnRing, burstDust,
} from '../src/game/particles.js';
import { playPolicy } from '../src/game/replay.js';
import { createInput } from '../src/core/input.js';
import { stickDirection, trackStick, STICK_FOLLOW } from '../src/core/stick.js';
import { isTouchActive, prefersCoarsePointer } from '../src/core/touch.js';
import testbed from '../src/levels/testbed.js';
import { LEVELS } from '../src/levels/index.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let passed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
}

function section(title) {
  process.stdout.write(`\n\x1b[38;5;245m── ${title}\x1b[0m\n`);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (['.js', '.mjs'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

// ── 1. 逐文件语法检查
section('语法检查（逐文件）');
const sourceFiles = [...(await walk(join(ROOT, 'src'))), ...(await walk(join(ROOT, 'scripts')))];
for (const file of sourceFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    passed += 1;
  } catch (err) {
    failures.push(`语法错误：${file.replace(ROOT, '.')}\n${err.stderr?.toString() || err.message}`);
  }
}
process.stdout.write(`   检查了 ${sourceFiles.length} 个文件\n`);

// ── 1.5 文件规模
// 规格 §1.3 写着「单文件上限 300 行（超了就拆）」，但这条规则过去**没有任何东西看守它** ——
// 结果 play.js 一路长到 483 行、player.js 到 321 行，谁都没发现。
// 一条没有断言的规则等于没有规则；补充断言比多写一遍「请遵守」有用得多。
// 只约束 src/：scripts 是一串平铺的断言，拆开只会更难读，与规则要解决的问题相反。
section('文件规模');
{
  const OVER_LIMIT = 300;
  const srcFiles = await walk(join(ROOT, 'src'));
  const sizes = [];
  for (const file of srcFiles) {
    const text = await readFile(file, 'utf8');
    sizes.push({ file: file.replace(ROOT, '.').replace(/\\/g, '/'), lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) });
  }
  sizes.sort((a, b) => b.lines - a.lines);
  const over = sizes.filter((s) => s.lines > OVER_LIMIT);
  ok(`src/ 下没有文件超过 ${OVER_LIMIT} 行`, over.length === 0,
    over.map((s) => `${s.file} ${s.lines} 行`).join('、'));
  ok('拆出来的文件确实更小（拆分不是为了把行数搬家）',
    sizes[0].lines <= OVER_LIMIT, `最大 ${sizes[0].file} ${sizes[0].lines} 行`);
  process.stdout.write(`   最大 ${sizes[0].lines} 行（${sizes[0].file}），共 ${sizes.length} 个文件\n`);
}

// ── 2. 手感常量的三条红线
section('手感常量区间');
ok('土狼时间 ≥ 0.08s', CFG.coyoteTime >= 0.08, `实测 ${CFG.coyoteTime}`);
ok('跳跃缓冲 ≥ 0.08s', CFG.jumpBuffer >= 0.08, `实测 ${CFG.jumpBuffer}`);
ok('缓冲 ≥ 土狼的 1/2（两者比例不能失衡）', CFG.jumpBuffer >= CFG.coyoteTime * 0.5);
ok('松键收力比例落在 (0,1) 开区间', CFG.jumpCutMul > 0 && CFG.jumpCutMul < 1, `实测 ${CFG.jumpCutMul}`);
ok('冲刺速度显著高于跑速（≥2 倍）', CFG.dashSpeed >= CFG.runMax * 2, `${CFG.dashSpeed} vs ${CFG.runMax}`);
ok('冲刺保留速度低于冲刺速度', CFG.dashEndSpeed < CFG.dashSpeed);
ok('墙跳水平初速足以脱离墙面', CFG.wallJumpVx > CFG.runMax * 0.8);
ok('墙跳锁定时间足够长（否则会立刻贴回）', CFG.wallJumpLock >= 0.08);
ok('终端下落速度低于墙滑速度的 6 倍（否则墙滑没意义）', CFG.maxFall < CFG.wallSlideMax * 6);
ok('快速下落快于常态下落', CFG.fastFall > CFG.maxFall);
ok('抓墙耐力可支撑一段有效攀爬', CLIMB_REACH > TILE * 2, `可爬 ${CLIMB_REACH.toFixed(1)} 单位`);
ok('长按跳跃顶点 ≥ 1 格（否则跳不上台阶）', JUMP_APEX > TILE, `JUMP_APEX=${JUMP_APEX.toFixed(1)} 单位 = ${(JUMP_APEX / TILE).toFixed(2)} 格`);
ok('冲刺距离 ≥ 3 格（否则跨不过标准坑）', DASH_REACH >= TILE * 3, `${DASH_REACH.toFixed(1)} 单位`);
ok('固定步长下最高速位移小于一格（杜绝穿透的前提）', Math.max(CFG.fastFall, CFG.dashSpeed) * FIXED_DT < TILE);

// ── 3. 物理求解器
section('物理求解器');
{
  const world = { isSolid: (tx, ty) => tx < 0 || tx > 20 || ty >= 5 };
  const body = { x: 100, y: -400, w: PLAYER_W, h: PLAYER_H };

  // 连续高速下落：必须停在地面上，不得穿透
  for (let i = 0; i < 600; i++) moveY(body, CFG.fastFall * FIXED_DT * 1.5, world);
  const floorTop = 5 * TILE;
  ok('高速下落不穿透地面', Math.abs(body.y + body.h - floorTop) < 0.01, `底部 ${(body.y + body.h).toFixed(3)} vs ${floorTop}`);

  // 高速水平冲刺：必须停在右墙前
  for (let i = 0; i < 600; i++) moveX(body, CFG.dashSpeed * FIXED_DT * 1.5, world);
  ok('高速水平冲刺不穿墙', body.x + body.w <= 21 * TILE + 0.01, `右边界 ${(body.x + body.w).toFixed(3)}`);

  // 随机压力测试：任何位移下都不得进入实心格内部
  let penetrated = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 400; trial++) {
    const b = { x: 40, y: floorTop - PLAYER_H - 20, w: PLAYER_W, h: PLAYER_H };
    for (let step = 0; step < 40; step++) {
      moveX(b, (rnd() * 2 - 1) * 12, world);
      moveY(b, (rnd() * 2 - 1) * 12, world);
      // 检查玩家中心是否落入实心格
      const cx = Math.floor((b.x + b.w / 2) / TILE);
      const cy = Math.floor((b.y + b.h / 2) / TILE);
      if (world.isSolid(cx, cy)) penetrated += 1;
    }
  }
  ok('随机压力测试无嵌入实心格', penetrated === 0, `${penetrated} 次嵌入`);
}

// ── 4. 玩家状态机
section('玩家状态机');
{
  const world = { isSolid: (_tx, ty) => ty >= 20 };
  const groundY = 20 * TILE - PLAYER_H;

  const idle = { moveX: 0, moveY: 0, jump: { held: false, pressed: false }, dash: { held: false, pressed: false }, grab: { held: false, pressed: false } };
  const withJump = (held) => ({ ...idle, jump: { held, pressed: true } });

  // 短按：跳起后立刻收力
  const pShort = createPlayer(100, groundY);
  let shortRise = 0;
  for (let i = 0; i < 300; i++) {
    updatePlayer(pShort, i === 0 ? withJump(true) : { ...idle, jump: { held: i < 4, pressed: false } }, world, FIXED_DT);
    shortRise = Math.max(shortRise, groundY - pShort.y);
  }

  // 长按：持续升得更高
  const pLong = createPlayer(100, groundY);
  let longRise = 0;
  for (let i = 0; i < 300; i++) {
    updatePlayer(pLong, i === 0 ? withJump(true) : { ...idle, jump: { held: i < 40, pressed: false } }, world, FIXED_DT);
    longRise = Math.max(longRise, groundY - pLong.y);
  }

  ok('短按仍能跳起（不至于趴在地上）', shortRise > TILE * 0.25, `短按 ${shortRise.toFixed(1)} 单位`);
  ok('长按 ≥ 1 格（能跳上台阶）', longRise >= TILE, `长按 ${longRise.toFixed(1)} 单位 = ${(longRise / TILE).toFixed(2)} 格`);
  ok('长按显著高于短按（可变跳跃高度生效）', longRise > shortRise * 1.25, `短 ${shortRise.toFixed(1)} / 长 ${longRise.toFixed(1)}`);
  ok('跳跃高度不超过设计上限', longRise < TILE * 4, `长按 ${longRise.toFixed(1)} 单位`);

  // ── 土狼时间：需要一块「有边缘」的地面，否则玩家永远离不开地面。
  // 注意：离地后必须把玩家搬到无墙的空域 —— 否则它会贴着地面块的侧面下落，
  // 被 touchingWall 判为贴墙而走墙跳分支（这本身是正确行为，但会污染本项测试）。
  const ledgeWorld = { isSolid: (tx, ty) => ty >= 20 && tx < 20 };
  const walk = { ...idle, moveX: 1 };
  const openAir = 40 * TILE;

  function leaveLedge() {
    const p = createPlayer(17.5 * TILE, groundY);
    p.vx = CFG.runMax;
    for (let i = 0; i < 200; i++) {
      updatePlayer(p, walk, ledgeWorld, FIXED_DT);
      if (!p.grounded) break;
    }
    p.x = openAir;
    p.prevX = openAir;
    p.vx = 0;
    return p;
  }

  // 正面：离地后立刻起跳，靠土狼窗口兑现
  const pCoyote = leaveLedge();
  const coyoteLeft = pCoyote.coyote;
  updatePlayer(pCoyote, { ...idle, jump: { held: true, pressed: true } }, ledgeWorld, FIXED_DT);
  ok('土狼时间生效（离地后仍可起跳）', pCoyote.vy < -60, `离地瞬间窗口剩余 ${coyoteLeft.toFixed(3)}s`);

  // 反面：等窗口彻底关闭再起跳，必须失败
  const pLate = leaveLedge();
  for (let i = 0; i < 18; i++) updatePlayer(pLate, idle, ledgeWorld, FIXED_DT);
  const vyBefore = pLate.vy;
  updatePlayer(pLate, { ...idle, jump: { held: true, pressed: true } }, ledgeWorld, FIXED_DT);
  ok('土狼窗口关闭后起跳无效（双向验证）',
    pLate.vy > vyBefore - 1 && pLate.coyote === 0,
    `窗口 ${pLate.coyote.toFixed(3)}s，vy ${vyBefore.toFixed(0)} → ${pLate.vy.toFixed(0)}`);

  // 冲刺：次数用尽后不可再冲，落地后恢复
  const pDash = createPlayer(100, groundY);
  const dashInput = { ...idle, moveX: 1, dash: { held: false, pressed: true } };
  updatePlayer(pDash, dashInput, world, FIXED_DT);
  ok('冲刺消耗次数', pDash.dashesLeft === 0);
  updatePlayer(pDash, { ...idle, dash: { held: false, pressed: true } }, world, FIXED_DT);
  ok('次数用尽后无法再次冲刺', pDash.dashesLeft === 0 && pDash.dashTimer === 0);

  // ★ 墙跳必须重置空中机动。
  // 少了这一条，「贴墙」会退化成劣势：单面墙爬到力竭只有 3.9 格，
  // 反而低于空手组合的 7.0 格。这三条断言就是那条设计决策的守卫。
  {
    const wallWorld = { isSolid: (tx, ty) => tx >= 10 || ty >= 20 };
    const pWall = createPlayer(10 * TILE - PLAYER_W - 0.5, groundY - 60);
    pWall.grounded = false;
    pWall.dashesLeft = 0;
    pWall.stamina = 0.15;

    const touchingBefore = touchingWall(pWall, 1, wallWorld);
    updatePlayer(pWall, { ...idle, jump: { held: true, pressed: true } }, wallWorld, FIXED_DT);

    ok('前置条件：玩家确实贴着墙', touchingBefore);
    ok('墙跳重置冲刺次数', pWall.dashesLeft === 1, `dashesLeft=${pWall.dashesLeft}`);
    ok('墙跳重置抓墙耐力', pWall.stamina === CFG.climbStamina, `stamina=${pWall.stamina.toFixed(2)}`);
    ok('墙跳产生向上速度并弹离墙面', pWall.vy < 0 && pWall.vx < 0, `vx=${pWall.vx.toFixed(0)} vy=${pWall.vy.toFixed(0)}`);
  }

  // 确定性：相同输入序列必须得到完全相同的结果
  const runOnce = () => {
    const p = createPlayer(100, groundY);
    for (let i = 0; i < 200; i++) {
      updatePlayer(p, { ...idle, moveX: i % 30 < 15 ? 1 : -1, jump: { held: i % 40 < 20, pressed: i % 40 === 0 }, dash: { held: false, pressed: i % 70 === 0 } }, world, FIXED_DT);
    }
    return `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.vx.toFixed(6)},${p.vy.toFixed(6)}`;
  };
  ok('物理完全确定性（可回放验证的前提）', runOnce() === runOnce(), runOnce());
}

// ── 5. 关卡数据
section('关卡数据');
{
  const level = testbed;
  const widths = new Set(level.tiles.map((r) => r.length));
  ok('所有行等宽', widths.size === 1, `宽度集合 ${[...widths].join(',')}`);
  ok('关卡至少 40 格宽', level.tiles[0].length >= 40);
  ok('关卡至少 18 格高（否则视口装不下）', level.tiles.length >= 18);
  ok('有唯一的出口', level.tiles.join('').split('E').length - 1 === 1);
  ok('spawn 存在', !!level.spawn);

  const world = createWorld(level);
  const sx = level.spawn.x;
  const sy = level.spawn.y;
  ok('spawn 不落在实心块内', !world.isSolid(sx, sy), `(${sx}, ${sy})`);
  ok('spawn 下方是实心（否则一出生就坠落）', world.isSolid(sx, sy + 1));
  ok('出口不在实心块内', world.exit && !world.isSolid(world.exit.tx, world.exit.ty));
  ok('世界尺寸与网格一致', world.worldW === level.tiles[0].length * TILE && world.worldH === level.tiles.length * TILE);

  // 越界规则
  ok('左右越界视为实心（封边）', world.isSolid(-1, 5) && world.isSolid(world.w + 1, 5));
  ok('上方越界视为实心（封顶）', world.isSolid(5, -1));
  ok('下方越界视为空（掉出去即死）', !world.isSolid(5, world.h + 1));
}

// ── 6. 机关系统
section('机关系统');
{
  const world = createWorld(testbed);
  const ents = createEntities(world);
  const dt = FIXED_DT;
  const pick = (k) => ents.list.filter((e) => e.kind === k);

  const lasers = pick(ENTITY.LASER);
  const platforms = pick(ENTITY.PLATFORM);
  const crumbles = pick(ENTITY.CRUMBLE);
  const portals = pick(ENTITY.PORTAL);
  const bounces = pick(ENTITY.BOUNCE);
  const spikes = pick(ENTITY.SPIKE);

  ok('五类机关在关卡里齐全',
    lasers.length && platforms.length && crumbles.length && portals.length && bounces.length,
    `激光${lasers.length} 平台${platforms.length} 崩塌${crumbles.length} 门${portals.length} 弹板${bounces.length}`);

  // ── 激光：占空比必须与定义一致（危险的可预告性依赖它）
  {
    const L = lasers[0];
    const N = 1200;
    let onCount = 0;
    for (let i = 0; i < N; i++) {
      ents.time = (i / N) * L.period - dt;
      updateEntities(ents, world, dt);
      if (L.on) onCount += 1;
    }
    const ratio = onCount / N;
    ok('激光占空比符合定义', Math.abs(ratio - L.duty) < 0.02, `实测 ${ratio.toFixed(3)} vs ${L.duty}`);

    let warnSeen = false;
    for (let i = 0; i < N; i++) {
      ents.time = (i / N) * L.period - dt;
      updateEntities(ents, world, dt);
      if (L.warn) warnSeen = true;
      if (L.warn && L.on) break;   // 预警与开启不得同时为真
    }
    ok('激光开启前存在预警窗口（死亡可预告）', warnSeen);
  }

  // ── 平台：端点与周期性
  {
    const P = platforms[0];
    const sample = (t) => {
      ents.time = t - dt;
      updateEntities(ents, world, dt);
      return P.x;
    };
    const at0 = sample(0);
    const atHalf = sample(P.period / 2);
    const atFull = sample(P.period);

    ok('平台起点在 from', Math.abs(at0 - P.fromX) < 0.5, `${at0.toFixed(1)} vs ${P.fromX.toFixed(1)}`);
    ok('平台半周期到达 to', Math.abs(atHalf - P.toX) < 0.5, `${atHalf.toFixed(1)} vs ${P.toX.toFixed(1)}`);
    ok('平台整周期回到起点', Math.abs(atFull - at0) < 0.5);
  }

  // ── 崩塌地块：完整时序
  {
    const C = crumbles[0];
    ok('崩塌地块初始为 idle 且是实心', C.state === CRUMBLE_STATE.IDLE && world.isSolid(C.tx, C.ty));

    ok('踩踏触发 shaking', triggerCrumble(C) === true && C.state === CRUMBLE_STATE.SHAKING);
    ok('崩塌中重复踩踏不重置计时', triggerCrumble(C) === false);
    ok('shaking 期间仍然实心（给玩家撤离窗口）', world.isSolid(C.tx, C.ty));

    ents.time = 0;
    for (let i = 0; i < Math.ceil((CFG.crumbleShake + 0.05) / dt); i++) updateEntities(ents, world, dt);
    ok('延时后进入 gone', C.state === CRUMBLE_STATE.GONE, `state=${C.state}`);
    ok('gone 期间格子不再是实心', !world.isSolid(C.tx, C.ty));

    for (let i = 0; i < Math.ceil((CFG.crumbleRespawn + 0.05) / dt); i++) updateEntities(ents, world, dt);
    ok('恢复后回到 idle 且重新实心', C.state === CRUMBLE_STATE.IDLE && world.isSolid(C.tx, C.ty));
  }

  // ── 传送门：动量守恒 + 冷却
  {
    const P = portals[0];
    const p = createPlayer(0, 0);
    p.x = P.ax - p.w / 2;
    p.y = P.ay - p.h / 2;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = 123;
    p.vy = -45;

    const r1 = resolveInteractions(p, { list: [P] });
    ok('传送门被触发', r1.events.some((e) => e.type === 'portal'));
    ok('传送保持动量（速度矢量不变）', p.vx === 123 && p.vy === -45, `vx=${p.vx} vy=${p.vy}`);
    ok('传送后位置落在出口端',
      Math.abs(p.x + p.w / 2 - P.bx) < 0.01 && Math.abs(p.y + p.h / 2 - P.by) < 0.01);

    const r2 = resolveInteractions(p, { list: [P] });
    ok('传送有冷却，不会在出口原地反复触发', !r2.events.some((e) => e.type === 'portal'));
  }

  // ── 弹跳板
  {
    const B = bounces[0];
    // 脚底刚好落在板面上：再高一点就够不着，这正是判定边界的意义
    const p = createPlayer(B.x, B.y - PLAYER_H);
    p.vy = 120;
    p.prevY = p.y - 4;
    p.dashesLeft = 0;
    const r = resolveInteractions(p, { list: [B] });
    ok('弹跳板被触发', r.events.some((e) => e.type === 'bounce'));
    ok('弹跳板给足向上速度', p.vy <= CFG.bounceSpeed + 1, `vy=${p.vy.toFixed(0)}`);
    ok('弹跳板重置冲刺次数', p.dashesLeft === 1);

    // 反面对照：站在板子上方一格之外，不应被触发
    const far = createPlayer(B.x, B.y - PLAYER_H - TILE * 2);
    far.vy = 120;
    far.prevY = far.y;
    ok('离开板面不会被弹', !resolveInteractions(far, { list: [B] }).events.some((e) => e.type === 'bounce'));
  }

  // ── 尖刺判定框：必须严格落在视觉体积之内
  {
    ok('尖刺来自字符网格', spikes.length > 0, `${spikes.length} 个`);

    let insideAll = true;
    let maxAreaRatio = 0;
    for (const s of spikes) {
      const hb = spikeHitbox(s);
      const inside =
        hb.x >= s.tx * TILE - 0.001 && hb.y >= s.ty * TILE - 0.001 &&
        hb.x + hb.w <= (s.tx + 1) * TILE + 0.001 && hb.y + hb.h <= (s.ty + 1) * TILE + 0.001;
      if (!inside) insideAll = false;
      maxAreaRatio = Math.max(maxAreaRatio, (hb.w * hb.h) / (TILE * TILE));
    }
    ok('尖刺判定框不超出所在格子', insideAll);
    ok('尖刺判定框明显小于整格（杜绝不可归因的死亡）', maxAreaRatio <= 0.3,
      `最大占比 ${(maxAreaRatio * 100).toFixed(0)}%`);

    // 反面对照：判定框必须真的存在，不是缩成 0 导致尖刺形同虚设
    ok('尖刺判定框没有缩到失效', maxAreaRatio >= 0.15, `${(maxAreaRatio * 100).toFixed(0)}%`);
  }

  // ── 机关不能悬空：弹跳板必须坐落在实心地面上
  // （悬空的弹跳板玩家永远踩不到，等于关卡里一个装饰品 —— 这类错误肉眼很难从截图上发现）
  {
    const bad = [];
    for (const e of ents.list) {
      if (e.kind !== ENTITY.BOUNCE) continue;
      const tx = Math.floor((e.x + e.w / 2) / TILE);
      const ty = Math.floor((e.y + e.h + 1) / TILE);
      if (!world.isSolid(tx, ty)) bad.push(`(${tx},${ty})`);
    }
    ok('弹跳板下方有实心支撑（否则玩家踩不到）', bad.length === 0, bad.join(' '));

    // 崩塌地块的每一格都必须位于挖空的坑上方（否则它没有存在意义）
    const useless = [];
    for (const e of crumbles) {
      for (let i = 0; i < e.tw; i++) {
        if (world.isSolid(e.tx + i, e.ty + 1)) useless.push(`(${e.tx + i},${e.ty})`);
      }
    }
    ok('崩塌地块铺在坑洞之上（否则形同虚设）', useless.length === 0, useless.join(' '));
  }
}

// ── 7. 粒子系统
section('粒子系统');
{
  const CAP = 400;
  const p = createParticles({ capacity: CAP });

  ok('容量为声明值', p.capacity === CAP);
  ok('全部缓冲都是定长 TypedArray',
    p.x.length === CAP && p.life.length === CAP && p.kind.length === CAP && p.color.length === CAP);
  ok('初始没有存活粒子', liveCount(p) === 0);

  // 溢出：spawn 远超容量，池子必须不增长、只覆盖最旧的
  for (let i = 0; i < 900; i++) spawnGhost(p, i, i, 10);
  ok('溢出后存活数不超过容量（池子不增长）', liveCount(p) <= CAP, `${liveCount(p)} / ${CAP}`);
  ok('累计 spawn 计数如实记录', p.total === 900, `total=${p.total}`);
  ok('环形覆盖：写指针已绕回正确位置', p.head === 900 % CAP, `head=${p.head}`);
  ok('所有缓冲长度仍是 400（没有偷偷扩容）', p.x.length === CAP && p.life.length === CAP);

  // 寿命推进
  const q = createParticles({ capacity: 16 });
  spawnRing(q, 0, 0);
  const before = liveCount(q);
  for (let i = 0; i < 60; i++) updateParticles(q, FIXED_DT);
  ok('粒子会自然消亡', before === 1 && liveCount(q) === 0, `${before} → ${liveCount(q)}`);

  // 确定性：相同种子序列必须产出完全相同的粒子场
  const a = createParticles({ capacity: 32 });
  const b = createParticles({ capacity: 32 });
  for (let i = 0; i < 20; i++) {
    burstDust(a, i, i, 1, 3);
    burstDust(b, i, i, 1, 3);
  }
  let identical = true;
  for (let i = 0; i < 32; i++) {
    if (a.x[i] !== b.x[i] || a.vx[i] !== b.vx[i] || a.vy[i] !== b.vy[i]) { identical = false; break; }
  }
  ok('粒子形态完全确定性（录像逐帧比对的前提）', identical);

  clearParticles(q);
  ok('clear 之后没有存活粒子', liveCount(q) === 0);
}

// ── 8. 关卡可解性
// 平台跳跃的状态空间是连续的，没法 BFS 证明有解。
// 这里的定义是：**存在一条确定性策略能通关**。
// 每关的 solution 就是那条路径的构造性证明 —— 任一关跑不通，这条断言就会红。
section('关卡可解性');
{
  ok('至少有一关配了策略', LEVELS.length > 0, `${LEVELS.length} 关`);

  for (const level of LEVELS) {
    const tag = `${String(level.index).padStart(2, '0')} ${level.name}`;
    if (typeof level.solution !== 'function') {
      ok(`${tag} 配了可解性策略`, false, '缺少 solution 函数');
      continue;
    }
    const w = createWorld(level);
    const r = playPolicy(w, level.solution);
    ok(`${tag} 可通关`, r.ok, r.ok ? `${r.timeSec.toFixed(2)}s` : `${r.reason}`);
  }

  // 关卡数据的通用体检：这些错误不会让关卡"不可解"，但会让它变得糟糕
  for (const level of LEVELS) {
    const w = createWorld(level);
    const tag = `${String(level.index).padStart(2, '0')}`;
    const widths = new Set(level.tiles.map((r) => r.length));
    ok(`${tag} 所有行等宽`, widths.size === 1, `宽度 ${[...widths].join(',')}`);
    ok(`${tag} spawn 不落在实心块内`, !w.isSolid(level.spawn.x, level.spawn.y));
    ok(`${tag} spawn 下方是实心`, w.isSolid(level.spawn.x, level.spawn.y + 1));
    ok(`${tag} 有唯一出口`, !!w.exit);
    // 出口下方必须是实心，玩家才站得住 —— 悬空的出口玩家跑到位置也触发不了，
    // 而且这种错误**不会报任何错**，只会表现为「通关不了」。
    // 我在 05 关就写错过一次（把 GY-1 写成 GY-10）。
    ok(`${tag} 出口下方是实心（玩家站得住）`,
      !w.exit || w.isSolid(w.exit.tx, w.exit.ty + 1),
      w.exit ? `出口 (${w.exit.tx},${w.exit.ty})` : '无出口');
  }
}

// ── 9. 触屏与输入层
// 触屏最容易出错的两件事 —— 摇杆的 45° 扇区边界、动作键的边沿语义 —— 都是纯逻辑。
// 所以它们必须在这里被问清楚：在真机上，这两类 bug 要靠手指恰好停在边界上才复现，
// 属于「偶发、难拍、说不清」的那种，等用户报上来就太晚了。
// 浏览器端只负责证明「事件确实接上了」（见 e2e.mjs）——分工不重叠。
section('触屏与输入层');
{
  const dirAt = (deg, r = 40) => stickDirection(
    Math.cos((deg * Math.PI) / 180) * r,
    Math.sin((deg * Math.PI) / 180) * r,
  );
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];

  // 屏幕 y 轴向下为正，所以 90° 是「下」而不是「上」——这是最容易反的一处
  ok('摇杆 0° 正右', eq(dirAt(0), [1, 0]), JSON.stringify(dirAt(0)));
  ok('摇杆 90° 正下（屏幕坐标 y 向下）', eq(dirAt(90), [0, 1]), JSON.stringify(dirAt(90)));
  ok('摇杆 180° 正左', eq(dirAt(180), [-1, 0]), JSON.stringify(dirAt(180)));
  ok('摇杆 270° 正上', eq(dirAt(270), [0, -1]), JSON.stringify(dirAt(270)));
  ok('摇杆 45° 右下（斜向）', eq(dirAt(45), [1, 1]), JSON.stringify(dirAt(45)));
  ok('摇杆 135° 左下（斜向）', eq(dirAt(135), [-1, 1]), JSON.stringify(dirAt(135)));
  ok('摇杆 225° 左上（斜向）', eq(dirAt(225), [-1, -1]), JSON.stringify(dirAt(225)));
  ok('摇杆 315° 右上（斜向）', eq(dirAt(315), [1, -1]), JSON.stringify(dirAt(315)));

  // 45° 的边界：22.5° 是「正右」与「右下」的分界
  ok('22.4° 仍判为正右（边界内侧）', eq(dirAt(22.4), [1, 0]), JSON.stringify(dirAt(22.4)));
  ok('22.6° 已判为右下（边界外侧）', eq(dirAt(22.6), [1, 1]), JSON.stringify(dirAt(22.6)));

  // 死区：低于阈值必须是「没有输入」，否则手指静止时的微抖会让角色原地抽动
  ok('死区内不出方向', eq(dirAt(0, 11), [0, 0]), JSON.stringify(dirAt(0, 11)));
  ok('刚出死区即出方向', eq(dirAt(0, 13), [1, 0]), JSON.stringify(dirAt(0, 13)));
  ok('死区判据用的是半径不是分量（斜向不误触）', eq(dirAt(45, 11), [0, 0]));

  // 输出必须只有 -1 / 0 / 1 —— 有任何小数都会让 moveX 变成非整数，物理层会静默走偏
  let onlyUnit = true;
  for (let deg = 0; deg < 360; deg += 3) {
    for (const r of [13, 30, 46, 120]) {
      const [x, y] = dirAt(deg, r);
      if (![-1, 0, 1].includes(x) || ![-1, 0, 1].includes(y)) onlyUnit = false;
    }
  }
  ok('任意角度/半径只输出 -1 / 0 / 1', onlyUnit);

  // 动态重定位：手指滑到区域边缘仍必须推得出满偏
  const origin = { x: 0, y: 0 };
  const far = stickDirection(400, 0);
  const tracked = trackStick(origin, 400, 0);
  ok('手指拖到天边，方向依然满偏（不会因为超界而失效）', eq(tracked, [1, 0]) && eq(far, [1, 0]));
  ok('重定位后原点被推到手指身后', Math.abs(origin.x - (400 - STICK_FOLLOW)) < 0.01,
    `origin.x=${origin.x.toFixed(1)}（期望 ${400 - STICK_FOLLOW}）`);
  ok('原点不会跑到手指前面去', origin.x < 400, `origin.x=${origin.x}`);
  ok('重定位后仍在死区之外（否则满偏会掉成零输入）',
    Math.hypot(400 - origin.x, 0 - origin.y) >= 12);

  // 原点逼近后再拖回来，方向应当反向 —— 这是「回到死区」的正例
  ok('回拖到原点附近即归零', eq(trackStick(origin, origin.x, origin.y), [0, 0]));

  // ── 输入层：触屏与键盘写同一份状态
  // 用一个假的 target 就能在 Node 里跑完整语义（input.js 不依赖真正的 DOM）。
  const stub = { addEventListener() {}, removeEventListener() {} };
  const inp = createInput(stub);

  inp.setAction('jump', true);
  const edgeA = inp.intent();
  inp.endStep();                              // 物理步消费掉这次边沿
  inp.setAction('jump', true);                // 手指还按着，DOM 仍可能再送一次 down
  const edgeB = inp.intent();
  inp.setAction('jump', false);
  inp.setAction('jump', true);
  const edgeC = inp.intent();

  ok('触屏按下产生一次边沿', edgeA.jump.pressed === true && edgeA.jump.held === true);
  ok('按住期间重复 down 不产生新边沿（对应键盘的 e.repeat 抑制）',
    edgeB.jump.pressed === false && edgeB.jump.held === true);
  ok('抬起后再按下产生新边沿', edgeC.jump.pressed === true);

  inp.setAction('left', true);
  inp.setAction('right', true);
  ok('摇杆左右同按 → moveX 归零（不会变成 2）', inp.intent().moveX === 0);
  inp.setAction('left', false);
  ok('松开一侧 → moveX 为 1', inp.intent().moveX === 1);

  inp.setAction('grab', true);
  ok('抓墙是 held 语义（需要一直按住）', inp.intent().grab.held === true);
  inp.setAction('grab', false);
  ok('松开抓墙即释放', inp.intent().grab.held === false);

  const before = JSON.stringify(inp.intent());
  inp.setAction('不存在的动作', true);
  ok('未知动作不会污染状态', JSON.stringify(inp.intent()) === before);

  // 触屏模块必须能在没有 window / document 的环境里被 import ——
  // 这正是 game/ 层可测的前提，触屏层不能破坏它。
  ok('触屏检测可在无 DOM 环境加载', typeof isTouchActive() === 'boolean');
  ok('无 DOM 环境下判定为「非触屏」而不是抛错', isTouchActive() === false && prefersCoarsePointer() === false);
}

// ── 结果
process.stdout.write('\n' + '─'.repeat(52) + '\n');
if (failures.length === 0) {
  process.stdout.write(`\x1b[32m✓ 全部通过\x1b[0m  ${passed} 项断言\n\n`);
} else {
  process.stdout.write(`\x1b[31m✗ ${failures.length} 项失败\x1b[0m（通过 ${passed} 项）\n\n`);
  for (const f of failures) process.stdout.write(`  \x1b[31m·\x1b[0m ${f}\n`);
  process.stdout.write('\n');
  process.exitCode = 1;
}
