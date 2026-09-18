/**
 * 关卡进度。纯逻辑 + 一次存储读写，不依赖 DOM。
 *
 * 存的东西刻意少：**进度 / 最佳时间 / 死亡数**，仅此而已。
 * 不做成就、不做收集物（见 SPEC §12「明确不做的事」）——
 * 存档结构的复杂度应该与玩法复杂度匹配，多一个字段就多一份永远要维护的兼容负担。
 *
 * 解锁规则：**只要前一关通关就解锁下一关**，不做星级门槛。
 * 理由：本作的目标是让玩家把 15 关走完，而不是筛选玩家。
 */

import { createStorage } from '../core/storage.js';

const SAVE_KEY = 'neonleap.save';
const SAVE_VERSION = 1;

function freshData() {
  return {
    version: SAVE_VERSION,
    cleared: {},                 // levelId → { bestMs, deaths }
    totals: { deaths: 0, cleared: 0 },
    settings: { muted: false },
  };
}

export function createProgress(levels) {
  const store = createStorage(SAVE_KEY, SAVE_VERSION);
  let data = store.read() || freshData();

  function persist() {
    store.write(data);
  }

  /** 已通关的最大关序号（用于解锁判定）。 */
  function highestCleared() {
    let hi = 0;
    for (const l of levels) {
      if (data.cleared[l.id]) hi = Math.max(hi, l.index);
    }
    return hi;
  }

  return {
    /** 第一关永远解锁；其余关要求前一关已通关。 */
    isUnlocked(index) {
      if (index <= 1) return true;
      return highestCleared() >= index - 1;
    },

    isCleared(id) {
      return !!data.cleared[id];
    },

    bestTimeMs(id) {
      const rec = data.cleared[id];
      return rec ? rec.bestMs : null;
    },

    levelDeaths(id) {
      const rec = data.cleared[id];
      return rec ? rec.deaths : 0;
    },

    totalDeaths() {
      return data.totals.deaths;
    },

    clearedCount() {
      return data.totals.cleared;
    },

    /** 记录一次死亡。**不进热路径** —— 调用方应当在"真正死了"时调，而不是每帧。 */
    recordDeath() {
      data.totals.deaths += 1;
      persist();
    },

    /**
     * 记录通关。只在成绩变好时更新最佳时间。
     * @returns {boolean} 是否刷新了纪录
     */
    recordClear(id, timeMs, deaths) {
      const prev = data.cleared[id];
      const improved = !prev || timeMs < prev.bestMs;

      if (!prev) {
        data.cleared[id] = { bestMs: timeMs, deaths };
        data.totals.cleared += 1;
      } else if (improved) {
        prev.bestMs = timeMs;
        prev.deaths = Math.min(prev.deaths, deaths);
      }
      persist();
      return improved;
    },

    /** 清档。用于标题页的长按重置。 */
    reset() {
      data = freshData();
      store.clear();
      persist();
    },

    /** 静音开关的持久化。它属于"设置"，不属于"进度"，清档时会一起归零。 */
    isMuted() {
      return !!(data.settings && data.settings.muted);
    },

    setMuted(v) {
      if (!data.settings) data.settings = { muted: false };
      data.settings.muted = !!v;
      persist();
    },

    /** 持久化是否可用；false 表示当前是内存态降级（隐私模式）。 */
    get persistent() {
      return store.persistent;
    },
  };
}

/** 把毫秒格式化成 `m:ss.cc`，用于关卡选择界面与结算提示。 */
export function formatTime(ms) {
  if (ms === null || ms === undefined) return '--:--';
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
