/**
 * 手感测试场（灰盒）。
 *
 * 这不是正式关卡，而是 Phase 1 的**调参仪器**。
 * 每一段地形都对应一条待校准的 config.js 常量；改完参数就来这里跑一遍。
 *
 * 布局（世界单位 = 格 × 15）：
 *   ① x1–20    起跑道          → 校准 runAccel / runMax
 *   ② x22–24   三格坑          → 短按跳不过去，逼出冲刺
 *   ③ x27–36   渐高台阶        → 校准 JUMP_APEX 与可变跳跃高度
 *   ④ x39–42   四格坑          → 校准 DASH_REACH
 *   ⑤ x50–53   窄槽（双面墙）  → 校准墙滑、墙跳、wallJumpLock
 *   ⑥ x57–58   四格高墙        → 校准抓墙耐力 CLIMB_REACH
 *   ⑦ x62–70   头顶横梁        → 校准撞头与 fastFall
 *   ⑧ x72–108  终点平地 + 出口
 *
 * 高度取 26 格而非最小可用的 18 格：地面只做两层厚，下方留空。
 * 这样地面看起来是「浮空平台」，同时让摄像机在垂直方向有富余行程，
 * 玩家稳定落在屏幕 59% 处而不是贴着底边 —— 视口几何是被算出来的，不是试出来的。
 */

const W = 112;
const H = 26;
const GROUND_Y = 19;
const GROUND_THICK = 2;

function build() {
  const g = Array.from({ length: H }, () => new Array(W).fill('.'));

  const rect = (x0, y0, x1, y1, ch = '#') => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = ch;
    }
  };

  // 地面（两层厚）与左右封边。
  // 左右越界在 world.isSolid 里已判为实心，这里的封边只是为了视觉框架。
  rect(1, GROUND_Y, W - 2, GROUND_Y + GROUND_THICK - 1);
  rect(0, 0, 0, GROUND_Y + GROUND_THICK - 1);
  rect(W - 1, 0, W - 1, GROUND_Y + GROUND_THICK - 1);

  // ② 三格坑：短按跳（约 2.7 格水平距离）跳不过去
  rect(22, GROUND_Y, 24, H - 1, '.');

  // ③ 渐高台阶：每级 1 格，验证跳跃够不够得着
  rect(27, GROUND_Y - 1, 30, GROUND_Y - 1);
  rect(31, GROUND_Y - 2, 34, GROUND_Y - 2);
  rect(31, GROUND_Y - 1, 34, GROUND_Y - 1);
  rect(35, GROUND_Y - 3, 36, GROUND_Y - 2);
  rect(35, GROUND_Y - 1, 36, GROUND_Y - 1);

  // ④ 四格坑：必须冲刺跨越
  rect(39, GROUND_Y, 42, H - 1, '.');

  // ⑤ 窄槽：两堵墙夹一条 2 格宽的缝，掉进去只能靠墙跳爬出来
  rect(50, 13, 50, GROUND_Y - 1);
  rect(53, 13, 53, GROUND_Y - 1);

  // ⑥ 四格高墙：验证抓墙 + 墙跳组合够不够爬上顶
  rect(57, GROUND_Y - 4, 58, GROUND_Y - 1);

  // ⑦ 头顶横梁：距地面 3 格，跳跃会被截断在约 1.2 格
  rect(62, GROUND_Y - 3, 70, GROUND_Y - 3);

  // ⑧ 出口
  g[GROUND_Y - 1][105] = 'E';

  return g.map((row) => row.join(''));
}

export default {
  id: 'testbed',
  name: '测试场 · 手感校准',
  hint: '每一段地形对应一条 config 常量，改完参数就来这里跑一遍',
  showRuler: true,
  spawn: { x: 3, y: 18 },
  tiles: build(),
};
