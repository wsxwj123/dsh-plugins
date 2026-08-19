// client 契约验收接驳层（已接驳真实实现，2014-接驳）。
//
// 本文件不再实现契约替身逻辑，而是把 tests/acceptance 需要的 client 纯函数
// 直接接回包根 lib/ 的真实实现，让黑盒契约测试命中的就是真实插件代码。
//
//   - arrowGateAction      ← lib/gate.js
//   - createHistory / recordSend / recallOlder / recallNewer / resetCursor
//     / HISTORY_LIMIT      ← lib/history-core.js
//   - userMessageText / isUserMessageNode / newUserTexts ← lib/session-history.js
//   - historyStorageKey / loadHistory / saveHistory        ← lib/history-storage.js
//   - appendPromptToDraft                                  ← lib/append.js
//
// 增量 3 修订（PLAN §9.9）：history-core 移除 capturePending/commitPending/dropPending
// （INTERFACE §2.2），新增单段式 recordSend 与 session-history 纯函数（§2.7）——
// 导出面随契约同步替换；lib/session-history.js 尚未实现时本文件 import 即红（预期）。
// helpers/ 位于 tests/acceptance/helpers/，向上两级到包根再进 lib/。

export { arrowGateAction } from "../../../lib/gate.js"
export {
  HISTORY_LIMIT,
  createHistory,
  recallNewer,
  recallOlder,
  recordSend,
  resetCursor,
} from "../../../lib/history-core.js"
export {
  createSnapshotCapture,
  isUserMessageNode,
  newUserTexts,
  userMessageText,
} from "../../../lib/session-history.js"
// 接线层（非纯函数但无 DOM 依赖）：test-15 用它按真实 DSH 路径驱动"快照采集 →
// 落盘 → ↑ 回填"整条链，避免测试里另写一份接线（Bug 3 漏检的根因）。
export { createHistoryNav } from "../../../lib/history-nav.js"
export { historyStorageKey, loadHistory, saveHistory } from "../../../lib/history-storage.js"
export { appendPromptToDraft } from "../../../lib/append.js"
