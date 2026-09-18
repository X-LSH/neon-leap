/**
 * 机关渲染。
 *
 * 颜色即规则，不因为「好看」而妥协：
 *   品红 #ff2d7a = 会杀死你的一切（尖刺、激光）
 *   青系        = 助力与地形（平台、弹跳板、崩塌地块）
 *   紫 #c16bff = 位移（传送门）
 *
 * 所有致命元素的**视觉体积必须 ≥ 判定体积**。
 * 玩家不该为一个看不见的判定框付出代价 —— 这是「死亡必可归因」的渲染侧落点。
 */

import { TILE } from '../game/config.js';
import { ENTITY, CRUMBLE_STATE, laserBox, portalCenter } from '../game/entities.js';
import { PAL } from './palette.js';
import { glowStroke, polyPath, rectPath, circlePath, linePath, litRect } from './draw.js';

/** 激光开启时的四层辉光：全屏只有激光与玩家允许这么亮。 */
const LASER_GLOW = [
  { width: 14, alpha: 0.10 },
  { width: 8, alpha: 0.22 },
  { width: 4, alpha: 0.55 },
  { width: 1.8, alpha: 1 },
];

function drawSpike(ctx, e) {
  const bx = e.tx * TILE;
  const by = e.ty * TILE;
  const p = TILE * 0.12;  // 视觉留边，让尖刺看起来"嵌"在格子里而不是溢出来
  const a = bx + p;
  const b = by + p;
  const c = bx + TILE - p;
  const d = by + TILE - p;
  const mx = bx + TILE / 2;
  const my = by + TILE / 2;

  let pts;
  if (e.dir.y === 1) pts = [[a, d], [mx, b], [c, d]];
  else if (e.dir.y === -1) pts = [[a, b], [mx, d], [c, b]];
  else if (e.dir.x === 1) pts = [[a, b], [c, my], [a, d]];
  else pts = [[c, b], [a, my], [c, d]];

  glowStroke(ctx, PAL.danger, polyPath(pts), { core: PAL.dangerCore });
}

function drawLaser(ctx, e, time) {
  const box = laserBox(e);

  if (e.on) {
    glowStroke(ctx, PAL.danger, linePath(e.x0, e.y0, e.x1, e.y1),
      { core: PAL.dangerCore, layers: LASER_GLOW });
  } else {
    // 无论开关，轨道都要可见 —— 玩家必须能预判激光会出现在哪里
    ctx.globalAlpha = e.warn ? 0.30 + 0.30 * Math.abs(Math.sin(time * 22)) : 0.16;
    ctx.strokeStyle = PAL.danger;
    ctx.lineWidth = box.w > box.h ? 1.5 : box.w;
    if (box.w > box.h) {
      const y = (e.y0 + e.y1) / 2;
      ctx.beginPath();
      ctx.moveTo(e.x0, y);
      ctx.lineTo(e.x1, y);
      ctx.stroke();
    } else {
      const x = (e.x0 + e.x1) / 2;
      ctx.beginPath();
      ctx.moveTo(x, e.y0);
      ctx.lineTo(x, e.y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 发射端 / 接收端：两枚小方块，让激光有"来源"
  const cap = 2.4;
  ctx.globalAlpha = e.on ? 1 : 0.5;
  ctx.fillStyle = e.on ? PAL.dangerCore : PAL.danger;
  ctx.fillRect(e.x0 - cap, e.y0 - cap, cap * 2, cap * 2);
  ctx.fillRect(e.x1 - cap, e.y1 - cap, cap * 2, cap * 2);
  ctx.globalAlpha = 1;
}

function drawPlatform(ctx, e) {
  litRect(ctx, e.x, e.y, e.w, e.h, PAL.platformFill, PAL.platformTop, 1.8);
  glowStroke(ctx, PAL.platformTop, rectPath(e.x, e.y, e.w, e.h), {
    layers: [
      { width: 5, alpha: 0.10 },
      { width: 2.2, alpha: 0.30 },
      { width: 0.9, alpha: 0.85 },
    ],
  });
}

function drawBounce(ctx, e) {
  litRect(ctx, e.x, e.y, e.w, e.h, PAL.platformFill, PAL.bounce, 1.6);
  // 向上的箭头，一眼说明「踩我会往上弹」
  const cx = e.x + e.w / 2;
  glowStroke(ctx, PAL.bounce, polyPath([
    [cx, e.y - TILE * 0.5],
    [cx + e.w * 0.22, e.y + e.h * 0.6],
    [cx - e.w * 0.22, e.y + e.h * 0.6],
  ]), { core: PAL.bounce });
}

function drawCrumble(ctx, e, time) {
  const bx = e.tx * TILE;
  const by = e.ty * TILE;
  const bw = e.tw * TILE;
  const bh = TILE;

  if (e.state === CRUMBLE_STATE.GONE) {
    // 消失期间只留虚线残影：玩家要看得出"这里本来有东西，还会回来"
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = PAL.platformEdge;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }

  const shaking = e.state === CRUMBLE_STATE.SHAKING;
  const jitter = shaking ? Math.sin(time * 40) * 0.9 : 0;
  const fill = shaking ? PAL.platformEdge : PAL.platformFill;
  const top = shaking ? PAL.danger : PAL.platformTop;

  litRect(ctx, bx + jitter, by, bw, bh, fill, top, 1.6);

  // 裂纹：三条折线，崩塌越近越明显
  ctx.globalAlpha = shaking ? 0.9 : 0.35;
  ctx.strokeStyle = shaking ? PAL.danger : PAL.platformEdge;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 1; i < e.tw; i++) {
    const x = bx + i * TILE;
    ctx.moveTo(x, by + 2);
    ctx.lineTo(x - 2, by + bh * 0.5);
    ctx.lineTo(x + 2, by + bh - 2);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPortal(ctx, e, time) {
  const pulse = 0.75 + 0.25 * Math.sin(time * 3);

  // 两端之间的牵引虚线，说明它们是一对
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = PAL.portal;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(e.ax, e.ay);
  ctx.lineTo(e.bx, e.by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  for (const end of ['a', 'b']) {
    const c = portalCenter(e, end);
    ctx.globalAlpha = pulse;
    glowStroke(ctx, PAL.portal, circlePath(c.x, c.y, TILE * 0.72), {
      layers: [
        { width: 7, alpha: 0.14 },
        { width: 3.2, alpha: 0.40 },
        { width: 1.3, alpha: 1 },
      ],
    });
    ctx.globalAlpha = 1;
    glowStroke(ctx, PAL.portal, circlePath(c.x, c.y, TILE * 0.34));
  }
}

/** 绘制全部机关。time 用于激光预警闪烁与崩塌抖动。 */
export function drawEntities(ctx, ents, time) {
  for (const e of ents.list) {
    switch (e.kind) {
      case ENTITY.SPIKE: drawSpike(ctx, e); break;
      case ENTITY.LASER: drawLaser(ctx, e, time); break;
      case ENTITY.PLATFORM: drawPlatform(ctx, e); break;
      case ENTITY.BOUNCE: drawBounce(ctx, e); break;
      case ENTITY.CRUMBLE: drawCrumble(ctx, e, time); break;
      case ENTITY.PORTAL: drawPortal(ctx, e, time); break;
      default: break;
    }
  }
}
