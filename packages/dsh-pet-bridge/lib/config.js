'use strict'

/**
 * config 归一化：读取插件配置，填入默认值。
 *
 * 契约（INTERFACE §1）：
 *   port        默认 7779，仅回环 127.0.0.1 生效；
 *   pollInterval 默认 250，必须 > 0；
 *   enabled      默认 true，false 时 apply 正常装载但零推送。
 *
 * 注意：非法值（pollInterval≤0、port 越界）的「装载失败」由真实 cordis 装载器在
 * apply 之前据 config schema 拒绝（见 loader-gated.test.js）。apply 本身保持对
 * 缺省配置的宽容，不抛错（boundary.test.js 要求 apply(ctx) 不带 config 也不崩）。
 */

const DEFAULT_PORT = 7779
const DEFAULT_POLL_INTERVAL = 250

/** 插件运行时内部使用的归一化配置（不含 loader 层校验） */
function normalizeConfig(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  return {
    enabled: raw.enabled !== false,
    port: typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : DEFAULT_PORT,
    pollInterval:
      typeof raw.pollInterval === 'number' && Number.isFinite(raw.pollInterval) ? raw.pollInterval : DEFAULT_POLL_INTERVAL,
  }
}

module.exports = { normalizeConfig, DEFAULT_PORT, DEFAULT_POLL_INTERVAL }
