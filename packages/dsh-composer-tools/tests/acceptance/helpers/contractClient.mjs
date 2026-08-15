// client 契约验收接驳层（已接驳真实实现，2014-接驳）。
//
// 本文件不再实现契约替身逻辑，而是把 tests/acceptance 需要的 client 纯函数
// 直接接回包根 lib/ 的真实实现，让黑盒契约测试命中的就是真实插件代码。
//
//   - arrowGateAction      ← lib/gate.js
//   - createHistory / capturePending / commitPending / dropPending
//     / recallOlder / recallNewer / resetCursor / HISTORY_LIMIT ← lib/history-core.js
//   - historyStorageKey / loadHistory / saveHistory        ← lib/history-storage.js
//   - appendPromptToDraft                                  ← lib/append.js
//
// 对外导出签名保持不变，断言一行都不用改。
// helpers/ 位于 tests/acceptance/helpers/，向上两级到包根再进 lib/。

export { arrowGateAction } from "../../../lib/gate.js"
export {
  HISTORY_LIMIT,
  capturePending,
  commitPending,
  createHistory,
  dropPending,
  recallNewer,
  recallOlder,
  resetCursor,
} from "../../../lib/history-core.js"
export { historyStorageKey, loadHistory, saveHistory } from "../../../lib/history-storage.js"
export { appendPromptToDraft } from "../../../lib/append.js"
