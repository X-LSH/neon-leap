/**
 * 输入抽象层。
 *
 * 核心约定：游戏逻辑**永远不知道**输入来自键盘还是手指。
 * 键盘与触屏最终都归结为同一个「意图对象」：
 *
 *   { moveX, moveY, jump:{held,pressed}, dash:{held,pressed}, grab:{held,pressed} }
 *
 * `pressed` 是**边沿触发**，采用计数锁存：
 * 每发生一次非重复按下就计数 +1，每个物理步消费一次（endStep 递减）。
 * 这样做的原因有两个：
 *  1. 一帧内可能推进多个物理步，边沿信号只应被第一个步消费，否则会重复触发；
 *  2. 一帧内可能没有物理步（累积器不足），此时信号必须保留到下一帧 —— 输入绝不丢失。
 */

const HELD_ACTIONS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
};

const EDGE_ACTIONS = {
  jump: ['KeyZ', 'Space', 'KeyK'],
  dash: ['KeyX', 'KeyJ', 'ShiftLeft', 'ShiftRight'],
  grab: ['KeyC', 'KeyL', 'ControlLeft', 'ControlRight'],
};

/** 场景级一次性事件（不进意图对象，由场景按需取用）。 */
const EVENT_CODES = {
  KeyR: 'restart',
  Escape: 'pause',
  F1: 'toggleDebug',
  BracketRight: 'nextAnchor',
  BracketLeft: 'prevAnchor',
};

export function createInput(target = window) {
  const codeToAction = new Map();
  for (const [action, codes] of Object.entries(HELD_ACTIONS)) {
    for (const code of codes) codeToAction.set(code, action);
  }
  for (const [action, codes] of Object.entries(EDGE_ACTIONS)) {
    for (const code of codes) codeToAction.set(code, action);
  }

  const held = {
    left: false, right: false, up: false, down: false,
    jump: false, dash: false, grab: false,
  };
  const pending = { jump: 0, dash: 0, grab: 0 };
  const events = [];

  function onKeyDown(e) {
    const action = codeToAction.get(e.code);
    if (action) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) {
        held[action] = true;
        if (action in pending) pending[action] += 1;
      }
      return;
    }
    const ev = EVENT_CODES[e.code];
    if (ev && !e.repeat) {
      if (ev === 'pause') e.preventDefault();
      events.push(ev);
    }
  }

  function onKeyUp(e) {
    const action = codeToAction.get(e.code);
    if (action) held[action] = false;
  }

  /** 失焦时清空所有按住状态，避免「回来还在跑」。 */
  function onBlur() {
    for (const k of Object.keys(held)) held[k] = false;
    pending.jump = 0;
    pending.dash = 0;
    pending.grab = 0;
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  /** 生成当前意图快照。每次物理步前调用一次。 */
  function intent() {
    return {
      moveX: (held.right ? 1 : 0) - (held.left ? 1 : 0),
      moveY: (held.down ? 1 : 0) - (held.up ? 1 : 0),
      jump: { held: held.jump, pressed: pending.jump > 0 },
      dash: { held: held.dash, pressed: pending.dash > 0 },
      grab: { held: held.grab, pressed: pending.grab > 0 },
    };
  }

  /** 每个物理步结束后调用，消费一次边沿信号。 */
  function endStep() {
    if (pending.jump > 0) pending.jump -= 1;
    if (pending.dash > 0) pending.dash -= 1;
    if (pending.grab > 0) pending.grab -= 1;
  }

  /**
   * 触屏专用入口：把一个动作置为按下 / 抬起。
   *
   * 语义与 keydown / keyup **完全一致** —— 边沿只在「从抬起到按下」的那一次计一次，
   * 重复的 down 不重复计数（对应键盘的 e.repeat 抑制）。
   *
   * 关键点：触屏写的是**同一份** held / pending。
   * 所以 intent() 不用改、游戏逻辑一行都不用动 ——
   * 「游戏永远不知道输入来自键盘还是手指」这条约定，靠的就是这里。
   */
  function setAction(action, down) {
    if (!(action in held)) return;
    if (down) {
      if (held[action]) return;
      held[action] = true;
      if (action in pending) pending[action] += 1;
    } else {
      held[action] = false;
    }
  }

  /** 取走并清空场景级事件。 */
  function takeEvents() {
    if (events.length === 0) return events;
    const out = events.slice();
    events.length = 0;
    return out;
  }

  function dispose() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
  }

  return { intent, endStep, takeEvents, setAction, dispose, held };
}
