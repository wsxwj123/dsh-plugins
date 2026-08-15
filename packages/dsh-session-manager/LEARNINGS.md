# LEARNINGS — dsh-session-manager（项目专属）

## lib/ 是入库构建产物：改 src/ 后必须 build 并把 lib/ 一起 commit
- 现象：client 源码 commit 漏带 `lib/client.js`，仓库里 lib/ 落后于 src/，测试 import 的编译产物与源码不一致。
- 规则：本仓库 `lib/` 被 git 跟踪（CODE-REVIEW S7 曾建议"构建生成不入库"，暂缓待用户确认），
  每次改 `src/` 后跑 `npm run build`，commit 时必须 `git add lib/` 同步产物；
  `tests/unit/*.test.js` 直接 import `lib/*.js`（如 `lib/pending-deletes-core.js`），
  产物落后会让单测实际测的是旧代码——改动看起来全绿，行为却不是新的。
- 本仓库 `test:unit` 脚本硬编码文件列表（package.json scripts）：新增单测文件需改
  package.json（红线需用户确认），新断言优先复用现有测试文件，不要为此动 package.json。

## 单测里 fire stub 的默认行为
- `tests/unit/pendingDeletes.unit.test.js` 的 `makeDeps()` 默认 `fire` 返回 `{ ok: true }`。
  测 failed/cleanup 状态时若不覆盖 fire，断言会拿到"成功清除"而非预期状态——写新用例前先想清楚 fire 要返回什么。
