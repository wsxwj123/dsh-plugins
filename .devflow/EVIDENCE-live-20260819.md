# 真机验收证据 — appearance-gallery（2026-08-19）

采集者：部署采证子代理。机器：macOS Darwin 24.6.0 / Apple Silicon。
被测：`packages/appearance-gallery`（分支 `feature/theme-skin-custom-system`）。
隔离实例：`dsh web --port 3199`，profile = `~/.dsh/profiles/web`。

> 口径声明：本文件只记录**命令原文 + 输出原文 + 观察到的数字**，不下结论。
> 帧率标注仅按预设阈值机械标注：p95 帧间隔 ≤33ms 记「不卡」，33–50ms 记「轻微」，>50ms 记「卡」。

---

## 一、换装记录

### 1.1 先查清 `dsh plugin` 的真实子命令（此前未验证过，不猜）

```
$ dsh plugin --help
error: required option '--profile <name>' not specified

$ dsh --help
Commands:
  web [options] [args...]     boot the web profile (alias of --profile web); the
                              web app's own flags follow
  plugin [options] [args...]  manage a profile's plugins by forwarding the
                              remaining arguments to pnpm in the profile
                              directory
Examples:
  dsh plugin --profile tui add <package>     install a plugin into the tui profile

$ dsh plugin --profile web --help
Version 10.6.5 (compiled to binary; bundled Node.js v25.9.0)
Usage: pnpm [command] [flags]
...
  rm, remove               Removes packages from node_modules and from the
                           project's package.json
  ls, list                 Print all the versions of packages that are
                           installed, ...
```

结论（事实层）：`dsh plugin --profile <name> <args>` 就是**把 args 原样转发给 profile 目录下的 pnpm**，
没有自己的 uninstall/list 子命令；卸载 = `remove`，列表 = `list`。

实现源码佐证 `/Users/wsxwj/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js`：
pnpm 跑完且 exit 0 时调 `reconcilePlugins()`，按**安装后的真实状态**增删 `package.json` 的
`dsh.profile.bundles`（依赖解析到声明了 `dsh.bundle` 的包就入栈，移除的就出栈）。所以 `remove` / `add`
会自动维护 bundles 列表，无需手改 package.json。

### 1.2 换装前状态

```
$ dsh plugin --profile web list --depth 0
dsh-profile-web /Users/wsxwj/.dsh/profiles/web (PRIVATE)
dependencies:
@dsh-external/dsh-automation 0.1.6
@liustack/modlens 3.11.0
@omdsh-dev/dsh-genui 0.8.6
dsh-at-file 0.6.2
dsh-better-sidebar 0.10.3
dsh-composer-tools link:../../../Desktop/app/dsh-plugins/packages/dsh-composer-tools
dsh-find-plugin 0.3.5
dsh-pet-bridge link:../../../Desktop/claude/dsh-plugins/packages/pet-bridge
dsh-plugin-manager 0.1.0
dsh-session-manager link:../../../Desktop/app/dsh-plugins/packages/dsh-session-manager
dsh-skin-gallery link:../../../Desktop/app/dsh-plugins-runtime/packages/skin-gallery
dsh-skin-runtime link:../../../Desktop/app/dsh-plugins-runtime/packages/skin-runtime
dsh-theme-gallery link:../../../Desktop/app/dsh-plugins-runtime/packages/theme-gallery
dsh-turn-scrubber link:../../../Desktop/claude/dsh-plugins/packages/turn-scrubber
```

link 目标存在性核查（三个旧包指向已删除目录，确认必须换装）：

```
/Users/wsxwj/Desktop/app/dsh-plugins/packages/dsh-composer-tools : EXISTS
/Users/wsxwj/Desktop/claude/dsh-plugins/packages/pet-bridge : EXISTS
/Users/wsxwj/Desktop/app/dsh-plugins/packages/dsh-session-manager : EXISTS
/Users/wsxwj/Desktop/claude/dsh-plugins/packages/turn-scrubber : EXISTS
/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/theme-gallery : MISSING
/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/skin-gallery : MISSING
/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/skin-runtime : MISSING
```

回滚手段：`~/.dsh/profiles/web/{package.json,pnpm-lock.yaml}` 已复制到本次会话 scratchpad
（`web-package.json.bak` / `web-pnpm-lock.yaml.bak`）。profile 目录不在 git 下，故用副本兜底。

### 1.3 卸载旧三包

```
$ cd ~/.dsh/profiles/web && dsh plugin --profile web remove dsh-theme-gallery dsh-skin-gallery dsh-skin-runtime
...
dependencies:
- dsh-skin-gallery link:/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/skin-gallery
- dsh-skin-runtime link:/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/skin-runtime
- dsh-theme-gallery link:/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/theme-gallery

Packages: +2
++
Progress: resolved 310, reused 1, downloaded 2, added 2, done
Done in 11.4s using pnpm v10.6.5
EXIT=0
```

### 1.4 安装新合并包

```
$ cd ~/.dsh/profiles/web && dsh plugin --profile web add "link:/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/appearance-gallery"
...
dependencies:
+ dsh-appearance-gallery link:/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/appearance-gallery

Already up to date
Progress: resolved 310, reused 3, downloaded 0, added 0, done
Done in 4.4s using pnpm v10.6.5
EXIT=0
```

### 1.5 换装后核对

```
$ ls ~/.dsh/profiles/web/node_modules/@deepseek-ai 2>/dev/null | wc -l
       0

$ node -e "const p=require('/Users/wsxwj/.dsh/profiles/web/package.json');console.log(JSON.stringify(p.dsh.profile.bundles,null,1));console.log('DEP:',p.dependencies['dsh-appearance-gallery'])"
[
 "@deepseek-ai/dsh-base",
 "@deepseek-ai/dsh-web-app",
 "dsh-at-file",
 "@dsh-external/dsh-automation",
 "@liustack/modlens",
 "@omdsh-dev/dsh-genui",
 "dsh-better-sidebar",
 "dsh-turn-scrubber",
 "dsh-find-plugin",
 "dsh-plugin-manager",
 "dsh-pet-bridge",
 "dsh-session-manager",
 "dsh-composer-tools",
 "dsh-appearance-gallery"
]
DEP: link:/Users/wsxwj/Desktop/app/dsh-plugins-runtime/packages/appearance-gallery
```

`pnpm install` 后复查（红线项：profile 下只用 pnpm，绝不 npm install）：

```
$ cd ~/.dsh/profiles/web && pnpm install
Lockfile is up to date, resolution step is skipped
Already up to date
（警告：Ignored build scripts: cloudflared, cpu-features, ssh2 —— 与本次换装无关，是既有依赖）
Done in 318ms using pnpm v10.6.5

$ ls ~/.dsh/profiles/web/node_modules/@deepseek-ai 2>/dev/null | wc -l
       0
$ ls -la ~/.dsh/profiles/web/node_modules/dsh-appearance-gallery
lrwxr-xr-x  dsh-appearance-gallery -> ../../../../Desktop/app/dsh-plugins-runtime/packages/appearance-gallery
```

- 旧三包已从 `dependencies` 和 `dsh.profile.bundles` 双双移除；
- `@deepseek-ai` 副本数 = **0**（换装前、卸载后、安装后、install 后四次均为 0，无框架第二副本 / Symbol 分裂风险）；
- composer-tools / session-manager / pet-bridge / turn-scrubber 四个既有安装未动（对照 1.2 的 link 路径一致）。

---

## 二、启动证据（裁判条件 3）

```
$ cd ~/.dsh/profiles/web && rm -f /tmp/dsh3199.log && (dsh web --port 3199 > /tmp/dsh3199.log 2>&1 & echo $! > /tmp/dsh3199.pid) ; sleep 30
PID=35857

$ wc -l /tmp/dsh3199.log
       1 /tmp/dsh3199.log

$ grep -c "failed to apply loader entry\|failed to import loader entry" /tmp/dsh3199.log
0

$ cat /tmp/dsh3199.log
dsh web: http://127.0.0.1:3199

$ grep -in "error\|warn\|fail" /tmp/dsh3199.log | head -5
（无输出）

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3199/
HTTP 200
$ ps -p 35857 -o pid,stat,command
35857 SN   node /Users/wsxwj/.npm-global/bin/dsh web --port 3199
```

全部采样跑完后复查（服务全程未重启）：`wc -l` 仍为 1，loader 错误计数仍为 **0**。

注：用户自己的常驻 `dsh web`（PID 86970，默认端口）自始至终未被触碰。

---

## 三、subject=real 回显（裁判条件 4）

被测对象接线点 `tests/acceptance/appearance-gallery/helpers/subject.mjs` 头部原文：

```js
// 被测对象接线点。默认跑真实实现（packages/appearance-gallery），
// APPEARANCE_SUBJECT=harness 可切回参考桩对照。断言一行都不用改。
...
export const SUBJECT = process.env.APPEARANCE_SUBJECT || 'real';

const PKG = '../../../../packages/appearance-gallery/src/client.js';
```

关键 import 行（第 123–124 行，真的从被测包里加载）：

```js
  const { applyWith } = await import(PKG);
  const { BUILTIN_SKINS } = await import('../../../../packages/appearance-gallery/src/acceptance-api.mjs');
```

分支选择（第 305–311 行）：`SUBJECT === 'harness'` 才走参考桩，`SUBJECT === 'real'` 走真实实现，其他值抛错。

运行时回显：

```
$ cd /Users/wsxwj/Desktop/app/dsh-plugins-runtime && node -e "import('./tests/acceptance/appearance-gallery/helpers/subject.mjs').then(m=>console.log('SUBJECT =',m.SUBJECT))"
SUBJECT = real
```

验收计数（环境变量未设置，走默认 real）：

```
$ cd /Users/wsxwj/Desktop/app/dsh-plugins-runtime && echo "APPEARANCE_SUBJECT=${APPEARANCE_SUBJECT:-<unset>}" && node --test "tests/acceptance/appearance-gallery/*.test.mjs" 2>&1 | tail -12
APPEARANCE_SUBJECT=<unset>
✔ a11y_websocket协议url抛ERR_SKIN_DANGEROUS (0.0695ms)
✔ a11y_同目录相对路径url仍被允许 (0.076584ms)
✔ 平台无关_导入结果不依赖process.platform (0.699875ms)
✔ 平台无关_storage键名不含路径分隔符 (0.120709ms)
ℹ tests 471
ℹ suites 0
ℹ pass 464
ℹ fail 0
ℹ cancelled 0
ℹ skipped 7
ℹ todo 0
ℹ duration_ms 195.927125
```

**464 pass / 0 fail / 7 skipped，与验收报告一致。**

---

## 四、e2e（裁判条件 5）

### 4.1 运行环境

spec 文件头注释里的接线说明（原文）：

```
// UI 真实流程验收（@playwright/test）。**04 之后接线跑**，现在只做语法检查。
//
// 接线方法：
//   1) pnpm add -D @playwright/test && npx playwright install chromium
//   2) 起隔离实例：dsh web --port 3199
//   3) DSH_E2E_BASE_URL=http://localhost:3199 npx playwright test tests/acceptance/appearance-gallery/e2e
//   4) 若设置页入口按钮的可见文案在实现里定稿，把 ENTRY_BUTTON 的 TODO 换成确切文案
```

本仓与 `/Users/wsxwj/Desktop/app/dsh-plugins` 均未装 `@playwright/test`。为**不改动任何工程的依赖清单**，
在 scratchpad 建了运行目录，spec 逐字复制（`diff` 验证 `SPEC IDENTICAL`），`node_modules` 软链到本机
已有的 `@playwright/test@1.61.1`（`/Users/wsxwj/Desktop/claude/sillytarvern-replica/node_modules`），
浏览器用已缓存的 chromium-1234（headless）。运行目录：
`<scratchpad>/e2e-run/`（原样 spec）与 `<scratchpad>/e2e-run/nav/`（仅改导航的副本，见 4.3）。

### 4.2 原样跑四条（不改一个字）

```
$ cd <scratchpad>/e2e-run && DSH_E2E_BASE_URL=http://127.0.0.1:3199 playwright test \
    -g "设置页通用只出现一个外观入口|刷新页面后不打开面板_已应用皮肤自动生效|应用皮肤后body的backgroundAttachment不是fixed|专用背景层最多1个且带fixed与pointer-events-none与负z-index"

  4 failed
    appearance-gallery.spec.mjs:66:3  › 设置页通用只出现一个外观入口
    appearance-gallery.spec.mjs:185:3 › 刷新页面后不打开面板_已应用皮肤自动生效
    appearance-gallery.spec.mjs:196:3 › 应用皮肤后body的backgroundAttachment不是fixed
    appearance-gallery.spec.mjs:205:3 › 专用背景层最多1个且带fixed与pointer-events-none与负z-index
```

四条**全部倒在同一处**——公共导航 helper 的第 52 行，不是倒在各自的断言上：

```
    Error: locator.click: Test timeout of 30000ms exceeded.
    Call log:
      - waiting for getByRole('tab', { name: /通用|General/ })

      50 |   await page.goto(BASE);
      51 |   await page.getByRole('button', { name: /设置|Settings/ }).click();
    > 52 |   await page.getByRole('tab', { name: /通用|General/ }).click();
```

真实宿主 DOM 探针结果（说明 helper 为何不成立）：

```
settings btn count（首屏 role=button 名含「设置/Settings」）= 0     ← Settings 藏在侧栏里，要先点 "Open sidebar"
roles tab count = 0                                              ← 设置页导航是 <button>，没有 role="tab"
设置弹窗内导航按钮实际是：General / Models / Plugins / Agent presets / File mentions / Side card
```

spec 自己在这两个 helper 上写着 TODO（`宿主导航文案未在 INTERFACE 里钉住 → 用 role，TODO 接线时核对`
和 `TODO(04): 入口按钮文案 INTERFACE 未钉住`），即这两处本就是**待接线的占位**，不是断言。

### 4.3 只改导航、断言逐字不动，再跑 E-13/E-14/E-15

改动范围（`diff` 原文，只有两个 helper，测试体和断言一个字未动）：

```diff
 async function openGeneralSettings(page) {
   await page.goto(BASE);
-  await page.getByRole('button', { name: /设置|Settings/ }).click();
-  await page.getByRole('tab', { name: /通用|General/ }).click();
+  const sb = page.getByRole('button', { name: 'Open sidebar' });
+  if (await sb.count()) await sb.first().click();
+  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
+  await page.getByRole('button', { name: 'General', exact: true }).first().click();
 }

 async function openAppearancePanel(page) {
-  const entry = page.locator('[data-slot-id="appearance-gallery"]');
-  await entry.getByRole('button').first().click();
-  await expect(page.getByRole('button', { name: TXT.back })).toBeVisible();
+  await page.getByRole('button', { name: '打开外观设置' }).first().click();
+  await expect(page.getByRole('button', { name: TXT.back }).first()).toBeVisible();
 }
```

（`.first()` 是被迫加的：面板里同时存在 **3 个**可见文案为「返回」的按钮 —— `src/client.js:386`、
`src/panel-theme.js:136`、`src/panel-skin.js:276` 各一个，不加 `.first()` 会 strict mode violation。）

结果：

```
$ cd <scratchpad>/e2e-run/nav && DSH_E2E_BASE_URL=http://127.0.0.1:3199 playwright test -g "刷新页面后...|应用皮肤后body...|专用背景层..."
Running 3 tests using 1 worker
  ✘  1 刷新页面后不打开面板_已应用皮肤自动生效 (900ms)
  ✓  2 应用皮肤后body的backgroundAttachment不是fixed (854ms)
  ✓  3 专用背景层最多1个且带fixed与pointer-events-none与负z-index (843ms)
  1 failed / 2 passed (3.5s)
```

E-13 失败详情原文：

```
    Error: expect(received).toEqual(expected) // deep equality
    - Expected  - 1
    + Received  + 1
      Array [
    -   "data-dsh-null",
    +   "data-dsh-sidebar-collapsed",
      ]
      > 194 |     expect(attrs).toEqual([`data-dsh-${applied}`]);
```

### 4.4 四条逐条判读（含 E-13 失败根因定位）

| 条目 | 原样跑 | 只修导航后 | 事实 |
|---|---|---|---|
| E-1 设置页通用只出现一个外观入口 | FAIL | 未跑（断言本身依赖未实现属性） | 断言用的 `[data-slot-id="appearance-gallery"]` 在全仓只出现在这个 spec 里；宿主 `@deepseek-ai/dsh`、插件 `packages/appearance-gallery`、`.devflow/INTERFACE*.md` 全部 grep 无此属性。真机 `[data-slot-id]` 任意计数 = 0 |
| E-13 刷新后皮肤自动生效 | FAIL | FAIL | 两个独立的 spec 侧问题，见下 |
| E-14 body 的 backgroundAttachment 不是 fixed | FAIL（倒在导航） | **PASS** | — |
| E-15 专用背景层 ≤1 且 fixed/pointer-events-none/负 z-index | FAIL（倒在导航） | **PASS** | — |

**E-1 的行为等价探针**（不是改断言，是另取一组可观测量，供主会话判断）：

```
[data-slot-id="appearance-gallery"] count = 0      ← spec 选择器，宿主/插件均未实现该属性
[data-slot-id] 任意 count = 0
行为等价：「打开外观设置」入口按钮 count = 1        ← 入口唯一
「精选主题 · 」摘要出现次数 = 1                     ← 摘要唯一
旧包冲突提示可见 = 0
style[data-theme-gallery] count = 0
style[data-skin-gallery] count = 0
```

**E-13 失败根因（两条，都在 spec 侧，产品行为本身正常）**：

1. **读得太早（竞态）**。apply 是异步的（动态 import 皮肤 bundle 后才写 storage），spec 点完
   `应用` 立刻 `readKeys`，读到 `null`，于是期望值算成了字符串 `"data-dsh-null"`。实测时序：

   ```
   keys BEFORE apply:               {"dsh-appearance-track-v1":null,"skin-gallery-skin-v1":null,...}
   keys IMMEDIATELY after click:    {"dsh-appearance-track-v1":null,"skin-gallery-skin-v1":null,...}
   keys 1.5s after click:           {"dsh-appearance-track-v1":"skin","skin-gallery-skin-v1":"qq98",...}
   AFTER RELOAD keys:               {"dsh-appearance-track-v1":"skin","skin-gallery-skin-v1":"qq98",...}
   AFTER RELOAD body attrs:         ["style","data-dsh-retro"]
   ```
   即「刷新后不开面板、皮肤自动生效」这件事**实测是成立的**（reload 后 storage 与 body 属性都还在）。

2. **`data-dsh-` 前缀不是本插件独占**。断言把 body 上所有 `data-dsh-*` 属性视为皮肤属性，但
   `dsh-better-sidebar` 也写 `data-dsh-sidebar-collapsed`（setAttribute 调用栈原文）：

   ```
   {"n":"data-dsh-sidebar-collapsed","v":"",
    "stack":"at Element.setAttribute | at http://127.0.0.1:3199/plugins/dsh-better-sidebar/client.js?rev=b587b6cf61c5:6622:34 | ..."}
   ```

### 4.5 采证途中发现的产品级缺陷（不在任务清单内，但顺手证实了）

**qq98 皮肤写错 body 属性 → 它自己的 CSS 永远匹配不上。**

- `skins/qq98/skin.json`: `"bodyAttr": "data-dsh-qq98"`
- `skins/qq98/client.js` 的 apply(): `body.dataset.dshRetro = "";` → 实际写出 `data-dsh-retro`
- `skins/qq98/client.js` 的样式串与 `a11y.css` 全部 scope 在 `body[data-dsh-qq98]`

九套皮肤逐一交叉核对（json 声明 / 代码实际写的 / CSS 选择器）：

```
blue-fantasy   json=data-dsh-blue-fantasy  dataset=body.dataset.dshBlueFantasy css=body[data-dsh-blue-fantasy]
dragon-heir    json=data-dsh-dragon-heir   dataset=body.dataset.dshDragonHeir  css=body[data-dsh-dragon-heir]
miku           json=data-dsh-miku          dataset=body.dataset.dshMiku        css=body[data-dsh-miku]
minecraft      json=data-dsh-minecraft     dataset=none(用 setAttribute)        css=body[data-dsh-minecraft]
qq98           json=data-dsh-qq98          dataset=body.dataset.dshRetro       css=body[data-dsh-qq98]   ← 唯一不一致
ths            json=data-dsh-ths           dataset=body.dataset.dshThs         css=body[data-dsh-ths]
trading        json=data-dsh-trading       dataset=body.dataset.dshTrading     css=body[data-dsh-trading]
whale-song     json=data-dsh-whale-song    dataset=body.dataset.dshWhaleSong   css=body[data-dsh-whale-song]
xp             json=data-dsh-xp            dataset=body.dataset.dshXp          css=body[data-dsh-xp]
```

连带影响（源码层）：`src/skin-engine.js:231` 卸载时按 `entry.bodyAttr`（= `data-dsh-qq98`）回收属性，
而实际写上去的是 `data-dsh-retro` → 该属性不会被清掉。qq98 的 `order: 1`，是皮肤列表第一张卡，
所以 e2e 里所有 `应用` + `.first()` 的用例都会命中它。

---

## 五、滚动帧率采样（P9 / P10 / P11）

### 5.1 方法与已知局限（先说清，数字才有意义）

- 工具：playwright + 缓存 chromium-1234，**headless**。曾试 headed（真窗口、真 vsync）但该 revision 的
  headed 二进制启动后 DSH 页面布局与 headless 不同（侧栏/会话列表定位不到，`scroller range = 0`），
  为不编数，改用 headless 并**额外加了一组"故意做慢"的灵敏度对照**来证明这套采样测得出卡顿。
- 采样方式：在页面内 `requestAnimationFrame` 循环，每帧把滚动容器 `scrollTop` 推进 12–18px（到底折返），
  记录 60 个帧间隔，取 p95 / 中位数 / 最大值。headless 下 rAF 基线实测锁在 vsync：`16.64, 16.7, 15.7, 17.7, ...`。
- 滚动对象：会话页真实内容容器 `div.wSkVaW_scrollBody`（会话「solar-system插件星球显示问题」，
  可滚动高度 5846px）；P11 用设置弹窗内的 `div.VOzbGW_options`。
- 判读只按预设阈值机械标注，不下结论。

### 5.2 P9 归因三组（+两组补充对照）

皮肤确实生效的凭据（这一轮点中的是「蓝色幻想」卡片，不是列表第一张）：

```
apply clicked card: "蓝色幻想powerdog996（DreamSkin 社区）· dsh-web-u"
storage skin = blue-fantasy
body attrs = ["style","data-dsh-blue-fantasy"]
```

```
=== 采样结果（p95 帧间隔；≤33ms 不卡 / 33-50 轻微 / >50 卡）===
A_无皮肤              p95=  17.1ms  median= 16.7ms  max= 17.60ms  range=5846px  -> 不卡
B_blue-fantasy       p95=  16.8ms  median= 16.7ms  max= 17.60ms  range=5846px  -> 不卡
C_注入fixed(body)     p95=  17.5ms  median= 16.7ms  max= 17.70ms  range=5846px  -> 不卡   ← body 非滚动容器
D_注入scroll(body)    p95=  17.6ms  median= 16.7ms  max= 17.70ms  range=5846px  -> 不卡
C2_注入fixed(滚动容器)  p95=  16.8ms  median= 16.7ms  max= 17.60ms  range=5846px  -> 不卡
E_灵敏度对照_重模糊     p95= 183.4ms  median=100.0ms  max=200.00ms  range=5846px  -> 卡     ← 故意做慢
```

各组构造说明：

- **A**：未应用任何皮肤（storage 三个皮肤键为空）。
- **B**：应用 `blue-fantasy`（当前发布版）。该皮肤 body 规则实测只有
  `body[data-dsh-blue-fantasy]{color:#1d2539;background-color:#e8ecf5}` —— **纯色，无背景图、无 attachment**。
- **C**：在 B 之上注入旧 `skin-gallery` 里唯一那条 fixed 背景（逐字取自
  `/Users/wsxwj/Desktop/app/dsh-plugins/packages/skin-gallery/skins/xp/client.js`）：
  `background-image: radial-gradient(130% 90% at 50% 120%,#4f9e46 0%,#2e6b34 38%,#2e6b3400 70%),linear-gradient(#8fc3f2 0%,#5d9be0 45%,#2c66b8 78%,#1e4f96 100%); background-attachment: fixed`，加在 `body` 上（旧皮肤就是加在 body 上的）。
  运行时确认 `getComputedStyle(document.body).backgroundAttachment = "fixed, fixed"`。
- **D**：同一张背景图，`background-attachment: scroll`（隔离"是不是 fixed 造成的"这一个变量）。
  确认 `= "scroll, scroll"`。
- **C2**（补充）：把同一条 fixed 背景改加到**真正滚动的那个容器**上 —— 因为本应用 `html/body` 根本不滚动，
  滚的是内层 `div.wSkVaW_scrollBody`，所以 body 上的 fixed 背景在滚动时压根不重绘。
- **E**（补充，灵敏度对照）：给滚动容器所有子元素强加 `backdrop-filter: blur(14px) saturate(180%)`。

新旧皮肤包静态计数（解释为什么 C/D 差不多）：

```
$ grep -ho "background-attachment:[a-z]*" <旧 skin-gallery>/skins/*/client.js | sort | uniq -c
   1 background-attachment:fixed          （只有 xp 一套）
$ grep -ho "background-attachment:[a-z]*" <新 appearance-gallery>/skins/*/client.js | sort | uniq -c
（无输出，0 处）
```

### 5.3 P10 点设置 → 通用 到可交互

```
P10_点General到外观入口可交互   53/49/51 ms  (3 次)
P10_对照:点Models到该页可交互   29/45/38 ms  (3 次，宿主自带页做参照)
P10b_点入口到二级面板可交互     50/49/49 ms  (3 次)
```

口径：`Date.now()` 从点击 `General` 起，到 `打开外观设置` 按钮 visible 且 enabled 为止（3 次取样，
每次先切到 `Models` 再切回，避免命中已渲染态）。P10b 是点入口到二级面板里 `恢复默认外观` 可见。

**缺口说明**：TEST-PLAN 的 P10 要求「与**卸载本插件后**对比，差值 ≤ T0 基线阈值」。
卸载基线**未采**——那需要把插件从 profile 摘掉再装回来（第二次换装），风险大于收益，我没有擅自做。
上表的「点 Models」只是同一应用内另一个不含本插件的设置页，属**代用参照**，不是 TEST-PLAN 要求的基线。

### 5.4 P11 面板开/关的设置页滚动

第一轮（viewport 1440×900）：面板关闭时设置页压根不产生滚动条（可滚动高度 0），无法采样；
改用 viewport 1024×420 让两种状态都可滚：

```
viewport 1024x420 | panel CLOSED scroller: "div.VOzbGW_options" range 236
P11_面板关  p95=17.7ms median=16.7ms max=33.3ms  range=236px  -> 不卡
panel OPEN scroller: "div.VOzbGW_options" range 2139
P11_面板开  p95=17.6ms median=16.7ms max=33.36ms range=2139px -> 不卡
cards rendered: 132 buttons in DOM
```

面板展开后 DOM 里有 132 个 button（15 主题 + 9 皮肤及其操作按钮，未做虚拟化），
可滚动高度从 236px 涨到 2139px，p95 帧间隔无变化。

---

## 六、清理

```
$ kill 35857     （3199 实例已停）
```

- 用户常驻的 `dsh web`（PID 86970）全程未动，也未由我重启。
- 本次全部临时文件在会话 scratchpad 下，未写进本仓（本文件除外），未 commit。
- `~/.dsh/profiles/web` 的换装是**持久生效**的：旧三包已卸，`dsh-appearance-gallery` 已装，
  用户下次启动 web profile 即用新包。回滚副本见 1.2。
