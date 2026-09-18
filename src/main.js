/**
 * 入口：把画布、循环、输入、场景焊在一起。
 *
 * 这个文件应当保持「短」—— 它只做装配，不放任何规则。
 */

import { createView } from './core/view.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { FIXED_DT, MAX_STEPS_PER_FRAME, VIEW_H } from './game/config.js';
import { createPlayScene } from './scenes/play.js';

const canvas = document.getElementById('screen');
const view = createView(canvas, { viewHeight: VIEW_H });
const input = createInput(window);
const scene = createPlayScene({ view, input });

view.resize();
scene.init();

const loop = createLoop({
  fixedDt: FIXED_DT,
  maxSteps: MAX_STEPS_PER_FRAME,
  step(dt) {
    // 事件只在第一个物理步消费一次；若本帧没有物理步，则留到下一帧，输入不丢。
    scene.handleEvents(input.takeEvents());
    scene.update(dt);
  },
  draw(alpha) {
    scene.render(alpha);
  },
  onStats(s) {
    scene.setFps(s.fps);
  },
});

function refit() {
  view.resize();
  scene.onResize();
}

window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => setTimeout(refit, 120));

loop.start();
