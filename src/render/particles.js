/**
 * 粒子渲染。
 *
 * 性能取向：
 *   - DUST / BURST 用 fillRect —— 这是 Canvas 2D 里最便宜的原语，没有之一。
 *   - SPARK / GHOST / RING / RIPPLE 需要描边，逐个 beginPath 是必要的开销，
 *     但它们数量少、寿命短，实测占比很低。
 *   - **不要为了"统一"把 fillRect 也换成路径** —— 那会让最常见的粒子变贵十倍。
 */

import { KIND, COLOR } from '../game/particles.js';
import { PAL } from './palette.js';

const COLORS = [PAL.player, PAL.danger, PAL.portal, PAL.bounce];

/** 火花拖尾长度系数：把速度换算成"看起来对"的线段长度。 */
const SPARK_TAIL = 0.032;

export function drawParticles(ctx, ps) {
  ctx.lineCap = 'round';

  for (let i = 0; i < ps.capacity; i++) {
    const life = ps.life[i];
    if (life <= 0) continue;

    const t = life / ps.maxLife[i];        // 1 → 0
    const color = COLORS[ps.color[i]];
    const x = ps.x[i];
    const y = ps.y[i];
    const s = ps.size[i];

    switch (ps.kind[i]) {
      case KIND.SPARK: {
        ctx.globalAlpha = t;
        ctx.strokeStyle = color;
        ctx.lineWidth = s * 0.75;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - ps.vx[i] * SPARK_TAIL, y - ps.vy[i] * SPARK_TAIL);
        ctx.stroke();
        break;
      }

      case KIND.GHOST: {
        const w = s;
        const h = s * 1.2;
        ctx.globalAlpha = t * 0.32;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
        ctx.stroke();
        break;
      }

      case KIND.RING: {
        const r = (1 - t) * 26 + 3;
        // alpha 必须够高：在近黑底上，半透明的环看起来像"一块黑影"而不是冲击波
        ctx.globalAlpha = t * 0.8;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8 * t + 0.5;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case KIND.RIPPLE: {
        const r = (1 - t) * 20 + 4;
        ctx.globalAlpha = t * 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      default: {
        // DUST / BURST：实心小方块
        ctx.globalAlpha = t;
        ctx.fillStyle = color;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        break;
      }
    }
  }

  ctx.globalAlpha = 1;
}
