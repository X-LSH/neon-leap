/**
 * 入口：把画布、循环、输入、场景焊在一起。
 *
 * 场景路由很薄：任意时刻只有一个活跃场景，
 * 切换时先 `dispose`（清掉它留下的 DOM 与监听）再 `init` 下一个。
 * 这一层刻意不引入"场景栈""转场动画"之类的抽象 ——
 * 本作只有两个场景，透明的 if/else 比一个通用框架更容易看懂。
 */

import { createView } from './core/view.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { FIXED_DT, MAX_STEPS_PER_FRAME, VIEW_H } from './game/config.js';
import { createProgress } from './game/progress.js';
import { createSelectScene } from './scenes/select.js';
import { createPlayScene } from './scenes/play.js';
import { LEVELS } from './levels/index.js';

const canvas = document.getElementById('screen');
const view = createView(canvas, { viewHeight: VIEW_H });
const input = createInput(window);
const progress = createProgress(LEVELS);

let scene = null;

function switchTo(next) {
  if (scene && typeof scene.dispose === 'function') scene.dispose();
  scene = next;
  scene.init();
}

function gotoSelect() {
  switchTo(createSelectScene({
    input,
    levels: LEVELS,
    progress,
    onPick: (level) => gotoPlay(level),
  }));
}

function gotoPlay(level) {
  switchTo(createPlayScene({
    view,
    input,
    level,
    progress,
    onExit: gotoSelect,
  }));
}

view.resize();
gotoSelect();

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
