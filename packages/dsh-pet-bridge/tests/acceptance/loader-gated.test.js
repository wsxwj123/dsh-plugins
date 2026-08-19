// 装载失败类（非法 config 被拒）
//
// 契约（INTERFACE §1 错误契约）：pollInterval≤0、port 越界由 config.ts 的 schema
// 校验失败、cordis 装载器拒绝装载，**不启动 apply**——这是 cordis loader 层行为，
// 发生在 apply 被调用之前，发生在插件状态机之外。
//
// 因此「装载失败」无法用本文件的最小 ctx 替身驱动：替身只能表演"apply 已被调用"，
// 而非法 config 恰恰保证 apply 不被调用。要真实验证这两条，必须在 04/05 阶段用
// 真实 cordis 装载器跑（dsh plugin --profile web add 或 bundle patch + 看装载日志），
// 这里如实标注为「依赖真实装载器」，不作为替身可执行断言。
//
// 与此同时，替身能可执行地验证契约的相邻部分：
//   - 合法 config 能装载（apply 返回卸载函数、能推送）—— 各文件已覆盖；
//   - 缺省/边界 config 不崩（boundary.test.js 已覆盖）。
'use strict'

const { test } = require('node:test')

test('pollInterval≤0 装载失败 —— 依赖真实 cordis 装载器，替身无法驱动 schema 校验',
  { skip: true, todo: false })
test('port 越界（非 1–65535）装载失败 —— 依赖真实 cordis 装载器，替身无法驱动 schema 校验',
  { skip: true, todo: false })
