/**
 * 游戏主场景。唯一允许同时接触输入、更新与渲染的层。
 *
 * 渲染顺序（与 SPEC 第 4.2 节一致）：
 *   背景网格 → 地形 → 机关 → 粒子（残影在下、火花在上）→ 玩家 → 出口 → HUD(DOM)
 */

import { TILE } from '../game/config.js';
import { createWorld } from '../game/world.js';
import { createPlayer, updatePlayer, killPlayer, respawnPlayer } from '../game/player.js';
import { createCamera, updateCamera, snapCamera, shakeCamera } from '../game/camera.js';
import { createEntities, updateEntities, resetEntities } from '../game/entities.js';
import { resolveInteractions, makePlatformGroundCheck } from '../game/interact.js';
import { atExit } from '../game/replay.js';
import {
  createParticles, updateParticles, liveCount, clearParticles,
  burstDust, burstSparks, spawnGhost, burstDeath, spawnRing,
  spawnRipple, spawnWallSpark, burstBounce,
} from '../game/particles.js';
import { drawBackdrop } from '../render/backdrop.js';
import { drawTerrain, drawRuler } from '../render/stage.js';
import { drawEntities } from '../render/entities.js';
import { drawParticles } from '../render/particles.js';
import { drawPlayer, drawExit } from '../render/actors.js';
import { createHud } from '../render/hud.js';
import { createTouchControls, isTouchActive, onTouchActivate } from '../core/touch.js';
import testbed from '../levels/testbed.js';

const RESPAWN_DELAY = 0.45;
const PARTICLE_CAP = 400;

/** 残影发射间隔（秒）。每步都发会让池子被残影吃光。 */
const GHOST_INTERVAL = 0.022;
/** 墙滑火星的发射间隔。 */
const WALL_SPARK_INTERVAL = 0.045;

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

  function restart() {
    respawnPlayer(player, world.spawn.x * TILE, world.spawn.y * TILE);
    clearParticles(particles);
    camera.shake = 0;
    camera.offsetX = 0;
    camera.offsetY = 0;
    resetEntities(ents, world);
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
    resetEntities(ents, world);
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
      // 退出本关。此前 Esc 被 input 映射成 'pause' 却无人消费 ——
      // 结果就是「进了关只能靠通关出去」，桌面上也一样。触屏更是死路。
      else if (e === 'pause') { if (onExit) onExit(); }
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

  function render(alpha) {
    view.applyCamera(camera.x + camera.offsetX, camera.y + camera.offsetY);
    drawBackdrop(ctx, view, camera);
    drawTerrain(ctx, view, camera, world);
    if (world.level.showRuler) drawRuler(ctx, view, camera, world);
    drawEntities(ctx, ents, elapsed);
    drawExit(ctx, world, elapsed);
    drawParticles(ctx, particles);
    drawPlayer(ctx, player, elapsed, alpha);
  }

  // ── 触屏层 ────────────────────────────────────────────────────────
  // 只在触屏环境挂载。桌面端 DOM 里**一行都不会出现** ——
  // 这是规格 §7.3 的硬要求，也是 e2e 里专门看守的一条。
  let touchLayer = null;
  let offTouch = null;

  function syncTouch() {
    if (isTouchActive() && !touchLayer) {
      touchLayer = createTouchControls({
        input,
        muted: audio ? audio.muted : false,
        onBack: () => { if (onExit) onExit(); },
        onRestart: restart,
        onToggleMute: () => {
          const next = audio ? audio.toggleMute() : false;
          if (progress) progress.setMuted(next);   // 静音属于「设置」，要持久化
          return next;
        },
      });
      document.body.append(touchLayer.root);
    } else if (!isTouchActive() && touchLayer) {
      touchLayer.dispose();
      touchLayer = null;
    }
  }

  return {
    init() {
      snapCamera(camera, player, view, world);
      // 首次触摸随时可能发生（媒体查询可能一开始是 false），所以订阅而不是只判一次
      offTouch = onTouchActivate(syncTouch);
      syncTouch();
    },
    dispose() {
      if (offTouch) { offTouch(); offTouch = null; }
      if (touchLayer) { touchLayer.dispose(); touchLayer = null; }
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
