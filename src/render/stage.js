/**
 * 地形与标尺渲染。
 *
 * 从 play.js 抽出来的。那一层是「场景编排」——输入 → 更新 → 反馈 → 渲染顺序，
 * 它不该同时揣着四段底层绘制细节。拆开之后两边都更短也更好读：
 * 场景层一眼看得见「画了什么、按什么顺序」，这里一块看得见「怎么画」。
 *
 * 光源方向**恒为正上方**，与 draw.js 的 litRect 一致 —— 全站统一的受光方向，
 * 体积感才不会一半朝向这边一半朝向那边。
 */

import { TILE } from '../game/config.js';
import { PAL } from './palette.js';

/** 视口覆盖到的格子范围。四周各多留一格，避免摄像机移动时边缘露白。 */
export function visibleTileRange(view, camera, world) {
  const { worldW, worldH } = view.state;
  return {
    x0: Math.max(0, Math.floor(camera.x / TILE) - 1),
    x1: Math.min(world.w - 1, Math.ceil((camera.x + worldW) / TILE) + 1),
    y0: Math.max(0, Math.floor(camera.y / TILE) - 1),
    y1: Math.min(world.h - 1, Math.ceil((camera.y + worldH) / TILE) + 1),
  };
}

/** 收集所有「上方为空」的实心段，用于画受光顶边。 */
function collectLitRuns(world, x0, x1, y0, y1) {
  const runs = [];
  for (let ty = y0; ty <= y1; ty++) {
    let run = -1;
    for (let tx = x0; tx <= x1 + 1; tx++) {
      const lit = tx <= x1 && world.isSolid(tx, ty) && !world.isSolid(tx, ty - 1);
      if (lit && run < 0) run = tx;
      else if (!lit && run >= 0) {
        runs.push([run, tx, ty]);
        run = -1;
      }
    }
  }
  return runs;
}

/** 地形四层：体填充 → 内部格纹 → 受光顶边 → 暴露侧面。顺序即明度台阶，不可调换。 */
export function drawTerrain(ctx, view, camera, world) {
  const { x0, x1, y0, y1 } = visibleTileRange(view, camera, world);
  const hairline = 1 / view.state.scale;

  // ① 体填充：按行合并连续段，把 fillRect 调用数从 O(格数) 压到 O(段数)
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAL.platformFill;
  for (let ty = y0; ty <= y1; ty++) {
    let run = -1;
    for (let tx = x0; tx <= x1 + 1; tx++) {
      const solid = tx <= x1 && world.isSolid(tx, ty);
      if (solid && run < 0) run = tx;
      else if (!solid && run >= 0) {
        ctx.fillRect(run * TILE, ty * TILE, (tx - run) * TILE, TILE);
        run = -1;
      }
    }
  }

  // ② 内部格纹：给大块实心一个「材质」。
  // 没有这一层，两层厚的地面会糊成一坨死黑 —— 明度台阶必须有第四级。
  ctx.strokeStyle = PAL.platformInner;
  ctx.lineWidth = hairline;
  ctx.beginPath();
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (world.isSolid(tx, ty)) ctx.rect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
    }
  }
  ctx.stroke();

  // ③ 受光顶边：粗光晕 + 细核心，两层伪造辉光
  const lit = collectLitRuns(world, x0, x1, y0, y1);
  ctx.fillStyle = PAL.platformTop;
  ctx.globalAlpha = 0.20;
  for (const [a, b, ty] of lit) ctx.fillRect(a * TILE, ty * TILE, (b - a) * TILE, 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAL.platformGlow;
  for (const [a, b, ty] of lit) ctx.fillRect(a * TILE, ty * TILE, (b - a) * TILE, 1.6);

  // ④ 暴露侧面轮廓，让块与背景分层
  ctx.strokeStyle = PAL.platformEdge;
  ctx.lineWidth = hairline;
  ctx.beginPath();
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!world.isSolid(tx, ty)) continue;
      if (!world.isSolid(tx + 1, ty)) {
        ctx.moveTo((tx + 1) * TILE, ty * TILE);
        ctx.lineTo((tx + 1) * TILE, (ty + 1) * TILE);
      }
      if (!world.isSolid(tx - 1, ty)) {
        ctx.moveTo(tx * TILE, ty * TILE);
        ctx.lineTo(tx * TILE, (ty + 1) * TILE);
      }
    }
  }
  ctx.stroke();
}

/**
 * 测试场专用：地面每 5 格一根距离标尺，用来量冲刺与跳跃的实际覆盖。
 * 正式关卡不带 showRuler，所以这段在线上永远不会执行。
 */
export function drawRuler(ctx, view, camera, world) {
  const { x0, x1 } = visibleTileRange(view, camera, world);
  const gy = 19 * TILE;

  ctx.globalAlpha = 1;
  ctx.strokeStyle = PAL.debug;
  ctx.fillStyle = PAL.debug;
  ctx.lineWidth = 1 / view.state.scale;
  ctx.font = '3px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.beginPath();
  for (let tx = Math.ceil(x0 / 5) * 5; tx <= x1; tx += 5) {
    ctx.moveTo(tx * TILE, gy);
    ctx.lineTo(tx * TILE, gy - 6);
  }
  ctx.stroke();

  for (let tx = Math.ceil(x0 / 5) * 5; tx <= x1; tx += 5) {
    ctx.fillText(String(tx), tx * TILE, gy - 9);
  }
}
