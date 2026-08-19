'use strict'

// 白盒单测：summarizeToolInput 精简安全摘要提取（§2.3 表）+ 边界/错误
const { test } = require('node:test')
const assert = require('node:assert')
const { summarizeToolInput } = require('../../lib/toolLabels')

test('read：file_path -> basename', () => {
  assert.deepStrictEqual(summarizeToolInput('read', '{"file_path":"/a/b/foo.ts"}'), { file_path: 'foo.ts' })
  assert.deepStrictEqual(summarizeToolInput('read', '{"file_path":"foo.ts"}'), { file_path: 'foo.ts' })
  assert.deepStrictEqual(summarizeToolInput('read', '{"path":"/x/y/z.html"}'), { file_path: 'z.html' })
})

test('write/edit/insert/apply_patch：file_path -> basename', () => {
  for (const n of ['write', 'edit', 'insert', 'apply_patch']) {
    assert.deepStrictEqual(summarizeToolInput(n, '{"file_path":"/repo/pkg/a.ts"}'), { file_path: 'a.ts' }, n)
  }
})

test('bash/shell/exec：command -> 空格切首词（含 .cmd 与 trim）', () => {
  assert.deepStrictEqual(summarizeToolInput('bash', '{"command":"ls -la /tmp"}'), { command: 'ls' })
  assert.deepStrictEqual(summarizeToolInput('shell', '{"command":"pwd"}'), { command: 'pwd' })
  assert.deepStrictEqual(summarizeToolInput('exec', '{"command":"  grep foo"}'), { command: 'grep' })
  assert.deepStrictEqual(summarizeToolInput('bash', '{"cmd":"git status"}'), { command: 'git' })
})

test('grep/search：pattern -> 截断 24（兼容 .query）', () => {
  assert.deepStrictEqual(summarizeToolInput('grep', '{"pattern":"foo"}'), { pattern: 'foo' })
  assert.deepStrictEqual(summarizeToolInput('search', '{"query":"abc"}'), { pattern: 'abc' })
  assert.deepStrictEqual(summarizeToolInput('grep', `{"pattern":"${'x'.repeat(30)}"}`), { pattern: 'x'.repeat(24) })
})

test('web_search：query -> 截断 22', () => {
  assert.deepStrictEqual(summarizeToolInput('web_search', '{"query":"天气"}'), { query: '天气' })
  assert.deepStrictEqual(summarizeToolInput('web_search', `{"query":"${'y'.repeat(30)}"}`), { query: 'y'.repeat(22) })
})

test('其余工具 / 未知工具 -> null（pet 兜底）', () => {
  const names = ['glob', 'subagent_run', 'agent_chat', 'workflow_go', 'skill_test', 'http_get', 'fetch_url', 'frobnicateX']
  for (const n of names) assert.strictEqual(summarizeToolInput(n, '{"file_path":"/a.ts","command":"ls","query":"q"}'), null, n)
})

test('值缺省 / 非字符串 -> null', () => {
  assert.strictEqual(summarizeToolInput('read', '{}'), null)
  assert.strictEqual(summarizeToolInput('read', '{"file_path":123}'), null)
  assert.strictEqual(summarizeToolInput('bash', '{}'), null)
  assert.strictEqual(summarizeToolInput('bash', '{"command":5}'), null)
  assert.strictEqual(summarizeToolInput('grep', '{}'), null)
  assert.strictEqual(summarizeToolInput('web_search', '{"query":true}'), null)
})

test('非法 JSON / 非字符串 arguments -> null，不抛错', () => {
  assert.strictEqual(summarizeToolInput('bash', 'not-json{{{'), null)
  assert.strictEqual(summarizeToolInput('bash', null), null)
  assert.strictEqual(summarizeToolInput('bash', undefined), null)
  assert.strictEqual(summarizeToolInput('bash', ''), null)
  assert.strictEqual(summarizeToolInput('bash', 42), null)
})

test('name 非字符串 -> null', () => {
  assert.strictEqual(summarizeToolInput(undefined, '{}'), null)
  assert.strictEqual(summarizeToolInput(null, '{}'), null)
  assert.strictEqual(summarizeToolInput('', '{}'), null)
})

test('摘要值统一 ≤24 字符', () => {
  const long = 'z'.repeat(40)
  const cases = [
    ['bash', `{"command":"${long}"}`, 'command'],
    ['grep', `{"pattern":"${long}"}`, 'pattern'],
    ['web_search', `{"query":"${long}"}`, 'query'],
    ['read', `{"file_path":"/a/${long}.ts"}`, 'file_path'],
  ]
  for (const [name, args, field] of cases) {
    const s = summarizeToolInput(name, args)
    assert.ok(s && s[field].length <= 24, `${name} -> ${field} ≤24`)
  }
})

test('绝不外发完整 arguments：返回对象仅含单一安全摘要字段', () => {
  const s = summarizeToolInput('bash', '{"command":"ls -la","secret":"sk-abc","path":"/secret"}')
  assert.deepStrictEqual(Object.keys(s), ['command'])
})
