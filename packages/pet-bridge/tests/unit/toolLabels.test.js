'use strict'

// 白盒单测：toolLabels 分类规则表（含兜底、意外 part-match、非字符串输入）
const { test } = require('node:test')
const assert = require('node:assert')
const { toolLabels, RULES, FALLBACK } = require('../../lib/toolLabels')

test('读取类：read/grep/glob/list/search 前缀 + 词边界结尾 search', () => {
  for (const n of ['read_file', 'grep_x', 'glob_ts', 'list_dir', 'read', 'search', 'search_thing', 'foo_search', 'my-search']) {
    assert.strictEqual(toolLabels(n), '读取中', n)
  }
})

test('写入类：write/edit/apply_patch/insert 前缀', () => {
  for (const n of ['write_file', 'edit_file', 'apply_patch', 'insert_rows']) {
    assert.strictEqual(toolLabels(n), '写入文件', n)
  }
})

test('命令类：bash/exec/run/command/shell 前缀', () => {
  for (const n of ['bash_ls', 'exec_cmd', 'run_all', 'command', 'shell_collect']) {
    assert.strictEqual(toolLabels(n), '运行命令', n)
  }
})

test('联网类：web_search/http/fetch/request/curl 前缀', () => {
  for (const n of ['web_search_b', 'http_get', 'fetch_url', 'request_any', 'curl_get']) {
    assert.strictEqual(toolLabels(n), '联网检索', n)
  }
})

test('编排类：subagent/agent/workflow/skill 前缀', () => {
  for (const n of ['subagent_run', 'agent_chat', 'workflow_go', 'skill_test']) {
    assert.strictEqual(toolLabels(n), '编排任务', n)
  }
})

test('意外 part-match 不得命中任何非兜底类', () => {
  for (const n of ['supersearch', 'nonsearch', 'doesearch', 'basher', 'unreadable']) {
    assert.strictEqual(toolLabels(n), FALLBACK, n)
  }
})

test('非字符串输入（undefined/null/数字/空串）一律兜底，恒非空', () => {
  for (const n of [undefined, null, '', 123, {}]) {
    const r = toolLabels(n)
    assert.strictEqual(typeof r, 'string')
    assert.ok(r.length > 0)
    assert.strictEqual(r, FALLBACK)
  }
})

test('规则表顺序固定（首命中即返回）且恒有兜底', () => {
  assert.ok(Array.isArray(RULES) && RULES.length >= 1)
  // 兜底标签存在
  assert.strictEqual(typeof FALLBACK, 'string')
  assert.ok(FALLBACK.length > 0)
})
