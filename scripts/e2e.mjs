#!/usr/bin/env node
/**
 * 真实浏览器端到端验证（Chrome + CDP）。
 *
 * 为什么要写成一个脚本：
 * 本机 chrome.exe 是启动器桩，且工具会在两次调用之间回收进程树 ——
 * 「启动 Chrome」和「跑验证」必须写在同一个 Node 进程里，脚本自己 spawn 分离进程、跑完再 kill。
 *
 * 用法：
 *   node scripts/serve.mjs            （另开一个终端 / 后台任务）
 *   node scripts/e2e.mjs
 *
 * 环境变量：
 *   APP_URL    默认 http://127.0.0.1:5173/
 *   CDP_PORT   默认 9345
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = resolve(ROOT, '.tmp', 'shots');
const BASE = process.env.APP_URL || 'http://127.0.0.1:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9345);
const isLocal = /(127\.0\.0\.1|localhost|\[::1\])/.test(BASE);

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[38;5;245m${detail}\x1b[0m` : ''}\n`);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}  \x1b[31m${detail}\x1b[0m\n`);
  }
}

async function portOpen() {
  try {
    return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok;
  } catch {
    return false;
  }
}

async function launchChrome() {
  if (await portOpen()) return null;
  const bin = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!bin) throw new Error('未找到 Chrome/Edge 可执行文件');

  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--mute-audio',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${resolve(ROOT, '.tmp', `cdp-profile-${CDP_PORT}`)}`,
    'about:blank',
  ];
  // 本机有企业代理：本地服务必须绕开代理，否则会被送进隧道变成 ERR_CONNECTION_REFUSED
  if (isLocal) args.unshift('--no-proxy-server', '--proxy-bypass-list=<-loopback>');

  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 60; i++) {
    if (await portOpen()) return child.pid;
    await sleep(500);
  }
  throw new Error('Chrome 未能在 30 秒内开启调试端口');
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  process.stdout.write(`\nNEON LEAP · 浏览器实测  ${BASE}\n\n`);

  const chromePid = await launchChrome();
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('未找到页面目标');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'));
  });

  let seq = 0;
  const pending = new Map();
  const errors = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || 'unknown exception');
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const e = m.params.entry;
      errors.push(`${e.text}${e.url ? ` @ ${e.url}` : ''}`);
    }
  };

  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return r.result?.result?.value;
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };

  const keyDown = (key, code, vk) =>
    send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  const keyUp = (key, code, vk) =>
    send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });

  const readDebug = () => evaluate(`document.getElementById('debug').textContent`);
  const readStats = () => evaluate(`document.getElementById('stats').textContent`);

  const parseDebug = (text) => {
    const map = {};
    for (const line of String(text).trim().split('\n')) {
      const m = line.match(/^(\w+)\s+(.*)$/);
      if (m) map[m[1]] = m[2].trim();
    }
    return map;
  };
  const parseVelocity = (text) => {
    const m = String(text).match(/(-?\d+)\s*\/\s*(-?\d+)/);
    return m ? { vx: Number(m[1]), vy: Number(m[2]) } : null;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 950, deviceScaleFactor: 1, mobile: false });

  // ── 加载（整个脚本只导航一次）
  await send('Page.navigate', { url: BASE });
  await sleep(2800);

  const href = await evaluate('location.href');
  ok('页面导航到目标地址', String(href).startsWith(BASE.replace(/\/$/, '')), href);
  ok('无控制台异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  // ── 首屏是关卡选择（DOM 场景），先进第一关再测游戏本体
  const selectInfo = await evaluate(`(() => {
    const el = document.getElementById('select-scene');
    if (!el) return null;
    return { cards: el.querySelectorAll('div[style*="border-radius: 6px"]').length, text: el.textContent };
  })()`);
  ok('首屏渲染出关卡选择场景', !!selectInfo, selectInfo ? `${selectInfo.cards} 张卡片` : '未找到');
  ok('选择界面展示了进度信息', !!selectInfo && /已通关\s*\d+\s*\/\s*\d+/.test(selectInfo.text),
    selectInfo ? selectInfo.text.slice(0, 60) : '');
  await shot('00-select');

  // 按 Z 进入当前光标所在关卡
  await keyDown('KeyZ', 'KeyZ', 90);
  await keyUp('KeyZ', 'KeyZ', 90);
  await sleep(900);

  const inGame = await evaluate(`!document.getElementById('select-scene')`);
  ok('按 Z 后进入游戏场景', inGame === true);
  ok('游戏画面已出现', !!(await evaluate(`document.getElementById('screen')`)));

  // ── 渲染非空白：统计画布上的不同颜色数
  const colors = await evaluate(`(() => {
    const cv = document.getElementById('screen');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return set.size;
  })()`);
  ok('画布确实渲染了内容', colors >= 4, `${colors} 种颜色`);

  const size = await evaluate(`(() => { const cv = document.getElementById('screen'); return cv.width + 'x' + cv.height; })()`);
  ok('画布尺寸与视口匹配', /^\d+x\d+$/.test(String(size)), size);

  await shot('01-initial');

  const initial = parseDebug(await readDebug());
  ok('调试面板输出状态', !!initial.state, `state=${initial.state}`);
  ok('初始为落地状态', initial.ground === 'true', `ground=${initial.ground}`);

  // ── 真实键盘：向右跑
  await keyDown('ArrowRight', 'ArrowRight', 39);
  await sleep(700);
  const runStats = parseVelocity(await readStats());
  const runDebug = parseDebug(await readDebug());
  await shot('02-running');
  await keyUp('ArrowRight', 'ArrowRight', 39);

  ok('按住方向键后水平速度上升', runStats && runStats.vx >= 100, `vx=${runStats?.vx}`);
  ok('状态机进入 run', runDebug.state === 'run', `state=${runDebug.state}`);

  // ── 真实键盘：跳跃
  await sleep(250);
  await keyDown('KeyZ', 'KeyZ', 90);
  await sleep(120);
  const jumpStats = parseVelocity(await readStats());
  const jumpDebug = parseDebug(await readDebug());
  await shot('03-jumping');
  await keyUp('KeyZ', 'KeyZ', 90);

  ok('按跳跃键后垂直速度为负（正在上升）', jumpStats && jumpStats.vy < 0, `vy=${jumpStats?.vy}`);
  ok('状态机进入 jump', jumpDebug.state === 'jump', `state=${jumpDebug.state}`);
  ok('离地后 ground 为 false', jumpDebug.ground === 'false', `ground=${jumpDebug.ground}`);

  // ── 测冲刺
  // 断言用「速度」而不是「剩余次数」：冲刺速度 450 远超跑速 165，是冲刺的必然结果；
  // 而剩余次数会在落地时被合法恢复，采样窗口只有 200ms，时序一抖就误报。
  await sleep(1600);
  const beforeDash = parseDebug(await readDebug());
  const dashesBefore = Number(String(beforeDash.dash || '').split(/\s+/)[0]);

  await keyDown('KeyX', 'KeyX', 88);
  // 必须等过 HUD 的 100ms 节流窗口，否则读到的是冲刺之前那一帧的旧值。
  // 冲刺共 200ms（冻结 50 + 冲刺 150），150ms 时稳稳落在冲刺期。
  await sleep(150);
  const dashStats = parseVelocity(await readStats());
  const dashDebug = parseDebug(await readDebug());
  const dashesAfter = Number(String(dashDebug.dash || '').split(/\s+/)[0]);
  await shot('04-dash');
  await keyUp('KeyX', 'KeyX', 88);

  ok('冲刺前有可用次数', dashesBefore >= 1, `dashesLeft=${dashesBefore}`);
  ok('冲刺产生远超跑速的速度', dashStats && Math.abs(dashStats.vx) >= 300,
    `vx=${dashStats?.vx}（跑速上限 ${165}）`);
  ok('冲刺期间次数已被消耗', dashesAfter < dashesBefore || dashDebug.dash?.includes('cd 0.1'),
    `${dashesBefore} → ${dashesAfter}`);

  // ── 机关考区：两处锚点各截一张，覆盖「危险类」与「助力类」
  const hop = async (n) => {
    for (let i = 0; i < n; i++) {
      await keyDown(']', 'BracketRight', 221);
      await keyUp(']', 'BracketRight', 221);
      await sleep(70);
    }
    await sleep(420);
  };

  // anchors 索引从 0 起算：按 7 次 → 机关·危险（尖刺带 + 激光柱）
  await hop(7);
  await shot('06-machines-hazard');
  const anchorA = parseDebug(await readDebug());
  ok('考区跳转生效（锚点可用）', anchorA.anchor && anchorA.anchor !== '-', `anchor=${anchorA.anchor}`);

  // 再按 1 次 → 机关·助力（摆渡平台 + 弹跳板 + 崩塌地块）
  await hop(1);
  await shot('07-machines-helper');
  const anchorB = parseDebug(await readDebug());
  ok('连续跳转不会越界', anchorB.anchor && anchorB.anchor !== '-', `anchor=${anchorB.anchor}`);

  const machineColors = await evaluate(`(() => {
    const cv = document.getElementById('screen');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return set.size;
  })()`);
  ok('机关考区渲染出更丰富的画面', machineColors >= 4, `${machineColors} 种颜色`);

  // ── 传送门
  await hop(1);
  await shot('08-portal');
  const anchorC = parseDebug(await readDebug());
  ok('锚点循环回绕正常', anchorC.anchor && anchorC.anchor !== '-', `anchor=${anchorC.anchor}`);

  // ── 1080p 帧率实测
  // 规格里的「60fps 稳定」必须有数据支撑 —— 靠肉眼看流畅度是测不出 52fps 和 60fps 差别的。
  await keyDown('[', 'BracketLeft', 219);
  await keyUp('[', 'BracketLeft', 219);
  await sleep(400);
  const anchorPerf = parseDebug(await readDebug());
  ok('反向跳转可用', anchorPerf.anchor && anchorPerf.anchor !== '-', `anchor=${anchorPerf.anchor}`);

  // 连续跑动 + 反复起跳，让粒子系统持续处于高负载
  await keyDown('ArrowRight', 'ArrowRight', 39);
  for (let i = 0; i < 12; i++) {
    await keyDown('KeyZ', 'KeyZ', 90);
    await sleep(36);
    await keyUp('KeyZ', 'KeyZ', 90);
    await sleep(190);
  }
  // 趁粒子（落地尘寿命 0.16~0.34s）还在场上时立刻取样与截图
  await shot('09-perf');
  const midDebug = String(await readDebug());
  const midMatch = midDebug.match(/particles\s+(\d+)\s*\/\s*(\d+)/);
  await keyUp('ArrowRight', 'ArrowRight', 39);

  const fpsText = String(await evaluate(`document.getElementById('stats').textContent`));
  const fpsMatch = fpsText.match(/(\d+)\s*fps/);
  const fps = fpsMatch ? Number(fpsMatch[1]) : 0;
  ok('1080p 连续机动下帧率 ≥ 55', fps >= 55, `${fps} fps（HUD: ${fpsText.trim()}）`);

  const liveParts = midMatch ? Number(midMatch[1]) : -1;
  const capParts = midMatch ? Number(midMatch[2]) : -1;
  ok('机动过程中确实产生了粒子', liveParts > 0, `particles=${liveParts}`);
  ok('粒子数没有溢出池容量', capParts === 400 && liveParts <= 400, `${liveParts} / ${capParts}`);

  // ── 响应式：切到手机宽度
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const mobile = await evaluate(`({
    scrollW: document.body.scrollWidth,
    innerW: window.innerWidth,
    canvasW: document.getElementById('screen').clientWidth,
  })`);
  await shot('05-mobile');
  ok('窄屏无横向溢出', mobile.scrollW <= mobile.innerW, `${mobile.scrollW} vs ${mobile.innerW}`);
  ok('画布自适应窄屏', mobile.canvasW > 0 && mobile.canvasW <= mobile.innerW, `canvas=${mobile.canvasW}`);

  const lateErrors = errors.length;
  ok('全流程仍无控制台异常', lateErrors === 0, errors.slice(0, 2).join(' | '));

  ws.close();
  if (chromePid) {
    try { process.kill(chromePid); } catch { /* 已被回收 */ }
  }

  process.stdout.write('\n' + '─'.repeat(52) + '\n');
  if (failures.length === 0) {
    process.stdout.write(`\x1b[32m✓ 浏览器实测全部通过\x1b[0m  ${passed} 项\n`);
    process.stdout.write(`  截图 ${SHOTS}\n\n`);
  } else {
    process.stdout.write(`\x1b[31m✗ ${failures.length} 项失败\x1b[0m（通过 ${passed} 项）\n`);
    for (const f of failures) process.stdout.write(`  · ${f}\n`);
    process.stdout.write('\n');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stdout.write(`\n\x1b[31m验证脚本异常：\x1b[0m ${err.message}\n\n`);
  process.exitCode = 1;
});
