/**
 * 游戏主场景。唯一允许同时接触输入、更新与渲染的层。
 *
 * 渲染顺序（与 SPEC 第 4.2 节一致）：
 *   背景网格 → 地形 → 机关 → 粒子（残影在下、火花在上）→ 玩家 → 出口 → HUD(DOM)
 */

import { TILE, CFG } from '../game/config.js';
import { createWorld } from '../game/world.js';
import { createPlayer, updatePlayer, killPlayer, respawnPlayer, interpolated } from '../game/player.js';
import { createCamera, updateCamera, snapCamera, shakeCamera } from '../game/camera.js';
import { createEntities, updateEntities, ENTITY, CRUMBLE_STATE } from '../game/entities.js';
import { resolveInteractions, makePlatformGroundCheck } from '../game/interact.js';
import { atExit } from '../game/replay.js';
import {
  createParticles, updateParticles, liveCount, clearParticles,
  burstDust, burstSparks, spawnGhost, burstDeath, spawnRing,
  spawnRipple, spawnWallSpark, burstBounce,
} from '../game/particles.js';
import { drawBackdrop } from '../render/backdrop.js';
import { drawEntities } from '../render/entities.js';
import { drawParticles } from '../render/particles.js';
import { createHud } from '../render/hud.js';
import { PAL } from '../render/palette.js';
import { glowStroke, polyPath, circlePath } from '../render/draw.js';
import testbed from '../levels/testbed.js';

const RESPAWN_DELAY = 0.45;
const PARTICLE_CAP = 400;

/** 残影发射间隔（秒）。每步都发会让池子被残影吃光。 */
const GHOST_INTERVAL = 0.022;
/** 墙滑火星的发射间隔。 */
const WALL_SPARK_INTERVAL = 0.045;

/**
 * 玩家专用的四层辉光：比默认多一层外晕。
 * 全屏只有玩家和出口允许享受这个待遇 —— 焦点必须唯一，到处发光等于没有焦点。
 * 成本是 4 次 stroke()，而全屏只有一个玩家，完全付得起。
 */
const PLAYER_GLOW = [
  { width: 12, alpha: 0.06 },
  { width: 7, alpha: 0.13 },
  { width: 3.4, alpha: 0.32 },
  { width: 1.3, alpha: 1 },
];

export function createPlayScene({ view, input, level = testbed, progress = null, onExit = null, audio = null }) {
  const ctx = view.ctx;

  const world = createWorld(level);
  const player = createPlayer(world.spawn.x * TILE, world.spawn.y * TILE);
  const camera = createCamera();
  const ents = createEntities(world);
  const groundCheck = makePlatformGroundCheck(ents);
  const particles = createParticles({ capacity: PARTICLE_CAP });
  const hud = createHud();

  let elapsed = 0;
  let deaths = 0;
  let respawnTimer = 0;
  let ghostTimer = 0;
  let wallSparkTimer = 0;
  let cleared = false;

  /** 关卡重开时把机关恢复到初始状态（含崩塌地块与各类冷却）。 */
  function resetEntities() {
    ents.time = 0;
    world.clearDynamicSolid();
    for (const e of ents.list) {
      if (e.kind === ENTITY.CRUMBLE) {
        e.state = CRUMBLE_STATE.IDLE;
        e.timer = 0;
      } else if (e.kind === ENTITY.BOUNCE || e.kind === ENTITY.PORTAL) {
        e.cooldown = 0;
      }
    }
  }

  function restart() {
    respawnPlayer(player, world.spawn.x * TILE, world.spawn.y * TILE);
    clearParticles(particles);
    camera.shake = 0;
    camera.offsetX = 0;
    camera.offsetY = 0;
    resetEntities();
    snapCamera(camera, player, view, world);
  }

  /**
   * 考区跳转。测试场横跨 112 格，靠双腿跑一遍要十几秒，
   * 调参时这个成本会让「改一个数 → 试一下」的循环变得不可忍受。
   * 正式关卡不需要这个功能，它是测试场专用的开发期工具。
   */
  let anchorIndex = 0;
  function jumpAnchor(dir) {
    const anchors = world.level.anchors;
    if (!anchors || anchors.length === 0) return;
    anchorIndex = (anchorIndex + dir + anchors.length) % anchors.length;
    const a = anchors[anchorIndex];
    respawnPlayer(player, a.x * TILE, a.y * TILE);
    resetEntities();
    clearParticles(particles);
    camera.shake = 0;
    snapCamera(camera, player, view, world);
    hud.flash(`考区 · ${a.name}`);
  }

  function handleEvents(events) {
    for (const e of events) {
      if (e === 'restart') restart();
      else if (e === 'toggleDebug') hud.toggleDebug();
      else if (e === 'nextAnchor') jumpAnchor(1);
      else if (e === 'prevAnchor') jumpAnchor(-1);
    }
  }

  function update(dt) {
    elapsed += dt;

    // 顺序不可调换：机关先动（平台位置/激光相位/崩塌计时），
    // 玩家再物理，最后才做交互修正（携带、吸附、致命判定）。
    updateEntities(ents, world, dt);
    updatePlayer(player, input.intent(), world, dt, groundCheck);
    const hit = resolveInteractions(player, ents);
    input.endStep();

    // ── 视觉反馈：每个机动都必须在「发生的同一帧」给出回应。
    //    玩家对机制的信任，来自机制对操作的即时回应；
    //    延迟一帧的反馈就会让人怀疑「到底生效没有」。
    const cx = player.x + player.w / 2;
    const feetY = player.y + player.h;

    if (player.justJumped) {
      burstDust(particles, cx, feetY, 0.75, 5);
      // 翻越、墙跳、普通跳是三件不同的事，给三个不同的音 ——
      // 玩家靠声音就能确认「我刚才那个操作被识别成了什么」
      audio?.play(player.justMantled ? 'mantle' : (player.justWallJumped ? 'wallJump' : 'jump'));
    }
    if (player.justLanded) {
      burstDust(particles, cx, feetY, 1.25, 8);
      spawnRing(particles, cx, feetY);
      shakeCamera(camera, 1.4);
      audio?.play('land');
    }
    if (player.justDashed) {
      burstSparks(particles, cx, player.y + player.h / 2, player.dashDirX, player.dashDirY, 10);
      audio?.play('dash');
    }

    // 残影按固定间隔发射：每步都发会把池子吃光，那是"看起来更炫"和"跑得动"的分界线
    if (player.freeze > 0 || player.dashTimer > 0) {
      ghostTimer -= dt;
      if (ghostTimer <= 0) {
        ghostTimer = GHOST_INTERVAL;
        spawnGhost(particles, player.x, player.y, player.w);
      }
    } else {
      ghostTimer = 0;
    }

    if (player.state === 'wall_slide') {
      wallSparkTimer -= dt;
      if (wallSparkTimer <= 0) {
        wallSparkTimer = WALL_SPARK_INTERVAL;
        spawnWallSpark(
          particles,
          player.wallDir > 0 ? player.x + player.w : player.x,
          player.y + player.h,
          player.wallDir,
        );
      }
    } else {
      wallSparkTimer = 0;
    }

    for (const ev of hit.events) {
      if (ev.type === 'bounce') {
        burstBounce(particles, cx, feetY, 14);
        shakeCamera(camera, 3.5);
        audio?.play('bounce');
      } else if (ev.type === 'portal') {
        spawnRipple(particles, cx, player.y + player.h / 2);
        shakeCamera(camera, 2.5);
        audio?.play('portal');
      }
    }

    if (hit.killed && !player.dead) {
      killPlayer(player);
      burstDeath(particles, cx, player.y + player.h / 2, 26);
      shakeCamera(camera, 11);
      respawnTimer = RESPAWN_DELAY;
      audio?.play('death');
    }

    // 掉出世界 → 死亡。留一小段停顿让震动与爆散被看见，再复活。
    if (!player.dead && player.y > world.worldH + 60) {
      killPlayer(player);
      shakeCamera(camera, 9);
      respawnTimer = RESPAWN_DELAY;
    }
    if (player.dead) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        deaths += 1;
        // 死亡计数只在真正死亡时写，不进热路径（localStorage 是同步 API，写一次会阻塞主线程）
        if (progress) progress.recordDeath();
        restart();
      }
    }

    // 通关：记录成绩 → 返回关卡选择。
    // 放在死亡处理之后，避免「同一帧既死又通关」这种边界情况下重复触发。
    if (!cleared && atExit(player, world)) {
      cleared = true;
      audio?.play('clear');
      if (progress) progress.recordClear(level.id, Math.round(elapsed * 1000), deaths);
      if (onExit) onExit();
      return;
    }

    updateParticles(particles, dt);
    updateCamera(camera, player, view, world, dt);
    updateHud(dt);
  }

  let lastFps = 0;

  function updateHud(dt) {
    hud.update(dt, {
      vx: player.vx,
      vy: player.vy,
      elapsed,
      deaths,
      fps: lastFps,
      state: player.state,
      grounded: player.grounded,
      wallDir: player.wallDir,
      wallLock: player.wallLock,
      coyote: player.coyote,
      buffer: player.buffer,
      dashesLeft: player.dashesLeft,
      dashCd: player.dashCd,
      freeze: player.freeze,
      stamina: player.stamina,
      particles: liveCount(particles),
      particleCap: particles.capacity,
      anchor: world.level.anchors ? world.level.anchors[anchorIndex].name : '-',
    });
  }

  function visibleTileRange() {
    const { worldW, worldH } = view.state;
    return {
      x0: Math.max(0, Math.floor(camera.x / TILE) - 1),
      x1: Math.min(world.w - 1, Math.ceil((camera.x + worldW) / TILE) + 1),
      y0: Math.max(0, Math.floor(camera.y / TILE) - 1),
      y1: Math.min(world.h - 1, Math.ceil((camera.y + worldH) / TILE) + 1),
    };
  }

  /** 收集所有「上方为空」的实心段，用于画受光顶边。 */
  function collectLitRuns(x0, x1, y0, y1) {
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

  function drawTiles() {
    const { x0, x1, y0, y1 } = visibleTileRange();
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

    // ③ 受光顶边（光源恒在正上方）：粗光晕 + 细核心，两层伪造辉光
    const lit = collectLitRuns(x0, x1, y0, y1);
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

  /** 测试场专用：地面每 5 格一根距离标尺，用来量冲刺与跳跃的实际覆盖。 */
  function drawRuler() {
    const { x0, x1 } = visibleTileRange();
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

  function drawPlayer(alpha) {
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

  function drawExit() {
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

  function render(alpha) {
    view.applyCamera(camera.x + camera.offsetX, camera.y + camera.offsetY);
    drawBackdrop(ctx, view, camera);
    drawTiles();
    if (world.level.showRuler) drawRuler();
    drawEntities(ctx, ents, elapsed);
    drawExit();
    drawParticles(ctx, particles);
    drawPlayer(alpha);
  }

  return {
    init() {
      snapCamera(camera, player, view, world);
    },
    update,
    render,
    handleEvents,
    setFps(v) {
      lastFps = v;
    },
    onResize() {
      view.resize();
    },
  };
}
