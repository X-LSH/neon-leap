/**
 * 玩家与出口的渲染。只有这两个东西允许「多一层外晕」。
 *
 * 从 play.js 抽出。焦点必须唯一 —— 到处发光等于没有焦点，
 * 所以这份多一层的特权被单独放进一个文件，谁想再加就得先改这里。
 */

import { TILE, CFG } from '../game/config.js';
import { interpolated } from '../game/player.js';
import { PAL } from './palette.js';
import { glowStroke, polyPath, circlePath } from './draw.js';

/**
 * 玩家专用的四层辉光：比默认多一层外晕。
 * 成本是 4 次 stroke()，而全屏只有一个玩家，完全付得起。
 */
const PLAYER_GLOW = [
  { width: 12, alpha: 0.06 },
  { width: 7, alpha: 0.13 },
  { width: 3.4, alpha: 0.32 },
  { width: 1.3, alpha: 1 },
];

export function drawPlayer(ctx, player, elapsed, alpha) {
  const pos = interpolated(player, alpha);
  const cx = pos.x + player.w / 2;
  const cy = pos.y + player.h / 2;

  if (player.dead) {
    glowStroke(ctx, PAL.danger, circlePath(cx, cy, player.w), { core: PAL.dangerCore });
    return;
  }

  // 攀爬时的耐力反馈：颜色随耐力衰减，低于 30% 开始闪烁。
  // 没有这个，玩家爬到一半掉下去会完全不知道为什么 ——
  // 这是「死亡必可归因」在视觉层的延伸：坠落的原因必须**看得见**。
  let glowColor = PAL.player;
  let coreColor = PAL.playerCore;
  if (player.state === 'climb') {
    const ratio = player.stamina / CFG.climbStamina;
    if (ratio < 0.3) {
      const blink = Math.sin(elapsed * 30) > 0;
      glowColor = blink ? PAL.danger : PAL.player;
      coreColor = blink ? PAL.dangerCore : PAL.playerCore;
    }
  }

  glowStroke(ctx, glowColor, polyPath([
    [cx, pos.y],
    [pos.x + player.w, cy],
    [cx, pos.y + player.h],
    [pos.x, cy],
  ]), { core: coreColor, layers: PLAYER_GLOW });

  // 朝向指示：面朝方向一个小三角，让「我在往哪走」一眼可见
  const f = player.facing;
  glowStroke(ctx, glowColor, (c) => {
    c.beginPath();
    c.moveTo(cx + f * 1.5, cy);
    c.lineTo(cx - f * 2.5, cy - 2);
    c.lineTo(cx - f * 2.5, cy + 2);
    c.closePath();
    c.stroke();
  });
}

/** 出口。呼吸式明暗——静止的目标很难被注意到，而它是唯一必须被看见的东西。 */
export function drawExit(ctx, world, elapsed) {
  if (!world.exit) return;
  const cx = world.exit.tx * TILE + TILE / 2;
  const cy = world.exit.ty * TILE + TILE / 2;

  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(elapsed * 3);
  glowStroke(ctx, PAL.exit, polyPath([
    [cx, cy - TILE * 0.55],
    [cx + TILE * 0.4, cy],
    [cx, cy + TILE * 0.55],
    [cx - TILE * 0.4, cy],
  ]), { core: PAL.exit });
  ctx.globalAlpha = 1;
}
