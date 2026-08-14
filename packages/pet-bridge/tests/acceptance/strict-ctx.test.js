// 防回归（真实环境盲区）：cordis 硬约束 —— inject 未声明的服务属性不可裸访问
// cordis 插件 inject 里没声明的服务（如 ctx.agents）裸访问会抛
// `cannot get property "agents" without inject`；必须用 ctx.get('agents') 可选读。
// 测试：用严格 ctx 替身装载插件，验证插件对严格 ctx 兼容（不裸读未注入服务）。
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeStrictCtx, makeAgent } = require('./helpers')

test('严格 ctx 下 apply 不抛、返回卸载函数、能绑定 agent/created（插件不裸读未注入服务）', () => {
  const ctx = makeStrictCtx()
  const h = makeAgent()
  // apply 第二个参数可用可省，均应在严格 ctx 下不抛
  const dispose = plugin.apply(ctx, { port: 1, pollInterval: 5 })
  assert.strictEqual(typeof dispose, 'function')
  // 触发 agent/created 也应不抛（插件从此只经 get()/on 交互）
  ctx._emitAgentCreated(h.agent)
  // 分离卸载也不抛
  dispose()
})

test('严格 ctx 模拟验证：裸访问未注入服务抛错，get() 可选读返回 undefined 不抛', () => {
  const ctx = makeStrictCtx()
  // 裸读未注入服务属性 → 抛错（与 cordis 硬约束一致）
  assert.throws(() => ctx.agents, /without inject/)
  assert.throws(() => ctx.foo.bar, /without inject/)
  // 经 get() 可选读未注入服务 → 返回 undefined，不抛
  assert.strictEqual(ctx.get('agents'), undefined)
  assert.strictEqual(ctx.get('foo'), undefined)
})
