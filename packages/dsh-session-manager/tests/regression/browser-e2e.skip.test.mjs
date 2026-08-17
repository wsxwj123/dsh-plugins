/**
 * 需要真实浏览器才能验的场景：全部 skip，作为可见的覆盖缺口清单。
 *
 * 为什么本包测不了：没有 jsdom，也没装 react/react-dom（本 worktree 无
 * node_modules）；DeleteButton 依赖 `querySelectorAll(':scope [role=treeitem]')`、
 * `dataset`、`innerHTML`、MutationObserver，手写 DOM stub 等于自己实现一个选择器
 * 引擎——成本高于收益，而且假 DOM 恰恰是本次盲审点名的“stub 把危险假设写成真”。
 *
 * 04（修复）之后的 playwright 接线方法（同仓 packages/composer-tools 已有
 * playwright 依赖与配置，照抄即可）：
 *   1. `pnpm --filter dsh-session-manager add -D @playwright/test`（红线：需用户确认）
 *      或直接复用 composer-tools 的 devDependency + 一份 playwright.config.ts。
 *   2. 前置：`dsh web` 起在固定端口（loopback，trust fence 才放行），
 *      并把本插件装进 ~/.dsh/profiles/web；测试用 `page.goto('http://127.0.0.1:<port>')`。
 *   3. fixture：先用 `/sm/*` 直接造数据（POST /sm/delete 造回收站条目，
 *      官方 archiveSession 造归档会话），再进 UI 断言，避免 UI 造数据的连环依赖。
 *   4. 断言锚点只用 role/aria（`[role=treeitem]`、`会话“X”的操作`）与我们自己的
 *      `[data-dsh-sm-delete]`，不要用 hash 后的 CSS Module 类名。
 */
import { test } from 'node:test'

const SKIP = '需要真实浏览器：04 后用 playwright 接线（接线方法见本文件头注释）'

test('F2-e2e: 拖拽过顺序 + 同名会话的侧栏里，删除按钮删掉的必须是本行会话', { skip: SKIP }, () => {
  // 造两个同名未命名会话（同一 cwd 下 displayTitle = basename），
  // 手动拖拽改顺序使 DOM 行序 ≠ snapshot.ids 序，
  // 点第 2 行的删除 → 等 5s 窗口 → 断言 /sm/trash 里的 id 是第 2 行那个。
})

test('F2-e2e: 归档 + 子代理同名会话存在时，可见行的删除不得命中它们', { skip: SKIP }, () => {
  // 归档一个同名会话 + 造一个 subagent 子会话，点可见行删除，
  // 断言归档视图里的那条仍在、subagent 仍在。
})

test('F3-e2e: 归档视图的「恢复」按钮点一下就把会话从回收站搬回列表', { skip: SKIP }, () => {
  // POST /sm/delete 造条目 → 打开归档视图 → 点「恢复」→
  // 断言 /sm/trash 空、侧栏行回来（reconcileWithTrash 放开隐藏）。
})

test('L3-e2e: React 复用行节点后，注入按钮必须重新绑定到新会话 id', { skip: SKIP }, () => {
  // 切换分组/搜索让 React 复用 treeitem 节点，
  // 断言同一行的按钮 aria-label / dataset id 跟着变，删除命中的是当前会话。
})

test('M5-e2e: A 标签页删除后，B 标签页的同一行必须同步消失', { skip: SKIP }, () => {
  // 两个 page 打开同一 URL，A 删除并等窗口结束，
  // 断言 B 的行在 storage 事件后隐藏（不用刷新）。
})

test('H1-e2e: 取消归档后刷新页面，会话不得回到归档视图', { skip: SKIP }, () => {
  // 这一条是报告建议的“2 分钟人工验证”的自动化版：
  // 取消归档 → ctx.workspaces.refresh() / page.reload() → 断言不回滚。
})
