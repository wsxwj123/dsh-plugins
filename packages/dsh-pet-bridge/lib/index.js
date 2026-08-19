'use strict'

/**
 * dsh-pet-bridge 插件入口：cordis 插件（inject + apply）。
 *
 * 契约（INTERFACE §1 / §2、PLAN §1）：
 *   - inject 恒为 []；apply(ctx, config) 装载。
 *   - 订阅 ctx.on("agent/created", {agent}) 对新建 agent 建观察；
 *     对已存在 agent 逐个建观察；
 *     订阅 ctx.on("agent/disposed", {agent}) 补发 stop 并清其轮询；
 *   - apply 必须返回一个可调用卸载函数（清 timer / 解绑 handler / 停推送），
 *     cordis 卸载时调用；不返回则契约违约。
 *   - 所有降级路径绝不出 apply；不影响 dsh 主流程。
 */

const { normalizeConfig } = require('./config')
const { createCollector } = require('./collector')
const { push } = require('./bubble')

function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  // cordis 的 ctx.logger 是「可调用服务」，.debug 依赖 fiber 上下文（this 绑定）。
  // 不能把 ctx.logger 存成局部变量跨事件回调使用（会丢 this 抛 this is not a function）；
  // 这里每次调用都现取 ctx.logger，保持绑定，并把任何异常吞掉（日志丢失不影响主流程）。
  const debug = (...args) => {
    try {
      const lg = ctx && ctx.logger
      if (lg && typeof lg.debug === 'function') return lg.debug(...args)
    } catch (_) {
      /* 静默降级 */
    }
  }
  const activeCollector = { current: null }

  const send = (kind, toolName, toolInput) => {
    if (cfg.enabled === false) return // enabled=false：零推送
    push(cfg.port, kind, toolName, toolInput, debug)
  }

  const collector = createCollector(cfg, send, debug)
  activeCollector.current = collector

  const onCreated = (payload) => {
    if (payload && payload.agent) collector.watch(payload.agent)
  }
  const onDisposed = (payload) => {
    if (payload && payload.agent) collector.unwatch(payload.agent)
  }

  // 对已存在 agent 逐个建观察（用 ctx.get 可选读：agents 未注入/未注册时返回 undefined，不抛）
  const existing = (ctx && typeof ctx.get === 'function' ? ctx.get('agents') : null) || null
  if (existing && typeof existing === 'object') {
    const values = existing.store && existing.store.values ? existing.store.values() : null
    if (values) {
      for (const a of values) if (a && a.agent) collector.watch(a.agent)
    } else if (Array.isArray(existing)) {
      for (const a of existing) if (a && a.agent) collector.watch(a.agent)
    }
  }

  // 订阅事件；解绑函数（与 cordis ctx.on 返回语义一致）
  const offs = []
  if (ctx && typeof ctx.on === 'function') {
    offs.push(ctx.on('agent/created', onCreated))
    offs.push(ctx.on('agent/disposed', onDisposed))
  }

  // 必须返回可调用卸载函数
  return function dispose() {
    if (collector) collector.dispose()
    for (const off of offs) {
      try {
        if (typeof off === 'function') off()
      } catch (e) {
        /* no-op */
      }
    }
    offs.length = 0
    if (activeCollector.current === collector) activeCollector.current = null
  }
}

module.exports = { inject: [], apply }
