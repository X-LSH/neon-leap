/**
 * WebAudio 程序化合成器。
 *
 * ★ 为什么不放音频文件
 *
 * 九类音效如果做成 mp3/wav，至少几百 KB，还要处理预加载、解码延迟、
 * 移动端自动播放策略、格式兼容 —— 而它们全都只是「一个振荡器扫频 + 一个包络」。
 * 实时合成的好处不只是省带宽：
 *   1. **零加载延迟**：第一个音在按下按键的那一帧就响，这对跳跃手感是决定性的。
 *   2. **参数即代码**：想改音色就改数字，不用重新导出一堆资源。
 *   3. **体积为零**：整个音频层不到 200 行，比一个 1 秒的 wav 还小。
 *
 * ★ 两条硬性约束
 *
 *   1. **必须由用户手势解锁。** 浏览器的自动播放策略会挂起 AudioContext，
 *      在第一次按键/点击前它是 suspended 状态。这是「默认静止」在音频侧的体现，
 *      也决定了标题页必须有个「点击开始」而不是自动进入。
 *   2. **同帧同类音效必须限频。** 玩家同时踩到两个弹跳板会触发两次合成，
 *      叠加起来是爆音。限频比"检测重复"简单且更鲁棒。
 */

const MIN_INTERVAL_MS = 45;   // 同一音效的最小间隔
const MASTER_GAIN = 0.32;

export function createAudio({ muted = false } = {}) {
  let ctx = null;
  let master = null;
  let isMuted = muted;
  const lastAt = Object.create(null);

  /** 惰性创建：AudioContext 在构造时就占用系统音频资源，不该在页面加载时创建。 */
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;

    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = isMuted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    return ctx;
  }

  /** 用户手势后调用。浏览器会挂起未解锁的 AudioContext。 */
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }

  /**
   * 扫频音。
   * @param {object} o
   * @param {OscillatorType} o.type 波形
   * @param {number} o.from 起始频率
   * @param {number} o.to 结束频率
   * @param {number} o.dur 时长（秒）
   * @param {number} [o.gain] 峰值增益
   * @param {number} [o.delay] 延迟（秒），用于琶音
   */
  function tone({ type = 'sine', from, to, dur, gain = 0.25, delay = 0 }) {
    const c = ensure();
    if (!c) return;

    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const env = c.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, from), t0);
    if (to !== from) {
      // 指数扫频更接近自然听感；频率不能到 0，否则抛异常
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    }

    // 快起快落：起音 8ms 避免爆音，衰减到接近零
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** 噪声爆发，用于冲刺与死亡。 */
  function noise({ dur, gain = 0.2, delay = 0, lowpass = 4000 }) {
    const c = ensure();
    if (!c) return;

    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    // 音频层的噪声不需要确定性（它不参与物理与回放判定），用 Math.random 更省事
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buf;

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpass, t0);

    const env = c.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(env).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    /** 起跳：短促上滑，干净利落。 */
    jump: () => tone({ type: 'triangle', from: 190, to: 430, dur: 0.08, gain: 0.20 }),

    /** 冲刺：噪声爆发 + 下滑，强调"速度"。 */
    dash: () => {
      noise({ dur: 0.14, gain: 0.16, lowpass: 6000 });
      tone({ type: 'sawtooth', from: 620, to: 170, dur: 0.14, gain: 0.12 });
    },

    /** 落地：低频闷响，给"重量"。 */
    land: () => {
      tone({ type: 'sine', from: 90, to: 55, dur: 0.07, gain: 0.26 });
      noise({ dur: 0.035, gain: 0.07, lowpass: 1200 });
    },

    /** 墙跳：方波上行，比普通跳更"硬"。 */
    wallJump: () => tone({ type: 'square', from: 300, to: 520, dur: 0.09, gain: 0.14 }),

    /** 弹跳板：大跨度上滑 + 颤音，明确"被弹飞"。 */
    bounce: () => {
      tone({ type: 'sine', from: 200, to: 900, dur: 0.20, gain: 0.20 });
      tone({ type: 'triangle', from: 300, to: 1350, dur: 0.20, gain: 0.07, delay: 0.02 });
    },

    /** 攀爬翻越：一个轻快的上挑，区别于跳跃。 */
    mantle: () => tone({ type: 'triangle', from: 260, to: 620, dur: 0.12, gain: 0.16 }),

    /** 检查点：双音上行，正向反馈。 */
    checkpoint: () => {
      tone({ type: 'sine', from: 660, to: 660, dur: 0.07, gain: 0.18 });
      tone({ type: 'sine', from: 990, to: 990, dur: 0.12, gain: 0.18, delay: 0.07 });
    },

    /** 死亡：长下滑 + 噪声，明确"失败"。 */
    death: () => {
      tone({ type: 'sawtooth', from: 420, to: 70, dur: 0.30, gain: 0.20 });
      noise({ dur: 0.22, gain: 0.12, lowpass: 2200 });
    },

    /** 过关：三音琶音（C5-E5-G5），唯一的"完整乐句"。 */
    clear: () => {
      tone({ type: 'triangle', from: 523, to: 523, dur: 0.16, gain: 0.22 });
      tone({ type: 'triangle', from: 659, to: 659, dur: 0.16, gain: 0.22, delay: 0.12 });
      tone({ type: 'triangle', from: 784, to: 784, dur: 0.34, gain: 0.24, delay: 0.24 });
    },

    /** 传送门：反向扫频（由远及近）。 */
    portal: () => tone({ type: 'sine', from: 880, to: 240, dur: 0.12, gain: 0.16 }),

    /** 菜单确认。 */
    ui: () => tone({ type: 'square', from: 520, to: 780, dur: 0.06, gain: 0.10 }),
  };

  /**
   * 播放一个音效。
   * 同一音效在 MIN_INTERVAL_MS 内重复触发会被丢弃 ——
   * 玩家同时踩到两个弹跳板会触发两次合成，叠加起来就是爆音。
   */
  function play(name) {
    if (isMuted) return;
    const fn = SFX[name];
    if (!fn) return;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (lastAt[name] && now - lastAt[name] < MIN_INTERVAL_MS) return;
    lastAt[name] = now;

    try {
      fn();
    } catch {
      // 音频失败绝不能影响游戏 —— 静默降级
    }
  }

  return {
    unlock,
    play,
    /** 直接播一个任意参数的声音（供调试与扩展）。 */
    tone,
    noise,

    setMuted(v) {
      isMuted = !!v;
      if (master) master.gain.value = isMuted ? 0 : MASTER_GAIN;
    },
    toggleMute() {
      this.setMuted(!isMuted);
      return isMuted;
    },
    get muted() {
      return isMuted;
    },
    get ready() {
      return !!ctx && ctx.state === 'running';
    },
  };
}
