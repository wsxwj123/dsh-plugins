# SPIKE-T0 — dsh-composer-tools 关键假设实证

日期：2026-08-15
状态：代码依据已确认（B 级），实机细节标注待实现阶段确认（A 级待补）
背景：04 开发前置 spike，实证 4 个"到底行不行"的假设，结论回填 INTERFACE §3。
执行说明：两个 T0 子代理均未产出实机报告，主会话直接以打包产物行号证据完成代码依据级实证；
实机行为（data-phase 实际取值序列、capture 与 DSH 监听实际先后）留待实现阶段（T8 后 e2e）确认，
fail-safe 语义保证任何未实证分支不破坏 DSH 原生行为。

---

## ① document capture keydown 先于 InputBar 生效？

**结论：成立（B 级代码依据）**

- React 18 事件监听挂在 root 容器（react-dom.development.js:9132 listenToAllSupportedEvents），document 级 capture 监听（第三个参数 true）在事件捕获阶段先于 root 上的监听触发（公开文档行为）。
- DSH 自身在 document 上注册的 keydown：`dsh-client-ui-conversation/lib/client.js:2955-2956`
  `document.addEventListener("keydown", onKeyDown)`——**注意无 capture 参数**（非捕获）。
  我们以 capture=true 注册 → 捕获阶段先于该非捕获监听执行；`stopPropagation()` 可阻断后续传播。
- 该 onKeyDown 是 MenuView 的关闭逻辑（2950 附近），非输入主链路，被 capture 拦截不影响输入。
- **结论**：capture + stopPropagation 能让 InputBar 的 onKeyDown（React root 冒泡）完全收不到方向键事件。✅

**残留待实机**：DSH 是否有其他注册更早、也是 capture 的 document keydown（grep 未见，打包产物确认无）。实现阶段 e2e 守门。

---

## ② slot entry props 能否拿到 inputActions.setDraft 且可写？

**结论：成立（B 级代码依据）**

- InputBar 自身就从 standard props 拿 `inputActions`（client.js:3328 函数签名、3393 调用
  `inputActions.pruneImages`）——证明 session 级 slot 组件的 standard props 确实含 inputActions。
- 类型契约：`dsh-client-ui-conversation/lib/types/client/input/contract.d.ts:67`
  `setDraft(text: string): void` 在 InputActions 公开面；facade.d.ts:66 同签名（含 EditRange 可选）。
- provide channel：conversation 插件 `sessions.provide({hooks:['input'], props:['inputActions'],...})`
  （client.js:9504-9514，RESEARCH Q1b 已核对），runtime 契约保证"every session-scope slot component
  receives the contributed members as standard props"。
- **结论**：往 conversation.input.right 注册的 entry 组件能拿到 inputActions.setDraft 并调用回填。✅

**残留待实机**：entry 组件真实渲染时 props 是否注入（实现阶段 T8 后 e2e 确认）；R3 风险依旧
（未承诺稳定，props 缺失时降级）。

---

## ③ 斜杠菜单打开时 textarea 的 data-phase 取值序列？

**结论：判定方向成立（B 级代码依据），取值序列待实机（A 级待补）**

- textarea 绑定：`client.js:3800` `"data-phase": input?.phase ?? "inert"`——实时反映 InputState.phase。
- phase 枚举：`contract.d.ts:196` `'plain'|'adjudicating'|'claimed'|'submitting'`。
- 命令菜单（input-trigger）活跃时：菜单打开/仲裁阶段 phase 为 `adjudicating`/`claimed`
  （RESEARCH Q1a + input-trigger arbitrate 逻辑 client.js:356-382），非 `plain`。
- **关键修正（相对原方案）**：`input?.phase ?? "inert"`——input 为 undefined（无会话/未初始化）时
  data-phase 是 `"inert"` 而非 `"plain"`。因此 menuOpen 判定 `data-phase !== 'plain'` 在无会话态
  也为 true。**这恰好符合 fail-safe 语义**（无会话时宁可放行历史不抢菜单），但表述应准确：
  "menuOpen = data-phase 存在且 !== 'plain'（含 'inert' 无会话态）"。
- **fail-safe 契约维持**：属性读不到（元素不在/属性缺失/空串）时按 menuOpen=true 处理——宁可历史
  失效不抢菜单按键。

**残留待实机**：菜单打开→关闭的实际取值序列（'plain'→'adjudicating'→'claimed'→'plain'？）需实机
观察；单测无法覆盖 DOM 行为，留给 e2e。**判定逻辑本身（!== 'plain' 即放行）已可写死进 gate.ts**，
实现后由 e2e 验证不破坏菜单导航。

---

## ④ 黑魔法备案（native setter + dispatchEvent('input')）在 React 18 受控 textarea 是否生效？

**结论：机制成立（B 级代码依据），建议不启用（实现用 setDraft）**

- React 18.3.1 内置 inputValueTracking（react-dom.development.js:1698 updateValueIfChanged），
  用原生 `HTMLTextAreaElement.prototype.value` setter 绕过 tracker 后 dispatch
  `new Event('input',{bubbles:true})`，React 会因 tracker 值与 DOM 值不一致触发 onChange——
  社区通用技巧（RESEARCH Q1a 已核实机制在 18.3.1 仍在）。
- **但本插件不需要它**：②已确认 inputActions.setDraft 是官方单写路径，回填走 setDraft 即可，
  无需模拟 DOM 事件。黑魔法仅作为 setDraft 失效时的备案（R3），**未验证前不作为缓解依据**。

**残留待实机**：如最终启用备案，需最小 React 18 页实测；当前不启用，风险表 R3 已注明。

---

## 对下游设计的影响

| 假设 | 结论 | 对 INTERFACE/实现的影响 |
|---|---|---|
| ① capture 拦截 | ✅ 成立 | gate.ts + HistoryNav 的 document capture keydown 方案不变；e2e 守门 DSH 自有监听 |
| ② setDraft | ✅ 成立 | entry 组件 props 拿 inputActions.setDraft 回填，方案不变 |
| ③ data-phase | ✅ 方向成立 | menuOpen 判定表述修正："data-phase 存在且 !== 'plain'（含 inert）"；fail-safe 不变 |
| ④ 黑魔法 | 机制成立/不启用 | 备案保留但标注未验证，实现用 setDraft |

**无假设被证伪**。无需改方案层设计。INTERFACE §3 的 menuOpen 条目已按 ③ 的修正更新。

---

## 待实现阶段实机确认清单（e2e 守门）

1. 真实 dsh web 输入框敲 `/` 打开命令菜单，观察 data-phase 取值序列（'plain'→?→'plain'）
2. document capture keydown 与 DSH 全部 keydown 监听的实测先后（确认无更早 capture 监听）
3. entry 组件真实渲染后 props 含 inputActions.setDraft 且可写
4. 方向键历史全链路（T8 后 e2e：单行/首行/末行/中间行/菜单打开/面板焦点）
