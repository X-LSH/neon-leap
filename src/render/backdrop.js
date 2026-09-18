/**
 * 背景：双层视差网格 + 场景底色。
 *
 * 视差的计算方式：
 *   网格在屏幕上的位置 = (网格逻辑位置 + cam × (1 - parallax) - cam) × scale
 * 也就是把网格「推远」——cam 移动时它移动得更少。
 * 两层网格（3 格 / 1 格节距）足以建立纵深，再多就是浪费填充率。
 */

import { PAL } from './palette.js';
import { TILE } from '../game/config.js';

function drawParallaxGrid(ctx, view, cam, parallax, color, step) {
  const { worldW, worldH, scale } = view.state;
  const offX = cam.x * (1 - parallax);
  const offY = cam.y * (1 - parallax);

  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / scale; // 屏幕上恒为 1px，不随缩放变粗
  ctx.beginPath();

  const startX = Math.floor((cam.x - offX) / step) * step + offX;
  for (let x = startX; x <= cam.x + worldW; x += step) {
    ctx.moveTo(x, cam.y);
    ctx.lineTo(x, cam.y + worldH);
  }

  const startY = Math.floor((cam.y - offY) / step) * step + offY;
  for (let y = startY; y <= cam.y + worldH; y += step) {
    ctx.moveTo(cam.x, y);
    ctx.lineTo(cam.x + worldW, y);
  }

  ctx.stroke();
}

export function drawBackdrop(ctx, view, cam) {
  const { worldW, worldH } = view.state;

  ctx.globalAlpha = 1;
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(cam.x, cam.y, worldW, worldH);

  drawParallaxGrid(ctx, view, cam, 0.30, PAL.gridFar, TILE * 3);
  drawParallaxGrid(ctx, view, cam, 0.60, PAL.gridNear, TILE);
}
