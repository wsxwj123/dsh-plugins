'use strict'

/**
 * 工具名 -> 气泡中文文案 分类规则表（开放扩展点）。
 *
 * 契约（INTERFACE §2.3）：
 *   - 按表从上到下，对工具名做正则 test；首个命中即返回对应文案；
 *   - 所有分支均「词首锚定 + 词边界」，禁止裸 `|search` 之类可能 part-match 的写法；
 *   - 恒有兜底「执行中」，因此任何 name（含 undefined / 空串）都返回非空字符串，
 *     不抛错、不返回 undefined。
 */
const RULES = [
  // read/搜索类：词首锚定（read|grep|glob|list|search 作前缀）+ 词边界结尾 search
  { re: /^(read|grep|glob|list|search)([_-]|$)|(^|[_-])search$/i, label: '读取中' },
  // 写文件类
  { re: /^(write|edit|apply_patch|insert)([_-]|$)/i, label: '写入文件' },
  // 命令类
  { re: /^(bash|exec|run|command|shell)([_-]|$)/i, label: '运行命令' },
  // 网络类
  { re: /^(web_search|http|fetch|request|curl)([_-]|$)/i, label: '联网检索' },
  // 编排类
  { re: /^(subagent|agent|workflow|skill)([_-]|$)/i, label: '编排任务' },
]

const FALLBACK = '执行中'

/**
 * 将工具名映射为气泡中文文案。
 * @param {string|undefined|null} name
 * @returns {string} 非空字符串
 */
function toolLabels(name) {
  if (typeof name !== 'string' || name.length === 0) return FALLBACK
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i].re.test(name)) return RULES[i].label
  }
  return FALLBACK
}

module.exports = { toolLabels, RULES, FALLBACK }
