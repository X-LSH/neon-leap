/**
 * 摇杆几何。纯函数，一个 DOM 都不碰。
 *
 * 为什么值得单独一个文件：45° 的扇区边界是触屏最容易出错的地方，
 * 而它在浏览器里几乎无法复现 —— 得靠手指恰好停在边界上才看得出来。
 * 抽成纯函数之后，8 个方向、8 条边界、死区、重定位上限都能在自检里一次问清楚。
 */

/** 死区（CSS px）。低于它视为没输入 —— 手指静止时的微抖不该让角色抽动。 */
export const STICK_DEADZONE = 12;
/** 跟随半径（CSS px）。手指拖出这个距离后，原点跟上去。 */
export const STICK_FOLLOW = 46;
/** 可视半径（CSS px）。环与旋钮的尺寸都用它。 */
export const STICK_RADIUS = 46;

/** 8 向查表。索引 = atan2 角度 / 45° 取整，0 = 正右，顺时针（屏幕 y 向下为正）。 */
const SECTORS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * 位移 → 8 向。
 * @param {number} dx @param {number} dy 相对原点的位移（CSS px）
 * @returns {[number, number]} [x, y]，各自取 -1 / 0 / 1
 */
export function stickDirection(dx, dy, deadzone = STICK_DEADZONE) {
  if (Math.hypot(dx, dy) < deadzone) return [0, 0];
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return SECTORS[((sector % 8) + 8) % 8];
}

/**
 * 动态重定位 + 方向解析。**就地把 origin 朝手指方向推**。
 *
 * 为什么必须重定位：手指在屏幕上只有那么大一块地方。
 * 原点焊死在按下的那一点，手指滑到区域边缘就再也推不出满偏 ——
 * 而「推不出满偏」在平台跳跃里等于「跑不到最高速」，
 * 是会直接毁掉手感的那种 bug，不是视觉瑕疵。
 *
 * @param {{x:number, y:number}} origin 会被就地修改
 * @returns {[number, number]} 方向
 */
export function trackStick(origin, px, py) {
  let dx = px - origin.x;
  let dy = py - origin.y;
  const dist = Math.hypot(dx, dy);

  if (dist > STICK_FOLLOW) {
    origin.x += dx * (1 - STICK_FOLLOW / dist);
    origin.y += dy * (1 - STICK_FOLLOW / dist);
    dx = px - origin.x;
    dy = py - origin.y;
  }

  return stickDirection(dx, dy);
}
