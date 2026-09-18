/**
 * 触屏控制层。把手指翻译成与键盘**完全相同的** held / pending 状态。
 *
 * 它不认识玩家、不认识世界，只调 input.setAction() —— 游戏逻辑毫不知情。
 * 「游戏永远不知道输入来自键盘还是手指」这条约定，靠的就是这里只写同一份状态。
 *
 * 为什么控件在 DOM 而不是 Canvas（见 SPEC §7.3）：
 * CSS 画的按钮能吃到系统手势、无障碍语义、安全区（刘海 / 小白条），
 * 而且完全不进渲染循环 —— 用 Canvas 画 UI 会让「游戏世界」和「UI」互相污染。
 *
 * ── 为什么是 3 颗动作键，而不是规格初稿的 2 颗 ──
 * 规格初稿担心「一个拇指按不过来」。那个担心在这个游戏里不成立：
 * player.js 里墙跳的两个分支（climbing / 贴墙下滑）产出的速度**逐字相同**，
 * 于是「松开抓墙再按跳」与「按住抓墙按跳」是同一个动作，没有任何损失。
 * 拇指轮流按就够了 —— 抓墙的需求是「按住」，而按住期间玩家本来就不做别的。
 *
 * 反过来，把抓墙做成「长按跳跃」需要 150ms 消歧，对一个每关要用几十次的核心动词
 * 来说代价太高：玩家会感觉指令被吞掉了。三个明确的按钮没有这个问题。
 *
 * 摇杆几何在 stick.js（纯函数，可在 Node 里断言）。
 */

import { STICK_RADIUS, trackStick } from './stick.js';

/** 是否处于触屏优先环境。放函数里而不是模块顶层 —— Node 里没有 matchMedia。 */
export function prefersCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

let touchActive = prefersCoarsePointer();
const activationListeners = new Set();

/**
 * 告诉 CSS 外壳「这是触屏环境」。
 * 键盘图例（#hint）与调试面板（#debug）在手机上纯粹是噪音：
 * 前者讲的是用不上的键位，后者是一大块没人能关掉的开发信息（F1 在手机上不存在）。
 */
function markTouchShell() {
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.add('touch-ui');
  }
}
if (touchActive) markTouchShell();

if (typeof window !== 'undefined') {
  // 媒体查询在某些环境会撒谎（触屏笔记本、部分安卓浏览器），用户的指头不会。
  // 第一次真实触摸就补开触屏 UI —— 这就是规格 §7.3 的「或首次触摸后显示」。
  window.addEventListener('touchstart', () => {
    if (touchActive) return;
    touchActive = true;
    markTouchShell();
    for (const fn of activationListeners) fn();
  }, { passive: true });
}

/** 触屏 UI 是否应该显示。 */
export function isTouchActive() {
  return touchActive;
}

/** 订阅「刚刚检测到触屏」。返回取消订阅的函数。 */
export function onTouchActivate(fn) {
  activationListeners.add(fn);
  return () => activationListeners.delete(fn);
}

/**
 * 动作键布局。跳跃最大、离拇指自然落点最近 —— 它是使用频率最高的动词，
 * 位置的好坏直接决定手感；冲刺与抓墙往上排。三者互不重叠，
 * 保证单拇指落在任意一颗上都无歧义。
 */
const ACTION_BUTTONS = [
  { action: 'jump', label: '跳', size: 72, right: 24, bottom: 30, font: 17 },
  { action: 'dash', label: '冲', size: 58, right: 116, bottom: 58, font: 15 },
  { action: 'grab', label: '抓', size: 58, right: 46, bottom: 128, font: 15 },
];

const CYAN = '#35e0ff';
const CYAN_DIM = 'rgba(53,224,255,0.30)';
const CYAN_FILL = 'rgba(53,224,255,0.06)';
const CYAN_FILL_ON = 'rgba(53,224,255,0.22)';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

/** 把 env(safe-area-inset-*) 揉进长度，避免按键被刘海或小白条压住。 */
const inset = (px, side) => `calc(${px}px + env(safe-area-inset-${side}, 0px))`;

/**
 * 构建触屏控制层。root 由调用方挂载 / 移除 ——
 * 场景自己管自己的 DOM，与关卡选择场景保持同一种所有权模型。
 */
export function createTouchControls({
  input,
  onBack = null,
  onRestart = null,
  onToggleMute = null,
  muted = false,
}) {
  const root = document.createElement('div');
  root.id = 'touch-layer';
  root.style.cssText =
    'position:absolute;inset:0;z-index:4;pointer-events:none;'
    + 'touch-action:none;-webkit-user-select:none;user-select:none;';

  // ── 左半屏：浮动摇杆 ────────────────────────────────────────────────
  // 触摸点即原点，不画固定底盘。固定底盘有三个问题：手指找不到它、
  // 它挡住画面、以及手指一旦滑出底盘就再也推不出满偏。
  const stickZone = document.createElement('div');
  stickZone.style.cssText =
    'position:absolute;left:0;top:0;width:50%;height:100%;'
    + 'pointer-events:auto;touch-action:none;';

  const ring = document.createElement('div');
  ring.style.cssText =
    `position:absolute;width:${STICK_RADIUS * 2}px;height:${STICK_RADIUS * 2}px;`
    + 'border-radius:50%;border:1.5px solid rgba(53,224,255,0.40);'
    + 'background:radial-gradient(circle, rgba(53,224,255,0.07) 0%, rgba(53,224,255,0) 70%);'
    + 'transform:translate(-50%,-50%);display:none;pointer-events:none;';

  const knob = document.createElement('div');
  knob.style.cssText =
    'position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;'
    + 'border-radius:50%;border:1.5px solid rgba(53,224,255,0.75);'
    + 'background:rgba(53,224,255,0.20);pointer-events:none;';
  ring.append(knob);
  stickZone.append(ring);

  const origin = { x: 0, y: 0 };
  let stickId = null;
  let vec = [0, 0];

  /** 把方向写进输入层。只在方向真的变了才写 —— 每帧写四次是没必要的噪音。 */
  function setMove(x, y) {
    if (vec[0] === x && vec[1] === y) return;
    vec = [x, y];
    input.setAction('left', x < 0);
    input.setAction('right', x > 0);
    input.setAction('up', y < 0);
    input.setAction('down', y > 0);
  }

  /** 位移映射到摇杆视觉。超出半径时按比例压缩，旋钮不飞出环外。 */
  function paintStick(dx, dy) {
    const dist = Math.hypot(dx, dy);
    const k = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
  }

  function placeRing() {
    ring.style.left = `${origin.x}px`;
    ring.style.top = `${origin.y}px`;
  }

  function onStickDown(e) {
    // 鼠标不驱动摇杆。这一层本来就只在触屏环境挂载，这道闸门是防触屏笔记本的
    // 「鼠标拖一下左半屏角色就跑」—— 那会让人以为游戏坏了。
    if (e.pointerType === 'mouse') return;
    if (stickId !== null) return;            // 已经有一根手指在操作摇杆
    stickId = e.pointerId;
    stickZone.setPointerCapture(e.pointerId);
    origin.x = e.clientX;
    origin.y = e.clientY;
    placeRing();
    ring.style.display = 'block';
    paintStick(0, 0);
    e.preventDefault();
  }

  function onStickMove(e) {
    if (e.pointerId !== stickId) return;
    const [x, y] = trackStick(origin, e.clientX, e.clientY);
    setMove(x, y);
    placeRing();                              // 原点可能已经跟上手指
    paintStick(e.clientX - origin.x, e.clientY - origin.y);
    e.preventDefault();
  }

  function onStickUp(e) {
    if (e.pointerId !== stickId) return;
    stickId = null;
    setMove(0, 0);
    ring.style.display = 'none';
  }

  stickZone.addEventListener('pointerdown', onStickDown);
  stickZone.addEventListener('pointermove', onStickMove);
  stickZone.addEventListener('pointerup', onStickUp);
  stickZone.addEventListener('pointercancel', onStickUp);

  // ── 右半屏：动作键 ─────────────────────────────────────────────────
  const buttonZone = document.createElement('div');
  buttonZone.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

  function paintButton(btn, on) {
    btn.style.background = on ? CYAN_FILL_ON : CYAN_FILL;
    btn.style.borderColor = on ? CYAN : CYAN_DIM;
    btn.style.transform = on ? 'scale(0.93)' : 'scale(1)';
  }

  const actionButtons = [];
  for (const cfg of ACTION_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = cfg.label;
    btn.setAttribute('aria-label', cfg.label);
    btn.style.cssText =
      `position:absolute;right:${inset(cfg.right, 'right')};bottom:${inset(cfg.bottom, 'bottom')};`
      + `width:${cfg.size}px;height:${cfg.size}px;`
      + `border-radius:50%;border:1.5px solid ${CYAN_DIM};background:${CYAN_FILL};`
      + `color:#a6ecff;font-family:${MONO};font-size:${cfg.font}px;letter-spacing:0.06em;`
      + 'display:grid;place-items:center;padding:0;pointer-events:auto;touch-action:none;'
      + '-webkit-tap-highlight-color:transparent;appearance:none;'
      + 'transition:background 90ms linear, border-color 90ms linear, transform 90ms linear;';

    btn.addEventListener('pointerdown', (e) => {
      input.setAction(cfg.action, true);
      paintButton(btn, true);
      // 捕获指针：手指滑出按钮后仍保持按住，抬起时也一定能收到 up。
      // 不做捕获的话，手指滑出去再抬起，动作会永久卡在「按住」——角色一直跳。
      btn.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    const release = () => {
      input.setAction(cfg.action, false);
      paintButton(btn, false);
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);

    buttonZone.append(btn);
    actionButtons.push(btn);
  }

  // ── 左上角：系统键 ─────────────────────────────────────────────────
  // 故意放在拇指够不着的地方：误触的代价（瞬间退出本关）远高于便利性。
  function makeSystemButton(label, index, onTap) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText =
      `position:absolute;left:${inset(index * 62 + 14, 'left')};top:${inset(12, 'top')};`
      + 'height:30px;min-width:54px;padding:0 10px;'
      + 'border-radius:6px;border:1px solid rgba(107,122,144,0.42);'
      + 'background:rgba(10,13,22,0.72);color:#8a99ad;'
      + `font-family:${MONO};font-size:11px;letter-spacing:0.06em;`
      + 'display:grid;place-items:center;pointer-events:auto;touch-action:none;'
      + '-webkit-tap-highlight-color:transparent;appearance:none;';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onTap();
    });
    buttonZone.append(btn);
    return btn;
  }

  if (onBack) makeSystemButton('返回', 0, onBack);
  if (onRestart) makeSystemButton('重开', 1, onRestart);

  const muteBtn = onToggleMute
    ? makeSystemButton(muted ? '已静音' : '音效', 2, () => {
      // 标签跟着真实状态走，而不是跟着「点了几下」走
      muteBtn.textContent = onToggleMute() ? '已静音' : '音效';
    })
    : null;

  root.append(stickZone, buttonZone);

  /**
   * 全部松手。窗口失焦时必须调用：手指抬起的 up 事件会随失焦一起丢掉，
   * 不清理的话角色会永远朝一个方向跑。
   */
  function releaseAll() {
    stickId = null;
    setMove(0, 0);
    ring.style.display = 'none';
    for (let i = 0; i < actionButtons.length; i++) {
      input.setAction(ACTION_BUTTONS[i].action, false);
      paintButton(actionButtons[i], false);
    }
  }

  window.addEventListener('blur', releaseAll);

  return {
    root,
    releaseAll,
    dispose() {
      releaseAll();
      window.removeEventListener('blur', releaseAll);
      root.remove();
    },
  };
}
