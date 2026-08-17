# LEARNINGS — dsh-session-manager（项目专属）

## lib/ 是不入库的构建产物：测试脚本自己先 build（2026-08-17 修正，原为"入库"）
- 现象：`tests/unit/*.test.js` / `tests/integration/*` 直接 import `lib/*.js`，而 `.gitignore`
  忽略 `lib/`，测试脚本又不带构建——新克隆的工作树里这些测试一条也跑不起来（MODULE_NOT_FOUND），
  产物落后时更糟：全绿但测的是旧代码。三方口径矛盾（gitignore ∥ 测试 import ∥ 本文件旧说法）。
- 现行规则：`lib/` **不入库**（`.gitignore` 保持忽略，构建产物不进 git），
  `package.json` 的 `pretest:unit` / `pretest:integration` 先跑 `npm run build`，
  所以 `npm run test:unit` / `test:integration` 永远测的是当前源码。
  手工直接 `node --test tests/unit/...` 时要自己先 `npm run build`。
- 反例（勿回退）：靠"记得 git add lib/"来保证一致性——漏一次就得到假绿。
- 本仓库 `test:unit` 脚本硬编码文件列表（package.json scripts）：新增单测文件需改
  package.json（红线需用户确认），新断言优先复用现有测试文件，不要为此动 package.json。

## 单测里 fire stub 的默认行为
- `tests/unit/pendingDeletes.unit.test.js` 的 `makeDeps()` 默认 `fire` 返回 `{ ok: true }`。
  测 failed/cleanup 状态时若不覆盖 fire，断言会拿到"成功清除"而非预期状态——写新用例前先想清楚 fire 要返回什么。
