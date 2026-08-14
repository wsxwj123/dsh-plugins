// tool_input 精简摘要提取规则（§2.3 表）+ tool_name 恒=原始工具名
// 契约：按工具名前缀分类提取 file_path(basename) / command(首词) / pattern(截24) / query(截22)；
//       非字符串/缺值回 null；非法 JSON → null；其余工具（glob/subagent/workflow/skill/未知）→ null
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, toolCall, startFakePet, serverReceived } = require('./helpers')

/** 喂 tool/call(name, argsJSON) 返回 { tool_name, tool_input }（内部自建并关闭假 server） */
async function summarize(name, args) {
  const fake = await startFakePet()
  const ctx = makeCtx()
  const { agent, push } = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(agent)
  try {
    push(toolCall(1, name, args !== undefined ? args : null))
    await serverReceived(fake, 1)
    const b = fake.requests[0].body
    return { tool_name: b.tool_name, tool_input: b.tool_input }
  } finally {
    dispose()
    await fake.stop()
  }
}

// —— file_path 提取（read/写类）——
test('read：file_path → basename{file_path:foo.ts}', async () => {
  const r = await summarize('read', '{"file_path":"/a/b/foo.ts"}')
  assert.strictEqual(r.tool_name, 'read') // 原始名
  assert.deepStrictEqual(r.tool_input, { file_path: 'foo.ts' })
})
test('read：取 .path 兼容字段的 basename', async () => {
  assert.deepStrictEqual((await summarize('read', '{"path":"/x/y/z.html"}')).tool_input, { file_path: 'z.html' })
})
test('write/edit/insert/apply_patch：file_path → basename', async () => {
  for (const n of ['write', 'edit', 'insert', 'apply_patch']) {
    const r = await summarize(n, '{"file_path":"/repo/pkg/a.ts"}')
    assert.deepStrictEqual(r.tool_input, { file_path: 'a.ts' }, `expect basename for ${n}`)
    assert.strictEqual(r.tool_name, n)
  }
})
test('file_path 缺失 → 摘要为 null（不崩）', async () => {
  assert.strictEqual((await summarize('read', '{}')).tool_input, null)
})
test('file_path 非字符串 → null', async () => {
  assert.strictEqual((await summarize('read', '{"file_path":123}')).tool_input, null)
})

// —— command 首词提取 ——
test('bash/shell/exec：command → 空格切首词', async () => {
  const r = await summarize('bash', '{"command":"ls -la /tmp"}')
  assert.deepStrictEqual(r.tool_input, { command: 'ls' })
  assert.strictEqual(r.tool_name, 'bash')
  assert.deepStrictEqual((await summarize('shell', '{"command":"pwd"}')).tool_input, { command: 'pwd' })
})
test('bash：取 .cmd 兼容字段首词', async () => {
  assert.deepStrictEqual((await summarize('bash', '{"cmd":"git status"}')).tool_input, { command: 'git' })
})
test('command 带前导空格的 trim 后再切首词', async () => {
  assert.deepStrictEqual((await summarize('exec', '{"command":"  grep foo"}')).tool_input, { command: 'grep' })
})
test('command 缺失/非字符串 → null', async () => {
  assert.strictEqual((await summarize('bash', '{}')).tool_input, null)
  assert.strictEqual((await summarize('bash', '{"command":5}')).tool_input, null)
})

// —— pattern / query 截断 ——
test('grep/search：pattern → 截断 24 字符', async () => {
  assert.deepStrictEqual((await summarize('grep', '{"pattern":"foo"}')).tool_input, { pattern: 'foo' })
  assert.deepStrictEqual((await summarize('search', '{"query":"abc"}')).tool_input, { pattern: 'abc' }, 'search 兼容 .query')
  const long = 'x'.repeat(30)
  const p = await summarize('grep', `{"pattern":"${long}"}`)
  assert.strictEqual(p.tool_input.pattern.length, 24)
  assert.strictEqual(p.tool_input.pattern, 'x'.repeat(24))
})
test('web_search：query → 截断 22 字符', async () => {
  assert.deepStrictEqual((await summarize('web_search', '{"query":"天气"}')).tool_input, { query: '天气' })
  const long = 'y'.repeat(30)
  const r = await summarize('web_search', `{"query":"${long}"}`)
  assert.strictEqual(r.tool_input.query.length, 22)
  assert.strictEqual(r.tool_input.query, 'y'.repeat(22))
  assert.strictEqual(r.tool_name, 'web_search')
})
test('pattern/query 缺值或非字符串 → null', async () => {
  assert.strictEqual((await summarize('grep', '{}')).tool_input, null)
  assert.strictEqual((await summarize('web_search', '{"query":true}')).tool_input, null)
})

// —— 其余工具 → null ——
test('glob/subagent/agent/workflow/skill/http/fetch/未知 → 摘要 null（pet 兜底）', async () => {
  const names = ['glob', 'subagent_run', 'agent_chat', 'workflow_go', 'skill_test', 'http_get', 'fetch_url', 'frobnicateX']
  for (const n of names) {
    const r = await summarize(n, '{"file_path":"/a/b.ts","command":"ls","query":"q"}')
    assert.strictEqual(r.tool_input, null, `expect null for ${n}`)
    assert.strictEqual(r.tool_name, n, 'tool_name 恒原始名')
  }
})

// —— tool_name 恒=原始工具名（不再翻译成中文） ——
test('tool_name 恒等于原始工具名（非 tool/call 场景照契约）', async () => {
  assert.strictEqual((await summarize('bash', '{"command":"ls"}')).tool_name, 'bash')
  assert.strictEqual((await summarize('web_search', '{"query":"x"}')).tool_name, 'web_search')
  assert.strictEqual((await summarize('frobnicateX', '{"a":1}')).tool_name, 'frobnicateX')
})

// —— 非法 JSON ——
test('arguments 是非法 JSON → 摘要 null、不抛错', async () => {
  const r = await summarize('bash', 'not-json{{{')
  assert.strictEqual(r.tool_input, null)
  assert.strictEqual(r.tool_name, 'bash')
})

// —— 摘要值整体 ≤24 字符 ——
test('所有摘要值额外截断 ≤24 字符（即使命中了 22 截断仍保底）', async () => {
  for (const n of ['bash', 'grep', 'web_search']) {
    const long = 'z'.repeat(40)
    const r = await summarize(n, n === 'bash' ? `{"command":"${long}"}` : n === 'grep' ? `{"pattern":"${long}"}` : `{"query":"${long}"}`)
    if (r.tool_input) {
      const v = Object.values(r.tool_input)[0]
      assert.ok(v.length <= 24, `expected ≤24 chars for ${n}`)
    }
  }
})
