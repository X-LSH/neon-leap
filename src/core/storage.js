/**
 * LocalStorage 封装。
 *
 * 三条纪律，缺一条都会在真实用户的机器上出问题：
 *
 *   1. **版本字段必需。** 结构一变就换版本号，读到旧版本直接丢弃重建 ——
 *      而不是写迁移代码。存档是「可丢弃的缓存」，不是「必须保全的数据」，
 *      为它维护迁移链是纯粹的负债。
 *
 *   2. **所有访问必须 try/catch。** 隐私模式、企业策略、配额写满都会让
 *      localStorage 直接抛异常（不是返回 null）。不接异常就是白屏。
 *      失败时降级为**内存态**：本次会话仍然可玩，只是关掉浏览器就没了。
 *
 *   3. **写入不能进热路径。** 只在「通关 / 解锁 / 切场景」这类关键节点写，
 *      绝不逐帧写 —— localStorage 是同步 API，写一次会阻塞主线程。
 */

export function createStorage(key, version) {
  /** 降级用的内存副本。一旦 localStorage 不可用，这里就是唯一真相。 */
  let memory = null;
  let available = true;

  function read() {
    if (!available) return memory;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // 版本不符 → 丢弃（不迁移）。下次写入会覆盖成新结构。
      if (!data || data.version !== version) return null;
      return data;
    } catch {
      available = false;
      return memory;
    }
  }

  function write(data) {
    memory = data;
    if (!available) return false;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch {
      // 配额满 / 隐私模式：降级为内存态，本次会话继续可用
      available = false;
      return false;
    }
  }

  function clear() {
    memory = null;
    try {
      localStorage.removeItem(key);
    } catch {
      available = false;
    }
  }

  return {
    read,
    write,
    clear,
    /** 持久化是否可用。false 表示当前处于内存态降级。 */
    get persistent() {
      return available;
    },
  };
}
