// cordis 访问纪律测试（AGENTS.md 红线，INTERFACE §3 参考约定）
// 用严格替身模拟 cordis 运行时约束，验证一个"符合规范的宿主访问模式"：
//   1. 核心属性（on/emit/logger/base/get/has）可裸访问
//   2. 未 inject 的服务属性禁止裸访问（读则抛 "cannot get property X without inject"）
//   3. callable 服务（logger）存局部变量跨异步回调会崩 → 必须闭包内现取 ctx.logger
//   4. ctx.get('logger') 返回 undefined（logger 是核心属性，不是服务）
//
// 这份测试验证的是一套"访问模板"（对规范实现的样板），真实 cordis e2e
// 仍需在 headless profile 真实加载守门（三层防线第三层）。

import test from 'node:test'
import assert from 'node:assert/strict'

// 一个 this 严格绑定的 logger：脱离绑定的实例调用即抛，
// 用于模拟 cordis callable 服务（logger）依赖 fiber 上下文 this 绑定的真实约束。
function makeThisDependentLogger() {
  const impl = { _tag: 'bound-logger' }
  // 注意：方法不均 .bind(impl)，这样
  //  - ctx.logger.debug(...) 调用时 this === impl → 正常
  //  - 抽出成裸函数 `const fn = ctx.logger.debug` 跨回调裸调时 this === undefined → 抛
  // 这正是 cordis callable 服务（logger）的真实约束。
  const errorIfDetached = function (level, ...args) {
    if (this !== impl || !this._tag) throw new TypeError('this is not a function')
    return `${level}: ${args.join(' ')}`
  }
  impl.debug = errorIfDetached
  impl.info = errorIfDetached
  impl.warn = errorIfDetached
  impl.error = errorIfDetached
  return impl
}

// —— 严格替身 ctx：模拟 cordis 的访问约束 ——
function makeStrictCtx() {
  // 已 inject 声明的服务
  const injectedServices = new Set(['agents', 'sessions'])
  const services = new Map([
    ['agents', { list: () => [] }],
    ['sessions', { list: () => [] }],
  ])

  const target = {
    on() {},
    emit() {},
    // callable 服务：方法 this 依赖"已经绑定到 ctx 的 logger 实例"，模拟 fiber 上下文
    logger: makeThisDependentLogger(),
    base: '/tmp/base',
    get(name) {
      if (name === 'logger') return undefined // 契约：logger 是核心属性，get 不到
      return services.get(name)
    },
    has(name) {
      return injectedServices.has(name)
    },
    agents: services.get('agents'), // inject 声明的裸属性可访问
    sessions: services.get('sessions'),
  }

  return new Proxy({}, {
    get(_t, prop) {
      if (prop in target) {
        return target[prop]
      }
      // 未定义属性（未 inject 服务）→ 抛 cordis 风格错误
      throw new Error(`cannot get property "${prop}" without inject`)
    },
    set(_t, prop, value) {
      target[prop] = value
      return true
    },
  })
}

test.describe('cordis 访问纪律（严格替身）', () => {
  test('核心属性 on/emit/logger/base/get/has 可裸访问', () => {
    const ctx = makeStrictCtx()
    assert.equal(typeof ctx.on, 'function')
    assert.equal(typeof ctx.emit, 'function')
    assert.equal(typeof ctx.logger.debug, 'function')
    assert.equal(typeof ctx.base, 'string')
    assert.equal(typeof ctx.get, 'function')
    assert.equal(typeof ctx.has, 'function')
    assert.doesNotThrow(() => ctx.on('x', () => {}))
    assert.doesNotThrow(() => ctx.logger.info('hi'))
  })

  test('未 inject 的服务属性裸访问 → 抛错', () => {
    const ctx = makeStrictCtx()
    assert.throws(
      () => ctx.undeclaredService,
      /cannot get property ".*" without inject/,
    )
  })

  test('inject 声明的服务（agents/sessions）可裸访问', () => {
    const ctx = makeStrictCtx()
    assert.doesNotThrow(() => {
      const a = ctx.agents
      void a
    })
    assert.doesNotThrow(() => {
      const s = ctx.sessions
      void s
    })
  })

  test("has('agents') 为 true，has(未声明) 为 false", () => {
    const ctx = makeStrictCtx()
    assert.equal(ctx.has('agents'), true)
    assert.equal(ctx.has('nope'), false)
  })

  test('符合规范的宿主访问模式：用闭包持有 ctx，回调内现取 ctx.logger 不崩', async () => {
    // 规范样板：闭包持有 ctx，异步回调里 ctx.logger 现取（不在回调外存 logger 变量）
    const ctx = makeStrictCtx()
    const handler = async (url) => {
      // 模拟 HTTP error 回调：此处用 ctx 现取 logger，不依赖外部的 this 绑定
      try {
        String(url)
        throw new Error('boom')
      } catch (err) {
        ctx.logger.error('request failed: %s', err.message)
      }
      return 'handled'
    }
    const out = await handler('/ct/x')
    assert.equal(out, 'handled')
  })

  test('反向用例：把 callable 服务存成局部变量跨回调调用会崩（验证为什么必须现取）', async () => {
    // 模拟 cordis 行为：logger 这类 callable 服务的方法依赖 fiber 上下文 this，
    // 一旦把 ctx.logger.debug 抽出去存成局部变量、跨异步回调裸调，this 丢失即抛
    // `this is not a function`。这就是"闭包持 ctx、回调内现取 ctx.logger"的原因。
    const ctx = makeStrictCtx()
    const boundLogger = ctx.logger // 闭包持有的是 ctx/logger 实例没问题
    // —— 坏做法：把方法抽成局部函数，跨异步回调裸调 ——
    const leak = async () => {
      const fn = boundLogger.debug // 脱离 this 绑定
      return Promise.resolve().then(() => fn('leaked'))
    }
    await assert.rejects(() => leak(), TypeError)
    // —— 好做法：闭包内现取 ctx.logger.debug(...)，this 保留 ——
    assert.doesNotThrow(() => boundLogger.debug('ok'))
  })
})
