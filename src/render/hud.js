/**
 * HUD。刻意留在 DOM 外壳里，不进 Canvas。
 *
 * 理由：文字排版（尤其中文与等宽数字）交给浏览器远比手写位图字体可靠；
 * 而且 HUD 不在游戏世界坐标系里，用 DOM 定位反而更自然。
 * Canvas 只负责"游戏里的东西"，UI 归 UI —— 这条边界让两边都简单。
 *
 * 刷新节流到 10Hz：每帧写 textContent 会让浏览器每帧重排，
 * 而这些数字人眼根本读不出 60Hz 的差别。
 */

const THROTTLE = 0.1;

export function createHud(elements = {}) {
  const elStats = elements.stats || document.getElementById('stats');
  const elDebug = elements.debug || document.getElementById('debug');

  let timer = 0;
  let debugVisible = true;

  return {
    /** @param {number} dt @param {object} s 一帧的状态快照 */
    update(dt, s) {
      timer -= dt;
      if (timer > 0) return;
      timer = THROTTLE;

      const fps = s.fps > 0 ? Math.round(s.fps) : 0;
      elStats.textContent =
        `${s.vx | 0} / ${s.vy | 0} u/s　${s.elapsed.toFixed(1)}s　死亡 ${s.deaths}　${fps} fps`;

      if (!debugVisible) {
        elDebug.textContent = '';
        return;
      }

      // padEnd 的宽度必须**严格大于**最长的 key，否则那一行不会被填充，
      // 会粘成 "particles0 / 400" 这种无法解析的形态（列对齐的经典坑）。
      const row = (k, v) => `${k.padEnd(10)}${v}\n`;
      elDebug.textContent =
        row('state', s.state) +
        row('ground', String(s.grounded)) +
        row('wall', `${s.wallDir}  lock ${s.wallLock.toFixed(2)}`) +
        row('coyote', s.coyote.toFixed(3)) +
        row('buffer', s.buffer.toFixed(3)) +
        row('dash', `${s.dashesLeft}  cd ${s.dashCd.toFixed(2)}  frz ${s.freeze.toFixed(2)}`) +
        row('stam', s.stamina.toFixed(2)) +
        row('particles', `${s.particles} / ${s.particleCap}`) +
        row('anchor', s.anchor);
    },

    toggleDebug() {
      debugVisible = !debugVisible;
    },

    flash(text) {
      elStats.textContent = text;
    },
  };
}
