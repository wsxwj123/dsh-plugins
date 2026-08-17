# TEST-PLAN — dsh-appearance-gallery 验收测试清单

黑盒验收：只依据 `.devflow/BRIEF.md` 与 `.devflow/INTERFACE.md` 设计，**没看过任何实现代码**。
测试目录 `tests/acceptance/appearance-gallery/`。

## 怎么跑（一条命令，macOS / Windows 通用）

```
node --test "tests/acceptance/appearance-gallery/*.test.mjs"
```

- **引号必须留着**：POSIX shell 会自己展开 `*`，引号让 node 用内建 glob（Windows cmd/PowerShell 不展开，行为一致）。
- Node 25.9 起 `node --test <目录>` 会把目录当模块加载并报 `MODULE_NOT_FOUND`，**别用目录形式**。
- 当前结果：**458 条，0 失败，65 跳过**（跳过 = 45 条等 `packages/appearance-gallery/` 落地的静态门禁 + 20 条真机/契约待补项）。
- 04 之后换成真实实现：`APPEARANCE_SUBJECT=real node --test "…"`，接线点只有一个文件 `helpers/subject.mjs`。
- UI 流程（`e2e/appearance-gallery.spec.mjs`，16 条）：`pnpm add -D @playwright/test` → `dsh web --port 3199` → `DSH_E2E_BASE_URL=http://localhost:3199 npx playwright test tests/acceptance/appearance-gallery/e2e`。**现在只做了语法检查，没真跑。**

## 一、设置页入口注册（01-slot-registration，9 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 01-1 | 全包只有一处槽位注册 | 启动插件 | `slots.register` 只被调用 1 次 |
| 01-2 | 注册到正确槽位 | 启动插件 | 槽位名 = `settings.general.item` |
| 01-3 | 条目 id 正确 | 启动插件 | id = `appearance-gallery` |
| 01-4 | 不沿用旧包 id | 启动插件 | id 既不是 `theme-gallery` 也不是 `skin-gallery`（否则宿主启动会抛错） |
| 01-5 | 视觉位置 | 启动插件 | order = 11 |
| 01-6 | 不占宿主位置 | 启动插件 | order 不等于 20（宿主 `composer-enter` 占用） |
| 01-7 | 不传优先级 | 启动插件 | 注册参数里没有 `priority` 字段 |
| 01-8 | 注册时机 | 启动插件 | register 发生在 `inject('settings.general.item')` 回调内 |
| 01-9 | 缺前置服务时不注册 | 让宿主不提供 `theme` 服务 | 一次 register、一次 inject 都不发生 |

## 二、插件生命周期与启动恢复（02-lifecycle-startup，21 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 02-1 | 缺 theme 服务 | 宿主只给 slots | 直接退出，不注入样式 |
| 02-2 | 缺 slots 服务 | 宿主只给 theme | 直接退出，不注入样式 |
| 02-3 | 两个服务都缺时不碰用户数据 | 宿主什么都不给 | localStorage 读/写/删 次数全部为 0 |
| 02-4 | 样式只注入一份 | 正常启动 | `style[data-appearance-gallery]` 恰好 1 个 |
| 02-5 | 停用插件清理样式 | 启动后停用 | 该 style 变 0 个 |
| 02-6 | 停用不删用户设置 | 预置 4 个键后停用 | 8 个键的值一字不变 |
| 02-7 | 老用户自定义主题优先 | 预置 applied=mine + registry 含 mine | 生效的是 mine，不是 jade |
| 02-8 | 没设置过时回落默认 | 全新用户启动 | 生效主题 = jade（label「竹青」） |
| 02-9 | 不开面板皮肤也生效 | 预置 `skin-gallery-skin-v1=miku` | 刷新后 body 上出现 miku 标记 |
| 02-10 | 自定义皮肤优先于内置 | 两个键都有值 | 生效的是自定义那个 |
| 02-11 | 恢复后仍在列表里 | 预置自定义皮肤 + applied | 该皮肤出现在皮肤列表 |
| 02-12 | 宿主没给模块能力 | 去掉 `__DSH_MODULES__` | 皮肤引擎为 null |
| 02-13 | 皮肤区降级文案 | 同上，打开面板 | 显示「皮肤轨道不可用：宿主未提供 `__DSH_MODULES__`。」 |
| 02-14 | 降级时不渲染皮肤卡 | 同上 | 一张皮肤卡片都没有 |
| 02-15 | 降级时不渲染皮肤搜索框 | 同上 | 没有皮肤搜索框 |
| 02-16 | 降级时不渲染皮肤按钮 | 同上 | 「导入皮肤」「删除皮肤」「恢复默认外观」「创建自定义皮肤」全部不出现 |
| 02-17 | 降级不影响主题区 | 同上 | 主题卡片与搜索框照常渲染 |
| 02-18 | 降级不抛错 | 同上 | 插件仍完成槽位注册 |
| 02-19 | 旧 skin 包在场 | 预置 `<style data-skin-gallery>` | 入口多出冲突提示原文 |
| 02-20 | 旧 theme 包在场 | 预置 `<style data-theme-gallery>` | 同样出现冲突提示 |
| 02-21 | 没有旧包时安静 | 干净环境 | 不出现冲突提示 |

## 三、入口与二级面板（03-entry-panel，17 条含 1 跳过）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 03-1 | applied 键指向已删主题 | 预置 applied=ghost + 空 registry | 摘要显示「精选主题 · 竹青」（眼睛看到的就是 jade） |
| 03-2 | 摘要区不塞卡片 | 同上 | 摘要里没有任何主题卡/皮肤卡 |
| 03-3 | 自定义主题摘要 | applied 指向真实存在的 mine | 摘要显示该主题的 label |
| 03-4 | 皮肤生效时摘要让位给皮肤 | 预置内置皮肤生效 | 摘要前缀是「完整皮肤 · 」而不是「精选主题 · 」 |
| 03-5 | 「默认外观」文案 | — | **跳过**：INTERFACE 未定义触发条件（见文末歧义 A2） |
| 03-6 | 闭合态很轻 | 不点入口 | 渲染节点数 ≤ 10 |
| 03-7 | 闭合态无主题卡 | 不点入口 | 没有主题卡片 |
| 03-8 | 闭合态无皮肤卡 | 不点入口 | 没有皮肤卡片 |
| 03-9 | 闭合态无输入框 | 不点入口 | 没有任何 textarea |
| 03-10 | 点开后两区同时挂载 | 点入口按钮 | 主题卡 + 皮肤卡 + textarea 同时出现 |
| 03-11 | 面板以组件方式挂载 | 点入口按钮 | 两个 Panel 都作为组件节点出现（不是被直接函数调用，否则 React hooks 会报错） |
| 03-12 | 关面板不动用户设置 | 试穿皮肤后点「返回」 | 8 个键的值与关闭前完全相同 |
| 03-13 | 关面板撤销试穿态 | 同上 | `getPreviewState().skinId` 变空 |
| 03-14 | 关面板回到已应用皮肤 | 已应用 qq98，试穿 miku，点「返回」 | 页面回到 qq98 |
| 03-15 | 没应用过就关面板 | 无 applied，试穿 miku，点「返回」 | 皮肤被卸干净，body 上无残留 |
| 03-16 | 主题试穿也会撤销 | 已应用 ember，试穿自定义主题，点「返回」 | token 回到 ember |
| 03-17 | 自定义皮肤 applied 时试穿内置 | 试穿 xp 后点「返回」 | 回到自定义皮肤 navi |

## 四、主题区功能（04-theme-track，27 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 04-1 | 搜索框空 | 打开面板 | 计数显示 15/15 |
| 04-2 | 按中文名搜 | 输入「竹青」 | 计数 1/15 |
| 04-3 | 大小写不敏感 | 输入 `TERRA` | 计数 1/15 |
| 04-4 | 搜不到不报错 | 输入不存在的词 | 计数 0/15，页面正常 |
| 04-5 | 超长搜索词 | 输入 65 个字符 | 被截断成 64 |
| 04-6 | 点内置主题卡 | 点 ember | family=ember、applied=''、touched='1'、track='theme' |
| 04-7 | 未知内置 id | 传一个不存在的 id | 静默不动，8 个键一个都没变 |
| 04-8 | 空 id | 传空字符串 | 静默不动 |
| 04-9 | 导入主题成功 | 粘贴合法 JSON | 该主题出现在自定义列表 |
| 04-10 | 落盘格式 | 同上 | registry 是 `{version:1, items:[…]}` |
| 04-11 | 导入不等于应用 | 同上 | applied 键仍为空 |
| 04-12 | 导入不改当前外观 | 当前 azure，导入新主题 | 页面外观不变 |
| 04-13 | 同 id 覆盖保留原位 | 导入 a、b，再导入 a' | 列表顺序仍是 [a,b]，a 的内容是新的 |
| 04-14 | 试穿只是看一眼 | 试穿自定义主题 | token 生效，但 8 个键一个都没写 |
| 04-15 | 试穿未知 id | 试穿不存在的 id | 抛 `ERR_UNKNOWN_ID` |
| 04-16 | 试穿失败不留痕 | 同上 | token 没变，storage 没变 |
| 04-17 | 应用自定义主题 | 点「应用」 | applied=id、family=''、touched='1'、track='theme' |
| 04-18 | 应用未知 id | 应用不存在的 id | 抛 `ERR_UNKNOWN_ID`，storage 不变 |
| 04-19 | 删除自定义主题 | 删 a | 列表只剩 b |
| 04-20 | 删掉正在用的主题 | 删 applied 项 | applied=''、family='jade'、touched='1'、track='theme'，页面重绘 jade |
| 04-21 | 删别的不影响当前 | 删非 applied 项 | applied 键不动 |
| 04-22 | 想删内置主题 | 传 `jade` | 静默不动，storage 不变 |
| 04-23 | 删不存在的 | 传 `zzz` | 静默不动，storage 不变 |
| 04-24 | 恢复默认清空列表 | 点恢复默认主题 | registry 变 `{version:1,items:[]}` |
| 04-25 | 恢复默认回 jade | 同上 | family='jade'、applied='' |
| 04-26 | touched 键是删除而不是清空 | 同上 | 该键**不存在**（不是空串）——这是「没碰过的原生 jade」与「显式回到 jade」的区分依据 |
| 04-27 | 恢复默认写轨道键 | 同上 | track='theme'，页面重绘 jade |

## 五、主题 JSON 导入的把关（05-theme-import，45 条含 1 跳过）

「校验顺序」= 同时有两处错时先报哪个错误码。测试按 INTERFACE §3.6 的 1→8 顺序逐档验。

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 05-1 | 粘的不是 JSON | 粘一段中文 | `ERR_IMPORT_INVALID_JSON` |
| 05-2 | 什么都没粘 | 空字符串 | `ERR_IMPORT_INVALID_JSON` |
| 05-3 | 粘了个数组 | `[]` | `ERR_IMPORT_INVALID_JSON` |
| 05-4 | 粘了 null | `null` | `ERR_IMPORT_INVALID_JSON` |
| 05-5 | 粘了数字 | `42` | `ERR_IMPORT_INVALID_JSON` |
| 05-6 | 复制粘贴截断了 | `{"id":"a","label":` | `ERR_IMPORT_INVALID_JSON` |
| 05-7~9 | 缺 id / label / tokens | 各删一个字段 | `ERR_THEME_MISSING_FIELD` |
| 05-10 | tokens 是空对象 | `tokens:{}` | `ERR_THEME_MISSING_FIELD` |
| 05-11 | id 是空串 | `id:""` | `ERR_THEME_MISSING_FIELD` |
| 05-12 | id 是数字 | `id:123` | `ERR_THEME_MISSING_FIELD` |
| 05-13 | label 是空串 | `label:""` | `ERR_THEME_MISSING_FIELD` |
| 05-14 | tokens 是非空数组 | — | **跳过**：INTERFACE 未定义落哪个码（见歧义 A3） |
| 05-15 | id 有大写 | `Mine` | `ERR_THEME_MISSING_FIELD` |
| 05-16 | id 开头是连字符 | `-mine` | `ERR_THEME_MISSING_FIELD` |
| 05-17 | id 有空格 | `my theme` | `ERR_THEME_MISSING_FIELD` |
| 05-18 | id 是中文 | `我的主题` | `ERR_THEME_MISSING_FIELD` |
| 05-19 | id 是 emoji | `🎨` | `ERR_THEME_MISSING_FIELD` |
| 05-20 | id 正好 64 字符 | 边界内 | 导入成功 |
| 05-21 | id 65 字符 | 越界 1 个 | `ERR_THEME_MISSING_FIELD` |
| 05-22 | id 只有 1 个字符 | `x` | 导入成功 |
| 05-23 | label 正好 80 字 | 边界内 | 导入成功 |
| 05-24 | label 81 字 | 越界 1 个 | `ERR_THEME_MISSING_FIELD` |
| 05-25 | id 撞 jade | `jade` | `ERR_THEME_ID_CONFLICT` |
| 05-26 | 15 个内置 id 全试 | 逐个试 | 15 次全是 `ERR_THEME_ID_CONFLICT` |
| 05-27 | token 键前缀不对 | `--other-bg` | `ERR_THEME_BAD_TOKEN` |
| 05-28 | token 值直接写颜色 | `"--dsw-bg":"#fff"` | `ERR_THEME_BAD_TOKEN`（必须是 `{light,dark}`） |
| 05-29 | token 值缺 dark | 只给 light | `ERR_THEME_BAD_TOKEN` |
| 05-30 | token 值有空串 | `light:""` | `ERR_THEME_BAD_TOKEN` |
| 05-31 | token 值想闭合 CSS 规则 | 值里带 `}` | `ERR_THEME_BAD_TOKEN`（防注入新规则） |
| 05-32 | token 值想追加声明 | 值里中间带 `;` | `ERR_THEME_BAD_TOKEN` |
| 05-33 | token 值以分号收尾 | `#fff;` | 允许（分号只准在最后一位） |
| 05-34 | JSON 坏 + 字段缺 | 两处都错 | 先报 `ERR_IMPORT_INVALID_JSON` |
| 05-35 | 缺 label + id 撞车 | 两处都错 | 先报 `ERR_THEME_MISSING_FIELD` |
| 05-36 | id 撞车 + token 坏 | 两处都错 | 先报 `ERR_THEME_ID_CONFLICT` |
| 05-37 | label 超长 + token 坏 | 两处都错 | 先报 `ERR_THEME_MISSING_FIELD` |
| 05-38 | label 用中文加 emoji | 「深夜🌙的墨色」 | 原样保留，不被转义或截断 |
| 05-39 | 一次导入 500 个 token | 超大主题 | 成功（主题没有体积上限） |
| 05-40 | 连导 20 个主题 | 重复导入 | 全部保留（主题没有数量上限） |
| 05-41 | JSON 里带多余字段 | 加 `evil`/`version` | 被忽略，落盘只有 id/label/tokens 三个键 |
| 05-42 | 导入失败不写盘 | 故意粘坏数据 | 8 个键一个都没写，写入次数 = 0 |
| 05-43 | 导入失败不清已有数据 | 已有 keep，再导入撞车的 | keep 的数据完好 |
| 05-44 | 导入失败不改外观 | 当前 azure | 页面还是 azure |
| 05-45 | 导入失败不加样式节点 | 故意失败 | style 数量不变 |

## 六、皮肤区功能（06-skin-track，34 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 06-1 | 皮肤搜索框空 | 打开面板 | 计数 9/9 |
| 06-2 | 有 1 个自定义皮肤 | 预置后打开 | 计数 10/10 |
| 06-3 | 按 id 搜 | 输入 `miku` | 计数 1/9 |
| 06-4 | 搜不到 | 输入乱码 | 计数 0/9 |
| 06-5 | 超长搜索词 | 输入 100 字符 | 截断成 64 |
| 06-6 | 试穿内置皮肤 | 点「试穿」 | body 属性 + 内联 style + 皮肤 style 都到位 |
| 06-7 | 试穿不落盘 | 同上 | 8 个键一个都没写 |
| 06-8 | 试穿不存在的皮肤 | 传乱 id | `ERR_UNKNOWN_ID` |
| 06-9 | 试穿失败不留痕 | 同上 | body 干净，storage 不变 |
| 06-10 | 皮肤代码丢了 | 内嵌 bundle 缺失 | 抛 `[theme-gallery-skin] unknown-skin: qq98`（无 code） |
| 06-11 | 皮肤执行中途炸了 | 注入失败 | body 回滚到快照，半成品标记不残留 |
| 06-12 | 炸了要先清场再报错 | 同上 | 已注册的清理函数跑完 1 轮，然后才抛错 |
| 06-13 | 应用内置皮肤 | 点「应用」 | skin-v1=id、custom-applied=''、track='skin' |
| 06-14 | 应用自定义皮肤 | 点「应用」 | custom-applied=id、skin-v1=''、track='skin' |
| 06-15 | 应用不存在的内置皮肤 | 乱 id | `ERR_UNKNOWN_ID` |
| 06-16 | 应用不存在的自定义皮肤 | 乱 id | `ERR_UNKNOWN_ID` |
| 06-17 | 应用失败不写键 | 让激活失败 | applied 键与 track 键都不写 |
| 06-18 | 点卡片主体（自定义） | 点卡片 | 与点「应用」结果一致，皮肤生效 |
| 06-19 | 点卡片主体（内置） | 点卡片 | 写 skin-v1，皮肤生效 |
| 06-20 | 恢复默认外观 | 点按钮 | 卸载皮肤 + registry 清空 + 两个 applied 键清空 |
| 06-21 | 恢复默认写轨道键 | 同上 | track='skin' |
| 06-22 | 恢复默认不碰主题 | 同上 | 主题轨的键一个不动 |
| 06-23 | 设计助手勾选联动 | 勾一个版块 | 只读文本框内容变化 |
| 06-24 | 取消勾选还原 | 勾了再取消 | 文本框内容回到原样 |
| 06-25 | 版块数量 | 数一下 | 恰好 11 个 |
| 06-26 | 设计助手不碰数据 | 勾完 11 个 | 一次 storage 写操作都没有 |
| 06-27 | 助手里的仓库路径已更新 | 看文本 | 含 `packages/appearance-gallery/skins/`，不含旧路径 |
| 06-28 | 助手里的验收命令已更新 | 看文本 | 含 `pnpm --filter dsh-appearance-gallery`，不含旧命令 |
| 06-29 | 删除自定义皮肤 | 删 a | 列表只剩 b |
| 06-30 | 删掉正在用的皮肤 | 删 applied 项 | 两个 applied 键清空、track='skin'、皮肤被卸载 |
| 06-31 | 删别的不影响当前 | 删非 applied 项 | applied 键不动 |
| 06-32 | 想删内置皮肤 | 传 `miku` | 静默不动 |
| 06-33 | 删不存在的 | 传 `zzz` | 静默不动 |
| 06-34 | 勾选多个批量删 | 删 a 和 c | 只剩 b |

## 七、皮肤三件套导入的把关（07 + 08，共 98 条）

安全闸的定位是「受控导入」——防误粘明显危险的代码 + 给外部交付方一个明确格式契约，**不是沙箱**（INTERFACE 已声明）。

### 7.1 缺文件 / JSON / 元数据 / id（07-skin-import-contract，62 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 07-1 | 没填 skin.json | 留空 | `ERR_SKIN_MISSING_FILE` |
| 07-2 | skin.json 是空串 | 空 | `ERR_SKIN_MISSING_FILE` |
| 07-3 | 没填 client.js | 留空 | `ERR_SKIN_MISSING_FILE` |
| 07-4 | client 传 null | null | `ERR_SKIN_MISSING_FILE` |
| 07-5 | 整个参数没传 | undefined | `ERR_SKIN_MISSING_FILE`（不崩） |
| 07-6 | 传了个空对象 | `{}` | `ERR_SKIN_MISSING_FILE` |
| 07-7 | skin.json 不是 JSON | 粘中文 | `ERR_IMPORT_INVALID_JSON` |
| 07-8 | skin.json 是数组 | `[1,2]` | `ERR_IMPORT_INVALID_JSON` |
| 07-9 | skin.json 是数字 | `7` | `ERR_IMPORT_INVALID_JSON` |
| 07-10 | skin 传了对象不是字符串 | 类型错 | `ERR_IMPORT_INVALID_JSON` |
| 07-11~22 | 四个必填字段 × 缺失/空串/非字符串 | 12 种组合 | 全部 `ERR_SKIN_BAD_META` |
| 07-23 | id 有大写 | `Navi` | `ERR_SKIN_BAD_META` |
| 07-24 | id 开头是下划线 | `_navi` | `ERR_SKIN_BAD_META` |
| 07-25 | id 是中文 | `导航日记` | `ERR_SKIN_BAD_META` |
| 07-26 | id 想穿越目录 | `a/../b` | `ERR_SKIN_BAD_META` |
| 07-27 | id 65 字符 | 越界 | `ERR_SKIN_BAD_META` |
| 07-28 | id 正好 64 字符 | 边界内 | 导入成功 |
| 07-29 | id 撞内置 miku | `miku` | `ERR_THEME_ID_CONFLICT`（皮肤冲突复用 THEME 前缀，不是笔误） |
| 07-30 | 9 个内置皮肤 id 全试 | 逐个 | 9 次全是 `ERR_THEME_ID_CONFLICT` |
| 07-31 | client 传数字 | 类型错 | `ERR_SKIN_CONTRACT` |
| 07-32 | client 缺注册壳 | 只有个 apply 函数 | `ERR_SKIN_CONTRACT` |
| 07-33 | client 缺 factory | 写成 make | `ERR_SKIN_CONTRACT` |
| 07-34 | 少一个右括号 | 括号不配平 | `ERR_SKIN_CONTRACT` |
| 07-35 | 多一个右括号 | 括号不配平 | `ERR_SKIN_CONTRACT` |
| 07-36~47 | 12 条高危 API 逐条试 | eval( / new Function( / import( / require( / `<script src=` / fetch( / XMLHttpRequest( / WebSocket( / localStorage / sessionStorage / document.cookie / chrome.runtime | 12 次全是 `ERR_SKIN_DANGEROUS` |
| 07-48 | 高危串写在注释里 | 注释里提到 document.cookie | 照样 `ERR_SKIN_DANGEROUS`（纯子串匹配） |
| 07-49 | 高危串写在字符串里 | `var s="localStorage"` | 照样 `ERR_SKIN_DANGEROUS` |
| 07-50 | 没导出 apply | 返回空对象 | `ERR_SKIN_CONTRACT` |
| 07-51 | 用 `apply:` 形式导出 | 合法写法 | 导入成功 |
| 07-52 | 用了 `ctx.window` | 白名单外 | `ERR_SKIN_CONTRACT` |
| 07-53 | 报错要说清是哪个名字 | 用 `ctx.scope` | 错误文案里含 `scope` |
| 07-54 | 白名单外的名字写在注释里 | 注释里 `ctx.root` | 照样被拒 |
| 07-55 | 只用 ctx.effect / ctx.get | 合法写法 | 导入成功 |
| 07-56 | 缺文件 + JSON 坏 | 两处都错 | 先报 `ERR_SKIN_MISSING_FILE` |
| 07-57 | JSON 坏 + meta 缺 | 两处都错 | 先报 `ERR_IMPORT_INVALID_JSON` |
| 07-58 | meta 缺 + id 撞车 | 两处都错 | 先报 `ERR_SKIN_BAD_META` |
| 07-59 | id 撞车 + client 类型错 | 两处都错 | 先报 `ERR_THEME_ID_CONFLICT` |
| 07-60 | 缺注册壳 + 有高危串 | 两处都错 | 先报 `ERR_SKIN_CONTRACT` |
| 07-61 | 有高危串 + 没导出 apply | 两处都错 | 先报 `ERR_SKIN_DANGEROUS` |
| 07-62 | 有高危串 + 越权 ctx | 两处都错 | 先报 `ERR_SKIN_DANGEROUS` |

### 7.2 体积 / 数量 / 落盘 / 覆盖生效项（08-skin-import-limits，36 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 08-1 | 体积正好 256KB | base64 恰好 262144 | 导入成功（边界含等号） |
| 08-2 | 体积超 1 字节 | base64 262148 | `ERR_SKIN_SIZE` |
| 08-3 | a11y 不占 bundle 额度 | bundle 满 + a11y 60KB | 导入成功 |
| 08-4 | a11y 正好 64KB | 65536 字节 | 导入成功 |
| 08-5 | a11y 超 1 字节 | 65537 字节 | `ERR_SKIN_SIZE` |
| 08-6 | a11y 按字节不按字数 | 21846 个中文字（65538 字节） | `ERR_SKIN_SIZE` |
| 08-7 | 不填 a11y | 只传两件 | 成功，a11y 记为空串，皮肤仍可用 |
| 08-8 | a11y 类型错 | 传数字 | 静默按缺省处理，不报错（沿用现状） |
| 08-9 | a11y 里有 @import | `@import url(...)` | `ERR_SKIN_DANGEROUS` |
| 08-10 | a11y 拉 http 图 | `url(http://…)` | `ERR_SKIN_DANGEROUS` |
| 08-11 | a11y 用协议相对地址 | `url(//cdn/…)` | `ERR_SKIN_DANGEROUS` |
| 08-12 | 想用引号空格绕过 | `url( "https://…" )` | 照样 `ERR_SKIN_DANGEROUS` |
| 08-13 | a11y 用内嵌图 | `url(data:image/png;…)` | 允许（皮肤合法用途） |
| 08-14 | a11y 又超界又有 @import | 两处都错 | 先报 `ERR_SKIN_SIZE` |
| 08-15 | 已有 7 个再加 1 | 第 8 个 | 导入成功，共 8 个 |
| 08-16 | 已有 8 个再加 1 | 第 9 个 | `ERR_SKIN_COUNT` |
| 08-17 | 已有 8 个覆盖旧的 | 同 id 重导 | 成功，数量还是 8（覆盖不受数量限制） |
| 08-18 | 数量超限 + a11y 危险 | 两处都错 | 先报 `ERR_SKIN_DANGEROUS` |
| 08-19 | 代码全文入库 | 导入后查 | `bundleText` 是 client.js 全文 |
| 08-20 | 落盘格式 | 导入后查 | `{version:1, items:[…]}` |
| 08-21 | bodyAttr 缺省 | 不填 | 自动补 `data-dsh-<id>` |
| 08-22 | bodyAttr 自定义 | 填了 | 用填的那个 |
| 08-23 | accent 缺省 | 不填 | 空串 |
| 08-24 | order 缺省 | 已有 2 个 | 自动 102（100 + 已有数） |
| 08-25 | 来源标记 | 导入后查 | `source='custom'` |
| 08-26 | 名字含中文 emoji 超长 | 500 字 + emoji | 原样保留 |
| 08-27 | 导入不抢当前选中 | 当前用 xp，导入新皮肤 | 仍然是 xp 生效 |
| 08-28 | 改代码重新导入 | 覆盖正在用的同 id | bundleText 换成新的 |
| 08-29 | 重新导入要真的换皮 | 同上，且新版换了 bodyAttr | body 上是新标记，**旧标记不残留** |
| 08-30 | 覆盖的不是当前用的 | 覆盖别的 id | 当前外观纹丝不动 |
| 08-31 | 导入失败不写盘 | 故意命中黑名单 | 8 个键一个没写，写入次数 = 0 |
| 08-32 | 导入失败不执行代码 | 同上 | 脚本注入次数不增加 |
| 08-33 | 导入失败不入库 | 同上 | registry 里查不到该 id |
| 08-34 | 导入失败不换皮 | 当前 xp，导入失败 | 还是 xp |
| 08-35 | 导入失败不加样式 | 同上 | style 数量不变 |
| 08-36 | 导入失败不清已有 | 已有 keep | keep 完好无损 |

## 八、老用户升级与数据安全（09-storage-contract，26 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 09-1 | 键名清单 | 对照 INTERFACE | 恰好 8 个，名字一字不差 |
| 09-2 | 老用户升级 | 预置 8 键全套后启动新包 | **一个键都没被改写** |
| 09-3 | 升级不新增键 | 同上 | 键的集合仍是那 8 个 |
| 09-4 | 老用户的自定义主题 | 同上 | 还在列表里 |
| 09-5 | 老用户的自定义皮肤 | 同上 | 还在列表里 |
| 09-6 | 老用户当前的皮肤 | 同上 | 升级后照旧生效 |
| 09-7 | 全新安装 | 无任何键 | 不报错，回落 jade，且**不主动创建任何键** |
| 09-8 | 跑完整流程后不越权 | 导入/应用/删除/恢复全走一遍 | 没有出现 8 个键以外的 `theme-gallery`/`skin-gallery`/`dsh-appearance` 前缀新键 |
| 09-9 | 跑完流程键数 | 同上 | 总键数 ≤ 8 |
| 09-10 | 隐私模式：读不了 | getItem 抛异常 | 启动不报错 |
| 09-11 | 读不了就用默认 | 同上 | 回落 jade |
| 09-12 | 配额满：写不进 | setItem 抛异常 | 应用主题不报错 |
| 09-13 | 写不进但当场生效 | 同上 | 页面上主题确实变了（只是刷新会丢） |
| 09-14 | 写不进时导入 | 同上 | 不报错，只是不持久化 |
| 09-15 | 写不进时应用皮肤 | 同上 | 不报错，皮肤生效 |
| 09-16 | 写不进时恢复默认 | removeItem 抛异常 | 不报错 |
| 09-17 | storage 全废时停用插件 | 全面失效 | 不报错 |
| 09-18 | registry 被外部写坏 | 皮肤 registry 不是 JSON | 读作空列表 |
| 09-19 | 坏数据不炸启动 | 同上 | 启动不报错 |
| 09-20 | 坏数据不被删 | 同上 | **不主动 removeItem**，用户数据原样留着（留待人工救） |
| 09-21 | 主题 registry 坏 | 同上 | 读作空列表 |
| 09-22 | 坏 registry + applied 悬空 | 两者叠加 | 生效外观回落 jade，摘要与眼睛一致 |
| 09-23 | items 不是数组 | 合法 JSON 但形状错 | 读作空列表 |
| 09-24 | registry 是数组 | `[1,2,3]` | 读作空列表 |
| 09-25 | applied 皮肤悬空 | 指向已不存在的 id | 启动不激活任何皮肤，不报错 |
| 09-26 | 坏了还能自愈 | 坏 registry 后导入新项 | 导入成功，registry 变回合法结构 |

## 九、主题↔皮肤软互斥（10-track-mutex，25 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 10-1~2 | 合法值 | `theme` / `skin` | 原样读出 |
| 10-3 | 值被写脏 | `both` | 读作空（不崩、不纠正） |
| 10-4 | 大写 | `THEME` | 读作空 |
| 10-5 | 被写成 JSON | `{"track":"theme"}` | 读作空 |
| 10-6 | 键不存在 | 全新用户 | 读作空 |
| 10-7 | 写空值 | 写 `''` | 走 removeItem（键消失，不是留个空串） |
| 10-8~11 | 写 `theme` 的 4 个时机 | 应用内置主题 / 应用自定义主题 / 删掉正在用的主题 / 恢复默认主题 | 每次 track 都变 `theme` |
| 10-12~15 | 写 `skin` 的 4 个时机 | 应用内置皮肤 / 应用自定义皮肤 / 删掉正在用的皮肤 / 恢复默认外观 | 每次 track 都变 `skin` |
| 10-16 | 试穿主题不写键 | 试穿 | track 保持原值 |
| 10-17 | 试穿内置皮肤不写键 | 试穿 | track 保持原值 |
| 10-18 | 试穿自定义皮肤不写键 | 试穿 | track 保持原值 |
| 10-19 | 试穿不创建键 | 键本来不存在 | 试穿后键仍不存在 |
| 10-20 | 启动恢复不写键 | 预置 track=skin 启动 | track 值不被改写 |
| 10-21 | 对侧已激活时不抢 | track=skin 且主题也有值 | 启动后 track 还是 skin |
| 10-22 | 应用主题不卸皮肤 | 皮肤生效中应用主题 | 皮肤仍在（软互斥：不主动抢占对侧） |
| 10-23 | 应用皮肤不清主题键 | 皮肤应用后 | 主题轨的键完好 |
| 10-24 | 应用主题不清皮肤键 | 主题应用后 | 皮肤轨的键完好 |
| 10-25 | track 与实际不一致 | track=theme 但皮肤在生效 | **不做纠正写入**（读到不一致不许顺手改） |

## 十、重复操作与并发（11-concurrency-idempotence，22 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 11-1 | 快速连点两个皮肤 | 并发应用 qq98 + miku | body 上只剩一套皮肤属性 |
| 11-2 | 连点后状态自洽 | 同上 | body 上的皮肤 = `skin-gallery-skin-v1` 的值 |
| 11-3 | 连点后样式不叠 | 并发 xp + trading | 皮肤 style 只有 1 个 |
| 11-4 | 被忽略的那次不报错 | 并发两次 | 两个调用都正常结束（不排队、不抛错） |
| 11-5 | 并发同一个皮肤 | 并发 qq98 × 2 | 脚本只注入 1 次 |
| 11-6 | 顺序重复点「应用」 | 先后点两次 qq98 | 脚本只注入 1 次（不重复注入） |
| 11-7 | 并发试穿 + 应用 | 同时来 | 只有一个生效 |
| 11-8 | 并发内置 + 自定义 | 同时来 | 只有一套生效 |
| 11-9 | 并发三个皮肤 | 同时来 | applied 键与 body 一致 |
| 11-10 | 重复应用同一主题 | 点两次 | storage 结果与点一次相同 |
| 11-11 | 重复应用同一皮肤 | 点两次 | storage 结果相同 |
| 11-12 | 重复应用不叠加 | 点两次 | body 属性与 style 都只有一套 |
| 11-13 | 重复导入同 id 主题 | 导两次 | 列表仍 1 项 |
| 11-14 | 重复导入同 id 皮肤 | 导两次 | 列表仍 1 项 |
| 11-15 | 并发导入同 id 皮肤 | 同时导两次 | 列表不出现重复项 |
| 11-16 | 重复恢复默认主题 | 点两次 | 结果相同 |
| 11-17 | 重复恢复默认外观 | 点两次 | 结果相同 |
| 11-18 | 重复删同一主题 | 删两次 | 第二次静默无事，storage 不变 |
| 11-19 | 重复删同一皮肤 | 删两次 | 第二次静默无事 |
| 11-20 | 重复清空皮肤 | 连点两次 | 不报错 |
| 11-21 | 重复撤销试穿 | 连撤两次 | 不报错，状态不变 |
| 11-22 | 反复开关面板 | 开关两轮 | storage 一个键都没变 |

## 十一、反向用例：不该发生的事没发生（12-negative-invariants，26 条）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 12-1 | 主题导入失败不换肤 | 故意失败 | token 还是原来的 |
| 12-2 | 皮肤导入失败不激活 | 故意失败 | body 干净，无皮肤生效 |
| 12-3 | 皮肤导入失败不加样式 | 故意失败 | style 节点数不变 |
| 12-4 | 连续失败也不写盘 | 连失败 4 次 | 写入次数仍是 0 |
| 12-5 | 删自定义主题不动内置 | 删完看 | 15 个内置主题一个不少 |
| 12-6 | 删自定义皮肤不动内置 | 删完看 | 9 个内置皮肤一个不少 |
| 12-7 | 恢复默认主题不清皮肤库 | 点主题的恢复默认 | 皮肤 registry 原样 |
| 12-8 | 恢复默认外观不清主题库 | 点皮肤的恢复默认 | 主题 registry 原样 |
| 12-9 | 恢复默认主题不清皮肤 applied | 同 12-7 | 皮肤 applied 键还在 |
| 12-10 | 删一个不连带删别的 | 删 b | a 和 c 都在 |
| 12-11 | 试穿皮肤零写入 | 试穿 | 写/删次数都是 0 |
| 12-12 | 试穿主题零写入 | 试穿 | 写/删次数都是 0 |
| 12-13 | 试穿后刷新等于没发生 | 试穿后重新加载 | 回到试穿前已应用的皮肤 |
| 12-14 | 关面板零写入 | 点「返回」 | 写/删次数都是 0 |
| 12-15 | 开面板零写入 | 点入口 | 写/删次数都是 0 |
| 12-16 | 停用插件不删用户内容 | 停用 | 自定义主题与皮肤的 registry 原样 |
| 12-17 | 停用后 body 干净 | 停用 | 没有皮肤属性残留 |
| 12-18 | 停用后 token 撤销 | 停用 | token override 被移除 |
| 12-19 | 缺服务时全线不动 | 宿主不给 theme | 不注册、不注样式、不碰 storage（三项同时验） |
| 12-20 | 引擎为 null 时不写盘 | 打开面板 | storage 不变 |
| 12-21 | 错误文案格式 | 导入坏 JSON | 页面出现 `ERR_IMPORT_INVALID_JSON: …` |
| 12-22 | 错误文案不是注入面 | 用 `ctx.injectMe` 触发报错 | 文案里出现 `injectMe`，且树里**没有** `dangerouslySetInnerHTML`/`innerHTML` 属性 |
| 12-23 | 皮肤名带尖括号 | name = `<img src=x onerror=1>` | 只当文本显示，**不产生 img 节点** |
| 12-24 | 未知内置主题 id 不写键 | 传乱 id | family 键不被创建 |
| 12-25 | 未知皮肤 id 不写键 | 传乱 id | skin-v1 键不被创建 |
| 12-26 | 未知皮肤 id 不执行代码 | 传乱 id | 脚本注入次数 0 |

## 十二、源码与产物静态门禁（13-static-source-gates，45 条 — 全部等 04 落地）

包目录 `packages/appearance-gallery/` 还不存在，这 45 条现在全部 **skip**，目录一出现就自动生效，**不用改测试**。

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 13-1~4 | 槽位注册唯一性 | grep 源码与产物 | src 与 lib/client.js 各命中 `slots.register` 1 次；产物里不出现 `priority`；产物含 id 字面量 |
| 13-5~9 | storage 读写白名单 | grep src 与 skins | 无 `localStorage.clear()`、无枚举 localStorage 的写法、getItem/setItem/removeItem 的 key 字面量全在 8 键之内、9 套内置皮肤里 0 处 storage/cookie、8 个键名都在 src 出现 |
| 13-10~12 | 渲染方式 | grep src | 不出现 `dangerouslySetInnerHTML` / `innerHTML` / `insertAdjacentHTML` |
| 13-13~18 | 对外承诺的 5 组常量 | grep src | 262144 / 8 / 65536 三个数字字面值精确；12 条黑名单齐全**且顺序与 INTERFACE 一致**；四个必填字段名在；ctx 白名单恰好 effect+get |
| 13-19~24 | 模块导出清单 | grep src | acceptance-api 的 5 个导出名；4 个模块各自的导出清单；两个浏览器测试钩子；`__TG_SURFACE__` 的 12 个字段名 |
| 13-25 | 面板不反向依赖 apply 层 | grep panel 文件 | 不出现 `teardownSkins`/`__SKIN_*` 等 apply 层标识符 |
| 13-26~29 | 产物注册壳 | 直接读磁盘上的 lib/client.js | 前 3 行逐字符匹配 + 尾部含 `return module.exports; } });`（**不先跑 build**——70c230d 事故盲区正是没有测试覆盖壳） |
| 13-30~32 | 产物导出与内嵌资源 | 读产物 | `exports.apply`/`exports.inject`；三张皮肤表；9 个皮肤 id 都在 |
| 13-33~35 | 产物文件集合 | 看 lib/ 目录 | 只有 client.js 与 index.js；无 invariant.js；package.json 不再导出 `./invariant` |
| 13-36 | 产物语法 | `node --check` 产物 | 通过（拦住重名 const 造成的 SyntaxError）。**用 --check 而不是 INTERFACE 写的 `new Function(src)`**：同样是只解析不执行，但完全不进入执行路径 |
| 13-37 | 产物体积兜底 | 看文件大小 | ≤ 900KB（不可协商的兜底线） |
| 13-38 | 设计助手文案已更新 | grep src | 无旧仓库路径、无旧验收命令 |
| 13-39 | 旧包已删 | 看 packages/ | theme-gallery / skin-gallery / skin-runtime 三个目录都不在 |
| 13-40 | 轨道键常量 | grep src | 常量名与键名同时存在 |
| 13-41 | 跨平台：路径拼接 | grep 构建脚本 | 不出现 `'/' +`、`__dirname + '/'`、`/Users/`、`/home/` 这类硬编码 |
| 13-42 | 跨平台：不用 mac 专属命令 | grep 构建脚本 | 无 sips/pbcopy/pbpaste/osascript/iconutil/textutil/afconvert/plutil/defaults write |
| 13-43 | 跨平台：不靠 shell 展开 glob | grep 构建脚本 | exec/spawn 的命令串里不带 `*`（Windows cmd 不展开） |
| 13-44 | 跨平台：无盘符/UNC 字面量 | grep src 与 skins | 不出现 `C:\` 或 `\\server` 这类字面量 |
| 13-45 | 模块导出（循环生成 4 条） | 见 13-19~24 | 同上 |

## 十三、性能验收（14-performance-gates，17 条 / 4 条现在能跑）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| P1 | 皮肤源码里的 fixed 背景 | grep skins/**/{client.js,a11y.css} | 命中数 = 0。⚠️ **P1 绿只证明源码里没了，不证明滚动变快** |
| P4a | 全仓 blur 计数 | 静态计数 | `backdrop-filter` ≤ 12（基线 55） |
| P4b | 单皮肤 blur 计数 | 静态计数 | 每套皮肤 ≤ 4（基线 miku 45） |
| P5 | 产物体积 | 看文件 | ≤ 900KB 兜底；**精确阈值 T3.4 落定后补**（现为 skip 占位） |
| P6a | 皮肤侧记忆化 | 连读 10 次 | 只解析 1 次 JSON |
| P6b | 皮肤侧写后失效 | 写完再读两次 | 恰好重新解析 1 次 |
| P6c | 主题侧记忆化 | 连读 10 次 | 只解析 1 次（两侧各一份，防「改一边忘一边」） |
| P6d | 主题侧写后失效 | 写完再读两次 | 恰好重新解析 1 次 |
| P7 | 入口懒挂载 | — | 与 03-6~03-10 同一口径，断言写在那儿，不重复设门禁 |
| P8a | skin.json 数量 | find packages | 恰好 9 条 |
| P8b | skins 目录唯一 | 看它们的父目录 | 只有 1 处（资源不再存两遍） |
| P2 | 应用皮肤后不再 fixed | 真机 | **skip 待接线**；e2e spec 里已有自动化版 |
| P3 | 专用背景层 | 真机 | **skip 待接线**；e2e spec 里已有自动化版 |
| P9 | 归因三组采样 | 真机 `dsh web --port 3199` | **skip / 卡点（T4.3）**：① 无皮肤 ② blue-fantasy ③ blue-fantasy 但把 background-attachment 改 scroll，各采 60 帧 p95。②③ 差值显著才证明 fixed 是主因；治理后 ② 应逼近 ①。**三个数字缺一不算达标** |
| P10 | 点「通用」到可交互 | 真机 performance.mark | **skip 待接线**：与卸载本插件后对比，差值 ≤ T0 基线阈值。这是 BRIEF 用户原话场景，必须给数 |
| P11 | 面板内滚动 | 真机 | **skip 待接线**：面板开 vs 关的 60 帧 p95。这条同时是「不做列表虚拟化」的证据 |

## 十四、Windows 侧边界（15-windows-compat，46 条含 5 跳过）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| 15-1 | 测试自身跨平台 | 检查路径拼接 | 分隔符取自 `path.sep`，无写死斜杠 |
| 15-2~7 | Windows 保留名做 id | `con`/`nul`/`aux`/`prn`/`com1`/`lpt1` | **按 INTERFACE 正则全部合法 → 接受**（契约没把它们列进冲突名单） |
| 15-8 | 保留名做皮肤 id | `nul` | 接受，bodyAttr = `data-dsh-nul` |
| 15-9 | 大写 CON | 主题 id | 被拒（正则不许大写）`ERR_THEME_MISSING_FIELD` |
| 15-10 | 大写 AUX | 皮肤 id | 被拒 `ERR_SKIN_BAD_META` |
| 15-11 | 带扩展名 | `con.txt` | 被拒（点号不在允许字符里） |
| 15-12 | 保留名与目录建议冲突 | — | **skip：需 INTERFACE 补契约**（designSummary 让用户建 `skins/con/` 目录，Windows 建不了） |
| 15-13~28 | Windows 文件名非法字符做 id | `< > : " \| ? *` 和 `\` 各试主题与皮肤 | 16 次全被拒（主题 `ERR_THEME_MISSING_FIELD` / 皮肤 `ERR_SKIN_BAD_META`） |
| 15-29 | 这些字符做 label | 主题 label 含全套 | **接受并原样保留**（INTERFACE 对 label 内容无限制） |
| 15-30 | 这些字符做皮肤名 | `C:\皮肤<测试>\|1` | 接受并原样保留 |
| 15-31 | bodyAttr 含非法属性名字符 | — | **skip：需 INTERFACE 补契约**（`data-x<y="z"` 该拒还是该消毒未定义） |
| 15-32 | CRLF 换行的 client.js | Windows 记事本存的文件 | 导入成功，原文保留 |
| 15-33 | CRLF 不影响黑名单 | CRLF + document.cookie | 照样 `ERR_SKIN_DANGEROUS` |
| 15-34 | CRLF 不影响 ctx 白名单 | CRLF + ctx.nope | 照样 `ERR_SKIN_CONTRACT` |
| 15-35 | CRLF 不影响 @import 拦截 | CRLF a11y | 照样 `ERR_SKIN_DANGEROUS` |
| 15-36 | CRLF 的 \r 也算字节 | 32768 组 CRLF = 65536 字节 | 正好过线 |
| 15-37 | 多一组 CRLF | 65538 字节 | `ERR_SKIN_SIZE` |
| 15-38 | token 值里有 CRLF | 换行不是危险字符 | 接受 |
| 15-39 | 带 BOM 的主题 JSON | 记事本默认存 UTF-8 with BOM | `ERR_IMPORT_INVALID_JSON`（JSON.parse 认不了 BOM） |
| 15-40 | 带 BOM 的 skin.json | 同上 | `ERR_IMPORT_INVALID_JSON` |
| 15-41 | 带 BOM 的 client.js | client 不走 JSON.parse | 导入成功 |
| 15-42 | 是否该剥 BOM | — | **skip：需 INTERFACE 补契约**（Windows 用户会拿到看不懂的 JSON 错） |
| 15-43 | a11y 里的 UNC 路径 | `url(\\\\server\\share\\x.png)` | **skip：需 INTERFACE 补契约**（是远程取资源但不匹配 `http`/`//`，当前契约放行） |
| 15-44 | a11y 里的 file 协议 | `url(file:///C:/x.png)` | **skip：需 INTERFACE 补契约**（当前契约放行） |
| 15-45 | 落盘形态与平台无关 | 导入后查字段 | 11 个字段，无任何平台相关字段 |
| 15-46 | 键名不含路径分隔符 | 跑一轮后查键名 | 无 `/` 也无 `\` |

## 十五、UI 真实流程（e2e/appearance-gallery.spec.mjs，16 条 — 04 后接线跑）

| 编号 | 场景 | 怎么操作 | 预期看到什么 |
|---|---|---|---|
| E-1 | 设置→通用只有一个外观入口 | 打开设置点通用 | appearance-gallery 条目 1 个，旧包两个条目 0 个 |
| E-2 | 默认态是轻量入口 | 不点开 | 有状态摘要，没有「返回」按钮 |
| E-3 | 点开后两区都在 | 点入口 | 「恢复默认外观」与「试穿」都可见 |
| E-4 | 试穿后返回不留痕 | 试穿→返回 | 8 个键与操作前完全相同 |
| E-5 | 应用皮肤写键 | 点「应用」 | skin-v1 非空、track='skin' |
| E-6 | 快速连点两个皮肤 | 并发点两个「应用」 | body 上只有 1 个 `data-dsh-*` 属性 |
| E-7 | 导入坏 JSON | 粘中文点导入 | 页面出现 `ERR_IMPORT_INVALID_JSON: …`，storage 不变 |
| E-8 | 导入皮肤三件套 | 填 3 个 textarea | 新皮肤出现在列表 |
| E-9 | 导入命中黑名单 | client 里放 `fetch(` | 出现 `ERR_SKIN_DANGEROUS: …`，registry 不变 |
| E-10 | 恢复默认外观 | 应用后点恢复 | 两个皮肤 applied 键清空 |
| E-11 | 设计助手联动 | 勾一个版块 | 只读框内容变化，含新仓库路径、不含旧路径 |
| E-12 | 删除需二次确认 | 只勾不确认 | registry 不变 |
| E-13 | 刷新后自动生效 | 应用皮肤后 reload | body 上恰好是那一个皮肤标记（不开面板） |
| E-14 | P2 自动化版 | 应用皮肤后读计算样式 | `backgroundAttachment !== 'fixed'` |
| E-15 | P3 自动化版 | 查 `[data-skin-bg]` | ≤ 1 个，且 fixed + pointer-events:none + 负 z-index |
| E-16 | 旧包在场提示 | 注入 `<style data-skin-gallery>` | 出现冲突提示原文 |

---

## 契约歧义（写测试时发现，需 INTERFACE 定稿，现在按标注处理）

| 编号 | 歧义 | 现在怎么处理 |
|---|---|---|
| A1 | §3.3 T2 说 `activateFamily` 未知 id **静默 no-op**；§3.8 错误表把「内置 activate」列进 `ERR_UNKNOWN_ID` 的触发面 | 按 §3.3 的逐条目表实现断言（静默 no-op）。若定稿改成抛错，04-7/04-8 与 12-24 需同步改 |
| A2 | §3.3 E1 列了三种摘要文案，但「主题永远回落 jade」让「默认外观」不可达（是否用 `touched` 键区分「没碰过的原生 jade」未说） | 03-5 标 skip，不猜 |
| A3 | §3.6 字段规则要求 tokens「非数组」，但校验顺序表没说**非空**数组落第 3 步还是第 7 步 | 05-14 标 skip；空数组按第 3 步断言（`ERR_THEME_MISSING_FIELD`） |
| A4 | 引擎层 unknown-skin 的 message：§3.3 S2 写 `[theme-gallery-skin] unknown-skin: <id>`，§3.8 写 `… <id> (no embedded bundle)` | 只断言两者共有的前缀 |
| A5 | §3.2 皮肤降级文案里 `__DSH_MODULES__` 在 md 里带反引号，实际渲染是否含反引号未定 | 只断言「皮肤轨道不可用：宿主未提供」+「__DSH_MODULES__」两个片段都在 |
| A6 | `family`/`applied` 类键写 `''` 时是 `setItem('')` 还是 `removeItem`（§3.5 只对 track 键明确「写 '' 走 removeItem」，§3.3 T7 只对 touched 明确 removeItem） | 这两处按 removeItem 精确断言；其余键断言「读出来是 ''」，不锁死存储表示 |
| A7 | Windows：保留名 id、bodyAttr 消毒、BOM 剥离、UNC/file 协议 url | 见 15-12 / 15-31 / 15-42 / 15-43 / 15-44，全部标 skip + 「需 INTERFACE 补契约」 |
| A8 | 任务书曾说「主题轨激活时皮肤轨必须让位」，与 §3.5「软互斥、不主动抢占对侧、不因读到对侧值而卸载对侧」冲突 | **按 INTERFACE 实现断言**（10-22：应用主题不卸皮肤）。若产品要「让位」，先改 INTERFACE |

## 覆盖了什么

| 类别 | 条数 |
|---|---|
| 正常路径（BRIEF 每条主路径） | 90 |
| 边界（0/1/空/极值/临界/超长/Unicode） | 41 |
| 错误路径（乱输入、缺参、类型错、依赖不可用、状态损坏） | 140 |
| 反向用例（不该发生的事没发生） | 56 |
| 幂等 / 并发 | 23 |
| 用户没想到的（老用户迁移、emoji、Windows 双平台） | 46 |
| 静态门禁（源码与产物） | 45 |
| 性能门禁 | 17 |
| **node --test 合计** | **458（0 失败，65 跳过）** |
| UI 真实流程（Playwright，只语法检查未真跑） | 16 |

## 没覆盖什么（如实声明）

1. **「变快了」没被证明。** P1/P4/P5 是静态计数，只证明源码里 fixed 背景与 blur 变少了、产物变小了。真正回答用户「滑动不卡」的是 P9/P10/P11 三组真机采样，现在全是 skip。**P1 绿而 P9 没跑 = 不算达标。**
2. **真实浏览器行为一条没跑。** 皮肤 bundle 的真实执行、Blob-URL 注入、a11y `<style>` 真实生效、React hooks 真实行为、宿主槽位真实渲染顺序 —— 全靠 harness 模拟。e2e 16 条只做了语法检查。
3. **harness 不是实现。** 现在全绿只说明「测试自身与契约自洽」。真实实现接进来（`APPEARANCE_SUBJECT=real`）才可能暴露差异；harness 与真实实现有分歧时，**以 INTERFACE 为准**，两边都不算权威。
4. **45 条静态门禁在等包目录。** `packages/appearance-gallery/` 一出现就自动生效；在此之前它们是 skip，**不能当成绿**。
5. **安全闸只测到契约边界。** 12 条黑名单是纯子串匹配的防手滑闸；INTERFACE 已声明未覆盖 `indexedDB`/`new Worker(`/`sendBeacon`/`caches`/`top.location` 与 `window['ev'+'al']` 这类拼接绕过 —— 这些**没测**，因为契约明确不承诺拦得住。别把这批测试全绿读成「导入第三方皮肤是安全的」。
6. **构建脚本本身没跑。** `build`/`check` 的语义（内存串全通过才写盘、check 只读且逐字节比对）只在产物结果上断言，没有验证「失败时 lib/ 不被改」这条过程性保证。
7. **宿主侧槽位遮盖语义没测。** 同 id 同 priority 抛错、不同 priority 时数值最低者渲染 —— 那是宿主的行为，本插件只保证不传 priority（13-3）。
8. **Windows 覆盖情况**：测到的是**输入侧**——保留名/非法字符做 id 与 label、CRLF 换行、BOM、CRLF 的字节计数、产物与源码里无盘符与 UNC 字面量、构建脚本无 POSIX 硬编码与 mac 专属命令、测试自身用 `node:path`。**留给真机的**：Windows 上真的跑一遍 `node --test` 与 `pnpm build`、Windows 浏览器（Edge/Chrome）里的滚动帧率与字体渲染、PowerShell 下的安装命令、以及 A7 那 5 条待补契约的最终行为。

