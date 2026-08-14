'use strict'

const { createWatcher } = require('./agentWatcher')

/**
 * collector：会话收集器，管理对所有 agent 的观察，并把每 agent 的事件推送给 bubble。
 *
 * 契约（concurrency.test.js 是可确定正确子集）：
 *   接口层事件里没有「会话级时间戳/age」字段，无法判定「谁最活跃」；因此把
 *   「多会话并发」落实为：每个 agent 独立位置游标、按事件发生（append）序独立外发，
 *   不重放、不串扰、不合并。INTERFACE 非目标也说明多会话并发不做复杂聚合取最新
 *   活跃——在黑盒可测范围内，等价于「各源独立推送」。
 */

/**
 * @param {object} cfg      归一化配置 { port, pollInterval, enabled }
 * @param {(kind:string, toolName?:string, toolInput?:object|null)=>void} send  单条推送出口
 * @param {(...args:any[])=>void} [debug]  日志函数（现取的 ctx.logger 绑定）
 */
function createCollector(cfg, send, debug) {
  const watchers = new Map() // agent -> watcher 句柄

  return {
    /** 已有/新 agent 注册观察；幂等（重复注册同一 agent 不建第二个 watcher） */
    watch(agent) {
      if (!agent || watchers.has(agent)) return
      const w = createWatcher(
        agent,
        cfg,
        (kind, toolName, toolInput) => send(kind, toolName, toolInput),
        debug,
      )
      watchers.set(agent, w)
    },

    /** agent 销毁：补发一条 stop 并彻底停用该 agent 的 watcher */
    unwatch(agent) {
      const w = watchers.get(agent)
      if (w) {
        w.finalStop()
        watchers.delete(agent)
      }
    },

    /** 卸载全部 watcher（不补发 stop） */
    dispose() {
      for (const w of watchers.values()) w.dispose()
      watchers.clear()
    },
  }
}

module.exports = { createCollector }
