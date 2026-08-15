// HOST 契约验收接驳层（已接驳真实实现，2014-接驳）。
//
// 本文件不再实现契约替身逻辑，而是把 tests/acceptance 需要的对外导出
// （ROUTER / MAX_BODY_BYTES / MAX_SOURCE_BYTES / 常量 / discover 纯函数）
// 直接接回包根 lib/ 的真实实现，让黑盒契约测试逐字命中的就是真实插件代码。
//
//   - ROUTER：内部用真实 createCtHandler(ctx) 得到 handler，再以 (req,res)=>handler(req,res) 驱动。
//   - discover 纯函数（resolveDshHomeLocal/findProjectRootSync/ancestorChain/
//     discoverInstructions/isDiscoveredPath）：直接 re-export 自 lib/instructions.js。
//   - 常量：MAX_BODY_BYTES 自 lib/handler.js；MAX_SOURCE_BYTES 与 INSTRUCTION_CANDIDATES
//     /LOCAL_INSTRUCTION_CANDIDATES/PROJECT_ROOT_MARKERS 自 lib/instructions.js。
//
// 对外导出签名保持不变，断言一行都不用改。
//
// 注意：真实 handler 依赖 ctx（catch 分支读 ctx.logger），且 opts.dshHome 取自 ctx.dshHome。
// 测试传入的 ctx 可能是 {} 或 {dshHome}，这里在驱动前补一个最小 logger stub（console）。

import { createCtHandler, MAX_BODY_BYTES } from "../../../lib/handler.js"
import {
  MAX_SOURCE_BYTES,
  INSTRUCTION_CANDIDATES,
  LOCAL_INSTRUCTION_CANDIDATES,
  PROJECT_ROOT_MARKERS,
  resolveDshHomeLocal,
  findProjectRootSync,
  ancestorChain,
  discoverInstructions,
  isDiscoveredPath,
} from "../../../lib/instructions.js"

// —— 常量（全部来自真实实现）——
export { MAX_BODY_BYTES, MAX_SOURCE_BYTES }
export const constants = {
  MAX_BODY_BYTES,
  MAX_SOURCE_BYTES,
  INSTRUCTION_CANDIDATES,
  LOCAL_INSTRUCTION_CANDIDATES,
  PROJECT_ROOT_MARKERS,
}

// —— discover 纯函数（真实实现）——
export {
  resolveDshHomeLocal,
  findProjectRootSync,
  ancestorChain,
  discoverInstructions,
  isDiscoveredPath,
}

// —— HTTP handler（真实实现驱动）——
const LOGGER_STUB = {
  fatal: () => {},
  error: (...a) => (typeof console !== "undefined" ? console.error(...a) : void 0),
  warn: (...a) => (typeof console !== "undefined" ? console.warn(...a) : void 0),
  info: (...a) => (typeof console !== "undefined" ? console.info(...a) : void 0),
  debug: () => {},
  log: () => {},
  trace: () => {},
}

/**
 * ROUTER 接驳点：把真实 createCtHandler 生成的 handler 挂到 (req,res) 上。
 * ctx 可选：{ dshHome, promptsItems, ... }。缺 logger 时补一个最小 stub，
 * dshHome/promptsItems 透传为 opts（promptsItems 供黑盒测试注入桩数据）。
 */
export function ROUTER(req, res, ctx) {
  // 真实 handler 是 async；ROUTER 原契约签名也是 async，这里直接返回其 promise，
  // 兼容 createHttpHarness 忽略返回值 与 调用方 await ROUTER(...) 两种用法。
  const base = ctx && typeof ctx === "object" ? ctx : {}
  const fullCtx = { ...base, logger: base.logger || LOGGER_STUB }
  const opts = { dshHome: base.dshHome, promptsItems: base.promptsItems, promptsError: base.promptsError }
  const handler = createCtHandler(fullCtx, opts)
  return handler(req, res)
}
