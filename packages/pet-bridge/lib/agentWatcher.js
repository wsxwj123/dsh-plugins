'use strict'

/**
 * agentWatcher：观察单个 agent 的事件流，按「位置游标」增量轮询。
 *
 * 契约要点：
 *   - 以数组位置（index）为增量游标，忠于 events 的追加顺序来处理事件——
 *     这保证「seq2 排到 seq1 前」时仍按 append 序外发（imagination.test.js），
 *     不会因 seq 数值乱序而丢事件或重排。
 *   - 每 tick 记录当前会话 events 引用的快照再遍历，规避数组被整体重排/换引用的场景；
 *     只从上次位置向后推进，游标只增。
 *   - 事件 -> kind/文案 映射：
 *         turn/start      -> user
 *         tool/call       -> pre（tool_name = 原始工具名 ev.data.name；tool_input = summarizeToolInput）
 *         tool/result     -> post
 *         turn/end        -> stop
 *         agent/disposed  -> stop（由装配层调 disposeWatcher 补发）
 *         assistant/message 及其余未列事件 -> 不推送
 *   - session.events 缺失/为空 -> 该 tick 跳过。
 *   - 卸载/销毁后：停 interval、置 dead，不再产生任何推送；stop 幂等无害。
 */

const { summarizeToolInput } = require('./toolLabels')

/**
 * 建立对一个 agent 的轮询观察。
 * @param {object} agent            agent 实例（agent.session.events 只读）
 * @param {{port:number, pollInterval:number, enabled:boolean}} cfg
 * @param {(kind:string, toolName?:string, toolInput?:object|null)=>void} emit  一次推送的出口
 * @param {(...args:any[])=>void} [debug]  日志函数（现取的 ctx.logger 绑定；内部再包一层安全降级）
 * @returns {{ dispose:Function, finalStop:Function }} dispose 停轮询；finalStop 在 agent/disposed 时补发 stop 并彻底停用
 */
function createWatcher(agent, cfg, emit, debug) {
  // 同 bubble.js：logger 是依赖 fiber 上下文的可调用服务，调用包 try 防 this 绑定丢失
  const safeDebug = (...args) => { try { if (typeof debug === 'function') return debug(...args) } catch (_) { /* 静默 */ } }
  let position = 0 // 位置游标：下一个待处理事件的数组下标
  let dead = false
  let interval = null

  if (!agent) return { dispose: () => {}, finalStop: () => {} }

  const tick = () => {
    if (dead) return
    const sess = agent.session
    if (!sess || !Array.isArray(sess.events)) return // events 缺失：跳过本 tick
    const events = sess.events // 快照引用
    let i = position
    for (; i < events.length; i++) {
      const ev = events[i]
      if (!ev || typeof ev.type !== 'string') continue
      switch (ev.type) {
        case 'turn/start':
          emit('user')
          break
        case 'tool/call': {
          // 原始工具名（可能缺 name）；随 raw name 一起提取 tool_input 精简摘要
          const name = ev.data && typeof ev.data.name === 'string' ? ev.data.name : undefined
          const argsJSON = ev.data && typeof ev.data.arguments === 'string' ? ev.data.arguments : undefined
          const summary = summarizeToolInput(name, argsJSON)
          emit('pre', name, summary)
          break
        }
        case 'tool/result':
          emit('post')
          break
        case 'turn/end':
          emit('stop')
          break
        // assistant/message 及未列事件：不推送
        default:
          break
      }
    }
    position = events.length // 游标推进到末端
  }

  if (cfg.enabled !== false) {
    try {
      interval = setInterval(tick, cfg.pollInterval)
      // 长驻 timer 不 hold 进程；卸载/销毁时显式 clearInterval
      if (interval && typeof interval.unref === 'function') interval.unref()
    } catch (err) {
      safeDebug(`dsh-pet-bridge: setInterval failed ${err.message}`)
    }
  }

  const stopPolling = () => {
    if (interval) {
      try {
        clearInterval(interval)
      } catch (e) {
        /* no-op */
      }
      interval = null
    }
  }

  return {
    /** 卸载该 watcher：停轮询（重建/卸载时用，不再补发 stop） */
    dispose() {
      if (dead) return
      dead = true
      stopPolling()
    },
    /** agent/disposed：补发一条 stop（幂等无害），随后彻底停用该 watcher */
    finalStop() {
      if (dead) return
      emit('stop')
      dead = true
      stopPolling()
    },
  }
}

module.exports = { createWatcher }
