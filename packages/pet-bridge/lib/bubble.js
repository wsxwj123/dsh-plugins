'use strict'

const http = require('node:http')

/**
 * bubble 推送：POST http://127.0.0.1:{port}/bubble，fire-and-forget，全静默降级。
 *
 * 契约（INTERFACE §2）：
 *   - 仅回环 127.0.0.1；agent_source 恒 "dsh"；caller_pid = process.pid；
 *   - tool_input 仅含精简安全摘要对象（<==24 字符）或 null；完整参数绝不上外发路径；
 *   - fire-and-forget：发送即返回，收到响应 res.destroy() 关闭连接，避免 socket 堆积；
 *   - 所有失败（网络错误 / 非 2xx / ECONNREFUSED）静默降级：只记一条 debug 日志，
 *     不重试、不向上抛，绝不打断 dsh 事件处理。
 */

/** 构造推送 payload（contract 固定的五个字段；缺失值归一为 null） */
function buildPayload(kind, toolName, toolInput) {
  return {
    kind,
    agent_source: 'dsh',
    tool_name: toolName === undefined ? null : toolName,
    tool_input: toolInput === undefined ? null : toolInput,
    caller_pid: process.pid,
  }
}

/**
 * 发送一条推送（fire-and-forget）。
 * @param {number} port
 * @param {string} kind
 * @param {string|null|undefined} toolName   原始工具名（仅 pre 场景有值，其余 null）
 * @param {object|null|undefined} toolInput  精简摘要对象（仅 pre 场景，其余 null）
 * @param {{debug?: Function}} logger 默认静默；传入则降级时打 debug
 * @returns {void} 立即返回，不 await 结果
 */
function push(port, kind, toolName, toolInput, logger) {
  const debug = (logger && typeof logger.debug === 'function' ? logger.debug : () => {})
  const url = `http://127.0.0.1:${port}/bubble`
  const payload = JSON.stringify(buildPayload(kind, toolName, toolInput))

  let req
  try {
    req = http.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        // 非 2xx：静默降级（debug 日志，不重试）
        if (!(res.statusCode >= 200 && res.statusCode < 300)) {
          debug(`dsh-pet-bridge: POST /bubble ${kind} -> non-2xx ${res.statusCode}`)
        }
        // fire-and-forget：收到响应立即销毁连接，避免 socket 堆积
        res.destroy()
      },
    )
    req.on('error', (err) => {
      // 网络错误 / ECONNREFUSED：静默降级，不重试、不抛出
      debug(`dsh-pet-bridge: POST /bubble ${kind} failed: ${err.code || err.message}`)
    })
    req.write(payload)
    req.end()
  } catch (err) {
    // 同步异常（如非法 URL）不会由 req 触发，绝不外抛到 apply 之外
    debug(`dsh-pet-bridge: POST /bubble ${kind} threw: ${err.message}`)
  }
}

module.exports = { push, buildPayload }
