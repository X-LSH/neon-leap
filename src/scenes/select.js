/**
 * 关卡选择场景。
 *
 * 用 DOM 而不是 Canvas：这是一屏文字排版（序号 / 主题名 / 最佳时间 / 锁定态），
 * 浏览器处理中文与等宽数字远比手写位图字体可靠，而且能直接复用键盘与无障碍语义。
 * 游戏世界才归 Canvas —— 这条边界从 HUD 一路延伸到关卡选择，保持一致的判断标准。
 */

import { formatTime } from '../game/progress.js';

const COLS = 5;

export function createSelectScene({ input, levels, progress, audio = null, onPick }) {
  const root = document.createElement('div');
  root.id = 'select-scene';
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '28px',
    fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
    color: '#e8eef7',
    background: '#05060a',
    zIndex: '5',
    padding: '24px',
    boxSizing: 'border-box',
  });

  const title = document.createElement('div');
  title.textContent = 'NEON LEAP';
  Object.assign(title.style, {
    fontSize: '13px',
    letterSpacing: '0.42em',
    color: '#35e0ff',
    textShadow: '0 0 18px rgba(53,224,255,0.45)',
  });

  const subtitle = document.createElement('div');
  Object.assign(subtitle.style, {
    fontSize: '11px',
    letterSpacing: '0.18em',
    color: '#6b7a90',
    marginTop: '-18px',
  });

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: `repeat(${COLS}, 132px)`,
    gap: '10px',
  });

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    fontSize: '11px',
    color: '#6b7a90',
    letterSpacing: '0.06em',
    textAlign: 'center',
    lineHeight: '1.9',
  });

  root.append(title, subtitle, grid, hint);

  const cards = [];
  let cursor = 0;

  /** 找到第一个「已解锁且未通关」的关卡作为默认光标位置。 */
  function defaultCursor() {
    for (let i = 0; i < levels.length; i++) {
      if (progress.isUnlocked(levels[i].index) && !progress.isCleared(levels[i].id)) return i;
    }
    return Math.max(0, levels.length - 1);
  }

  function buildCards() {
    cards.length = 0;
    grid.textContent = '';

    levels.forEach((lv, i) => {
      const cleared = progress.isCleared(lv.id);
      const unlocked = progress.isUnlocked(lv.index);
      const best = progress.bestTimeMs(lv.id);

      const card = document.createElement('div');
      Object.assign(card.style, {
        border: '1px solid #1d2a3d',
        borderRadius: '6px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        background: unlocked ? '#0a0d16' : '#07090f',
        opacity: unlocked ? '1' : '0.42',
        transition: 'border-color 110ms linear, background 110ms linear',
      });

      const idx = document.createElement('div');
      idx.textContent = String(lv.index).padStart(2, '0');
      Object.assign(idx.style, {
        fontSize: '10px',
        letterSpacing: '0.2em',
        color: cleared ? '#35e0ff' : '#6b7a90',
      });

      const name = document.createElement('div');
      name.textContent = unlocked ? lv.name : '锁 定';
      Object.assign(name.style, { fontSize: '14px', letterSpacing: '0.06em' });

      const meta = document.createElement('div');
      meta.textContent = !unlocked
        ? `需通关第 ${String(lv.index - 1).padStart(2, '0')} 关`
        : cleared
          ? formatTime(best)
          : '未通关';
      Object.assign(meta.style, {
        fontSize: '11px',
        color: cleared ? '#35e0ff' : '#6b7a90',
        letterSpacing: '0.04em',
      });

      card.append(idx, name, meta);
      grid.append(card);
      cards.push(card);
    });
  }

  function paint() {
    cards.forEach((card, i) => {
      const lv = levels[i];
      const unlocked = progress.isUnlocked(lv.index);
      const focused = i === cursor;
      card.style.borderColor = focused ? (unlocked ? '#35e0ff' : '#3a4152') : '#1d2a3d';
      card.style.background = focused && unlocked ? '#101828' : (unlocked ? '#0a0d16' : '#07090f');
      card.style.boxShadow = focused ? '0 0 0 1px rgba(53,224,255,0.28)' : 'none';
    });

    const lv = levels[cursor];
    if (!lv) return;
    if (progress.isUnlocked(lv.index)) {
      subtitle.textContent = progress.isCleared(lv.id)
        ? `最佳 ${formatTime(progress.bestTimeMs(lv.id))}`
        : lv.hint || '';
    } else {
      subtitle.textContent = '通关上一关以解锁';
    }
  }

  function move(dx, dy) {
    const col = cursor % COLS;
    let next = cursor + dx + dy * COLS;
    if (dx < 0 && col === 0) next = cursor;              // 撞左边界停住
    if (dx > 0 && col === COLS - 1) next = cursor;
    if (next < 0 || next >= levels.length) return;
    cursor = next;
    paint();
  }

  function pick() {
    const lv = levels[cursor];
    if (!lv || !progress.isUnlocked(lv.index)) return;
    audio?.play('ui');
    onPick(lv);
  }

  function toggleMute() {
    const muted = audio ? audio.toggleMute() : false;
    progress.setMuted(muted);      // 静音属于"设置"，要持久化
    updateHint();
  }

  function onKey(e) {
    // ★ 用户的第一次按键就是浏览器要求的「手势」——
    //   AudioContext 在此之前一直处于 suspended 状态，不解锁就没有声音。
    audio?.unlock();

    switch (e.code) {
      case 'ArrowLeft': e.preventDefault(); move(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); move(1, 0); break;
      case 'ArrowUp': e.preventDefault(); move(0, -1); break;
      case 'ArrowDown': e.preventDefault(); move(0, 1); break;
      case 'Enter': case 'Space': case 'KeyZ': e.preventDefault(); pick(); break;
      case 'KeyM': e.preventDefault(); toggleMute(); break;
      default: break;
    }
  }

  window.addEventListener('keydown', onKey);

  /** 底部提示行。抽成函数是因为静音切换后要重绘它。 */
  function updateHint() {
    const total = progress.clearedCount();
    const muteTag = audio && audio.muted ? '　🔇 已静音（M 切换）' : '';
    const saveTag = progress.persistent ? '' : '　⚠ 存档不可用（隐私模式），本次进度不会保留';
    hint.textContent =
      `方向键选择 · Z / 回车进入　|　已通关 ${total} / ${levels.length}　累计死亡 ${progress.totalDeaths()}`
      + muteTag + saveTag;
  }

  return {
    init() {
      cursor = defaultCursor();
      buildCards();
      paint();
      updateHint();
      document.body.append(root);
    },

    /** 每次回到本场景都要刷新（进度可能变了）。 */
    refresh() {
      cursor = defaultCursor();
      buildCards();
      paint();
      updateHint();
    },

    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },

    update() {},
    render() {},
    handleEvents() {},
    setFps() {},
    onResize() {},
  };
}
