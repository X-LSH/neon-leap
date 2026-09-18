/**
 * 固定步长主循环。
 *
 * 设计要点：
 * - 物理以固定步长推进，渲染跟随显示器刷新率，两者解耦。
 * - 累积器上限（maxSteps）防止「死亡螺旋」：一旦某帧耗时过长，
 *   强行丢弃积压的物理步而不是无限追赶，否则会雪崩式卡死。
 * - 切后台回来时 dt 可能极大，先夹紧再累加，否则会瞬间推进上百步。
 *
 * 本模块不依赖任何游戏语义，可被复用。
 */

/**
 * @param {object} opts
 * @param {number} opts.fixedDt   物理固定步长（秒）
 * @param {number} opts.maxSteps  单帧最多推进的物理步数
 * @param {(dt:number)=>void} opts.step   物理步进
 * @param {(alpha:number)=>void} opts.draw 渲染，alpha 为插值因子 [0,1)
 * @param {(s:{steps:number, dropped:number, fps:number})=>void} [opts.onStats]
 */
export function createLoop({ fixedDt, maxSteps, step, draw, onStats }) {
  let raf = 0;
  let running = false;
  let last = -1;
  let acc = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 0;

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);

    if (last < 0) {
      last = t;
      return;
    }

    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.25) dt = 0.25;

    fpsAcc += dt;
    fpsFrames += 1;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }

    acc += dt;

    let steps = 0;
    while (acc >= fixedDt && steps < maxSteps) {
      step(fixedDt);
      acc -= fixedDt;
      steps += 1;
    }
    const dropped = acc;
    if (steps >= maxSteps) acc = 0;

    if (onStats) onStats({ steps, dropped, fps });
    draw(acc / fixedDt);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = -1;
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    },
    get running() {
      return running;
    },
  };
}

/**
 * 指数平滑：与帧率无关的阻尼逼近。
 * 把平滑系数写成 `1 - exp(-rate * dt)` 而不是固定百分比，
 * 这样 60Hz 与 144Hz 下的观感一致。
 */
export function smooth(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** 把 a 朝 b 移动最多 maxDelta，绝不越过。 */
export function approach(a, b, maxDelta) {
  if (a < b) return Math.min(a + maxDelta, b);
  if (a > b) return Math.max(a - maxDelta, b);
  return b;
}

/** 线性插值。 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 夹紧到 [lo, hi]。 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 确定性伪随机数发生器（mulberry32）。
 * 物理层严禁使用 Math.random() —— 否则「通关录像重放」的可解性验证失效。
 */
export function createRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
