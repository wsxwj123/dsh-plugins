// localStorage 替身：带调用计数（§3.11 P6 记忆化断言）与故障注入（§3.8 第 5 条）。

export function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  const stats = { get: 0, set: 0, remove: 0, parse: 0 };
  let failMode = null; // null | 'get' | 'set' | 'all'

  const boom = (op) => { throw new Error(`storage unavailable: ${op}`); };

  const api = {
    getItem(k) {
      stats.get += 1;
      if (failMode === 'get' || failMode === 'all') boom('getItem');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      stats.set += 1;
      if (failMode === 'set' || failMode === 'all') boom('setItem');
      map.set(k, String(v));
    },
    removeItem(k) {
      stats.remove += 1;
      if (failMode === 'set' || failMode === 'all') boom('removeItem');
      map.delete(k);
    },

    // ---- 测试侧观测口（不属于 localStorage 接口） ----
    /** 原始值：键不存在返回 null（用于断言 removeItem 语义） */
    raw(k) { return map.has(k) ? map.get(k) : null; },
    /** 归一化读：键不存在读作 ''（INTERFACE 里 family/applied 类键的值域含 ''） */
    read(k) { return map.has(k) ? map.get(k) : ''; },
    /** 当前所有键名快照 */
    keys() { return [...map.keys()]; },
    /** 整表快照，用于"操作前后完全相同"断言 */
    snapshot() { return Object.fromEntries(map); },
    /** 直接种值，绕过计数（准备阶段用） */
    seed(k, v) { map.set(k, String(v)); return api; },
    stats,
    resetStats() { stats.get = 0; stats.set = 0; stats.remove = 0; stats.parse = 0; },
    /** 故障注入：'get' | 'set' | 'all' | null */
    fail(mode) { failMode = mode; return api; },
    /** 记一次 JSON.parse（由 harness 调用，P6 用） */
    countParse() { stats.parse += 1; },
  };
  return api;
}

/** 两份快照是否逐键相同 */
export function sameSnapshot(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => kb[i] === k && a[k] === b[k]);
}
