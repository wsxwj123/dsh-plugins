// 工具名 → 中文文案映射（对外呈现），含兜底与「意外 part-match」反向用例
// 契约：首锚定+词边界；未命中给「执行中」；tool_name 恒非空字符串
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { plugin, makeCtx, makeAgent, toolCall, startFakePet, serverReceived } = require('./helpers')

function mount(fake) {
  const ctx = makeCtx()
  const { agent, push } = makeAgent()
  const dispose = plugin.apply(ctx, { port: fake.port, pollInterval: 5 })
  ctx._emitAgentCreated(agent)
  return { push, dispose }
}

/** 喂一个 tool/call(name) 并返回外发的 tool_name 文案（内部自建并关闭假 server） */
async function mappedLabel(name) {
  const fake = await startFakePet()
  const { push, dispose } = mount(fake)
  try {
    push(toolCall(1, name, '{}'))
    await serverReceived(fake, 1)
    return fake.requests[0].body.tool_name
  } finally {
    dispose()
    await fake.stop()
  }
}

test('读取类：read/grep/glob/list 前缀 → 「读取中」', async () => {
  for (const n of ['read_file', 'grep_foo', 'glob_ts', 'list_dir', 'read']) {
    assert.strictEqual(await mappedLabel(n), '读取中', `expect 读取中 for ${n}`)
  }
})
test('读取类：_search 结尾（词边界）→ 「读取中」', async () => {
  assert.strictEqual(await mappedLabel('foo_search'), '读取中')
  assert.strictEqual(await mappedLabel('my-search'), '读取中')
})
test('写入类：write/edit/apply_patch/insert → 「写入文件」', async () => {
  for (const n of ['write_file', 'edit_file', 'apply_patch', 'insert_rows']) {
    assert.strictEqual(await mappedLabel(n), '写入文件')
  }
})
test('命令类：bash/exec/run/command/shell → 「运行命令」', async () => {
  for (const n of ['bash_ls', 'exec_cmd', 'run_all', 'command', 'shell_collect']) {
    assert.strictEqual(await mappedLabel(n), '运行命令')
  }
})
test('联网类：web_search/http/fetch/request/curl → 「联网检索」', async () => {
  for (const n of ['web_search_b', 'http_get', 'fetch_url', 'request_any', 'curl_get']) {
    assert.strictEqual(await mappedLabel(n), '联网检索')
  }
})
test('编排类：subagent/agent/workflow/skill → 「编排任务」', async () => {
  for (const n of ['subagent_run', 'agent_chat', 'workflow_go', 'skill_test']) {
    assert.strictEqual(await mappedLabel(n), '编排任务')
  }
})

// —— 兜底 ——
test('未知工具名（frobnicateX）→ 兜底「执行中」', async () => {
  assert.strictEqual(await mappedLabel('frobnicateX'), '执行中')
})

// —— 意外 part-match 反向用例 ——
test('反向：supersearch/nonsearch/doesearch 不得命中搜索类，走兜底「执行中」', async () => {
  for (const n of ['supersearch', 'nonsearch', 'doesearch']) {
    assert.strictEqual(await mappedLabel(n), '执行中', `禁止 part-match：${n}`)
  }
})

test('反向：supersearch 与 run_all 对照（part 命中边界内才命中）', async () => {
  assert.strictEqual(await mappedLabel('supersearch'), '执行中')
  assert.strictEqual(await mappedLabel('run_all'), '运行命令')
})
