/**
 * 视图层：画布尺寸、设备像素比、世界坐标 ↔ 屏幕坐标变换。
 *
 * 坐标系统：
 * - 世界使用抽象单位，与屏幕像素解耦。
 * - 视口**高度**固定（默认 270 世界单位 = 18 格 × 15），宽度按视口宽高比反推。
 *   这样任何屏幕比例下，玩家看到的纵向范围一致 —— 关卡设计才有确定性。
 * - scale 为浮点数。霓虹矢量是矢量图形，浮点缩放反而更清晰，
 *   不做像素对齐（那是像素画渲染才需要的）。
 */

export function createView(canvas, { viewHeight = 270, maxDpr = 2 } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });

  const state = {
    cssW: 0,
    cssH: 0,
    dpr: 1,
    scale: 1,
    worldW: 0,
    worldH: viewHeight,
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;

    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    state.cssW = cssW;
    state.cssH = cssH;
    state.dpr = dpr;
    state.scale = cssH / viewHeight;
    state.worldW = cssW / state.scale;
    state.worldH = viewHeight;
  }

  /**
   * 应用摄像机变换。之后所有绘制都用世界坐标。
   * 合成的变换矩阵为：屏幕 = (世界 - 摄像机) × scale × dpr
   */
  function applyCamera(camX, camY) {
    const s = state.scale * state.dpr;
    ctx.setTransform(s, 0, 0, s, -camX * s, -camY * s);
  }

  function resetTransform() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 世界坐标 → 画布 CSS 像素坐标（用于 DOM 覆盖层对齐）。 */
  function worldToCss(wx, wy, camX, camY) {
    return {
      x: (wx - camX) * state.scale,
      y: (wy - camY) * state.scale,
    };
  }

  /** 屏幕 CSS 像素坐标 → 世界坐标。 */
  function cssToWorld(x, y, camX, camY) {
    return {
      x: x / state.scale + camX,
      y: y / state.scale + camY,
    };
  }

  return { ctx, state, resize, applyCamera, resetTransform, worldToCss, cssToWorld };
}
