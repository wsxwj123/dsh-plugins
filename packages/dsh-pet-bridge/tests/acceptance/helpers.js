// 测试替身与工具（黑盒，不依赖任何实现内部）
// 只通过插件对外接口 apply/inject 驱动，不 import 内部模块。
'use strict'

const http = require('node:http')

// 插件模块（package.json 的 main 指向 lib/index.js，黑盒入口就是它）
const plugin = require('../../lib/index.js')

// —— 最小 ctx 替身：只提供契约用到的 ctx.on + 手动触发事件 ——
function makeCtx() {
  const buckets = new Map() // event -> Set<handler>
  return {
    // 订阅事件；返回解绑函数（与 cordis ctx.on 的返回值语义一致）
    on(event, handler) {
      if (!buckets.has(event)) buckets.set(event, new Set())
      buckets.get(event).add(handler)
      return () => buckets.get(event).delete(handler)
    },
    // —— 以下为测试驱动用的辅助，非常规 ctx 成员 ——
    _handlers: buckets,
    _emit(event, payload) {
      const set = buckets.get(event)
      if (!set) return
      for (const h of [...set]) if (typeof h === 'function') h(payload)
    },
    _emitAgentCreated(agent) {
      this._emit('agent/created', { agent })
    },
  }
}

// —— 严格 ctx 替身：模拟 cordis 的"未注入服务不可裸访问"硬约束 ——
// 真实 cordis 实证行为：
//   - ctx.logger  核心属性，可安全裸访问（不抛）→ 放行名单
//   - ctx.base    同上，核心属性           → 放行名单
//   - ctx.get('agents')  可选读返回 undefined，不抛
//   - ctx.agents  未注入的服务属性，裸访问抛
//                 `cannot get property "agents" without inject`
// 用途：抓"插件绕过 get() 裸读未注入服务属性"的真实环境崩溃。默认替身不启用此约束，
// 需要时用 makeStrictCtx()。
// 放行名单：核心属性（logger/base/emit）+ 契约方法（on/get/has）+ 测试驱动成员（_ 前缀）
const CORE_PROPS = new Set(['logger', 'base', 'emit'])
function makeStrictCtx() {
  const buckets = new Map() // event -> Set<handler>
  const emit = (event, payload) => {
    const set = buckets.get(event)
    if (!set) return
    for (const h of [...set]) if (typeof h === 'function') h(payload)
  }
  const obj = {
    // 契约允许的方法
    on(event, handler) {
      if (!buckets.has(event)) buckets.set(event, new Set())
      buckets.get(event).add(handler)
      return () => buckets.get(event).delete(handler)
    },
    // 可选读服务：未注入 → 返回 undefined（不抛）
    get(name) {
      return undefined
    },
    // 可选查服务是否存在：未注入 → false
    has(name) {
      return false
    },
    // —— 测试驱动成员（与 makeCtx 对齐，非真实 cordis ctx 成员） ——
    _handlers: buckets,
    _emit: emit,
    _emitAgentCreated(agent) {
      emit('agent/created', { agent })
    },
  }
  return new Proxy(obj, {
    get(t, prop) {
      // 放行 1：契约方法 + 测试驱动成员（对象自有属性）
      if (prop in t) return t[prop]
      // 放行 2：核心属性（logger/base/emit）——可安全裸访问，同真实 cordis
      if (CORE_PROPS.has(String(prop))) return t[prop] // 未实现时 undefined，不抛
      // 放行 3：测试驱动内部成员（下划线前缀）
      if (typeof prop === 'string' && prop.startsWith('_')) return t[prop]
      // 其余（未注入的服务属性，如 agents）裸访问 → 抛错，同真实 cordis
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
    has(t, prop) {
      return prop in t || (typeof prop === 'string' && (prop.startsWith('_') || CORE_PROPS.has(prop)))
    },
  })
}

// —— agent 替身：session.events 是数组，push 模拟 dsh 追加事件 ——
// 事件形如 { seq, type, data }
function makeAgent(initialEvents) {
  const agent = { session: { events: initialEvents ? initialEvents.map((e) => ({ ...e })) : [] } }
  return {
    agent,
    push(...evts) {
      agent.session.events.push(...evts) // 原地追加，插件靠轮询读到
    },
  }
}

// 便捷构造单条事件
function evt(seq, type, data) {
  const o = { seq, type }
  if (data !== undefined) o.data = data
  return o
}
function toolCall(seq, name, args) {
  return evt(seq, 'tool/call', { name, arguments: args !== undefined ? args : '{}' })
}

// —— 假 pet HookServer：监听随机回环端口，收集收到的 POST /bubble ——
function startFakePet(responseStatus = 200) {
  return new Promise((resolve, reject) => {
    const requests = [] // { method, url, body(解析后), raw }
    const server = http.createServer((req, res) => {
      let raw = ''
      let settled = false
      req.on('data', (c) => (raw += c))
      const settle = () => {
        if (settled) return // end 与 close 只记一次
        settled = true
        let body = null
        try {
          if (raw) body = JSON.parse(raw)
        } catch {
          body = raw // 非 JSON 时保留原始文本好断言
        }
        requests.push({ method: req.method, url: req.url, body, raw })
      }
      req.on('end', settle)
      req.on('close', settle) // 客户端 fire-and-forget destroy 时 early close
      req.on('error', () => {})
      res.statusCode = responseStatus
      res.end()
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        server,
        requests,
        stop() {
          return new Promise((r) => {
            server.closeAllConnections?.()
            server.close(() => r())
          })
        },
      })
    })
  })
}

// —— 取一个当前空闲且无人监听的端口（用于 ECONNREFUSED 场景） ——
function freeUnusedPort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

// —— 轮询等待条件成立（插件是异步轮询推送，等待需轮询） ——
function waitFor(predicate, { timeout = 2000, interval = 10, label = 'waitFor timeout' } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      let r
      try {
        r = predicate()
      } catch (e) {
        reject(e)
        return
      }
      if (r) return resolve(r)
      if (Date.now() - start > timeout) return reject(new Error(label))
      setTimeout(tick, interval)
    }
    tick()
  })
}

// 等假 server 恰好收到 n 个请求
function serverReceived(pet, count) {
  return waitFor(() => pet.requests.length >= count, {
    label: `expected ${count} push requests, got ${pet.requests.length}`,
  })
}

module.exports = {
  plugin,
  makeCtx,
  makeStrictCtx,
  makeAgent,
  evt,
  toolCall,
  startFakePet,
  freeUnusedPort,
  waitFor,
  serverReceived,
}
