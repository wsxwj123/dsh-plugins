/**
 * client→host bridge: raw fetch over the same-origin `/ct/*` RPC surface.
 *
 * 宿主端 `/ct` 前缀路由是 RAW HTTP JSON 面（返回 { ok:true, … }，接受裸 body），
 * 受宿主 loopback trust fence 守护。本文件是 client 的薄类型化调用器：
 * 全部运输逻辑（网络错误捕获）在纯、可注入 fetch 的 bridgeCore 里，本文件只把
 * `/ct` 基路径接过去。所有调用都是 JSON POST（GET-free）。
 */
import { postJson, type CtResult } from './bridgeCore.ts'

export type { CtResult } from './bridgeCore.ts'

const BASE = '/ct'

function post(path: string, body: unknown): Promise<CtResult> {
  return postJson(BASE + path, body)
}

/** 发现指令文件（INTERFACE §1.1）。 */
export function ctInstructionsList(cwd: string): Promise<CtResult> {
  return post('/instructions.list', { cwd })
}

/** 读单个指令文件（INTERFACE §1.2）。 */
export function ctInstructionsRead(cwd: string, path: string): Promise<CtResult> {
  return post('/instructions.read', { cwd, path })
}

/**
 * 写回指令文件（INTERFACE §1.3）。allowTruncatedBase 可选，缺省假；host 用 mtime
 * 乐观锁 + 截断基准保护判定。客户端不自动传 allowTruncatedBase，收到
 * file-truncated 时应提示改用外部编辑器。
 */
export function ctInstructionsSave(
  cwd: string,
  path: string,
  content: string,
  expectedMtimeMs: number,
  allowTruncatedBase?: boolean,
): Promise<CtResult> {
  return post('/instructions.save', {
    cwd,
    path,
    content,
    expectedMtimeMs,
    ...(allowTruncatedBase === true ? { allowTruncatedBase: true } : {}),
  })
}

/** 提示词库全量下发（INTERFACE §1.4）。 */
export function ctPrompts(): Promise<CtResult> {
  return post('/prompts', {})
}

/** 导出 Ct 结果类型别名供调用方使用。 */
export type CtBridgeResult = CtResult
