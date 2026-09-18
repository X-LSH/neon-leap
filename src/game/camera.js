/**
 * 摄像机。表现层模块 —— 它是唯一允许在渲染阶段持有状态的组件。
 *
 * 设计要点：
 * - 水平方向带「前瞻」：朝移动方向偏移，让玩家看到更多前方的路。
 * - 垂直方向刻意迟钝：跳跃时画面不跟着上下窜，否则玩十分钟就想吐。
 * - 阻尼用指数平滑（`1 - exp(-rate·dt)`），保证 60Hz 与 144Hz 观感一致。
 * - 震动使用确定性 RNG 驱动，避免引入 Math.random（物理层禁止，表现层也不必要）。
 */

import { smooth, clamp, createRng } from '../core/loop.js';

export function createCamera() {
  return {
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
    shake: 0,
    rng: createRng(0x9e3779b9),
  };
}

/** 把摄像机直接摆到目标位置，不做平滑（用于关卡开始 / 重生）。 */
export function snapCamera(cam, target, view, world) {
  const t = desired(cam, target, view, world);
  cam.x = t.x;
  cam.y = t.y;
  cam.shake = 0;
  cam.offsetX = 0;
  cam.offsetY = 0;
}

function desired(cam, target, view, world) {
  const lookAhead = clamp(target.vx * 0.28, -70, 70);
  const cx = target.x + target.w / 2 + lookAhead;
  const cy = target.y + target.h / 2;

  // 垂直方向只跟随「可靠的地面」：腾空时锁定，落地与攀爬时才更新。
  const trackY = target.grounded || target.state === 'climb';

  let tx = cx - view.state.worldW / 2;
  let ty = trackY ? cy - view.state.worldH * 0.58 : cam.y;

  if (world.worldW > view.state.worldW) {
    tx = clamp(tx, 0, world.worldW - view.state.worldW);
  } else {
    tx = (world.worldW - view.state.worldW) / 2;
  }
  if (world.worldH > view.state.worldH) {
    ty = clamp(ty, 0, world.worldH - view.state.worldH);
  } else {
    ty = (world.worldH - view.state.worldH) / 2;
  }

  return { x: tx, y: ty };
}

export function updateCamera(cam, target, view, world, dt) {
  const t = desired(cam, target, view, world);
  cam.x = smooth(cam.x, t.x, 12, dt);
  cam.y = smooth(cam.y, t.y, 7, dt);

  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 26);
    const mag = cam.shake * cam.shake * 0.02;
    cam.offsetX = (cam.rng() * 2 - 1) * mag;
    cam.offsetY = (cam.rng() * 2 - 1) * mag;
  } else {
    cam.offsetX = 0;
    cam.offsetY = 0;
  }
}

/** 触发震动。amount 会被取最大值，避免多次触发叠加成癫痫。 */
export function shakeCamera(cam, amount) {
  if (amount > cam.shake) cam.shake = amount;
}
