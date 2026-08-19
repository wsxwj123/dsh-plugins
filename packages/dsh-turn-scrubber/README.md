# dsh-turn-scrubber

<p align="center"><a href="README.en.md">English</a> | 中文</p>

为 DeepSeek Harness Web GUI 设计的 **Codex 风格回合刻度簇**：贴在会话窗口右缘的一簇细横线，垂直居中。每个用户回合一根线——刻度显示**会话的全部回合**（包括未加载进页面的历史回合和被压缩的旧回合）；空闲时所有线统一等长、短小无感；悬停时像波形一样起伏，并把指针附近的线**鱼眼式撑开**（密集会话也能看清、点准）；点击任意一根线平滑滚动到对应回合。

移植自 [claude-gui](https://github.com/wsxwj123/claude-gui) 的 TurnScrubber 思路，按用户偏好重做成线性波形样式。

## 预览

<img src="../../assets/screenshots/turn-scrubber.png" alt="回合刻度实时预览" width="620">

## 行为

- **显示全部回合**：刻度以 host 端 `turnIndex` 端点返回的完整回合索引为骨架，三种状态：
  - **已加载**——波形悬停 + 快照原文 tooltip + 点击平滑滚动；
  - **未加载**（页面还没翻出来的历史）——点击自动连续「加载更早」直到该回合出现再跳转，tooltip 显示 host 端预览；
  - **已压缩**（被 compaction 折叠的旧回合）——灰色占位线，点击滚到「加载更早」按钮附近。
- **空闲态**：统一等长的短刻度（固定 6px），距窗口右缘 6px，暗淡——对话时几乎察觉不到。间距恒定且**始终不超过消息区高度**、垂直居中（回合再多也不会溢出或歪斜）。
- **悬停（鱼眼）**：指针附近的 ±3 根线被撑开（高斯衰减、中心 3 倍），远处的线自动压缩补偿——总高度分毫不变，密集会话依然清晰可点；叠加线的放大效果，指针处呈现平滑的波形。
- **Tooltip**：悬停 220ms 后淡入摘要卡（「回合 N」+ 该回合前 200 字；压缩回合显示提示文案）。
- **点击**：rAF 缓动平滑滚动到该回合的锚点行。
- 刻度簇是固定控件而非迷你地图：不映射消息位置，滚动时保持垂直居中。
- 窄视口（<768px）和少于 2 个回合的会话自动隐藏。
- **优雅降级**：host 索引不可用时（如未配置持久化后端），自动回退为「只看已加载回合」的旧行为，不报错、不打断。

## 工作原理

- **完整索引**：node 半区提供一个只读 RPC 端点（`POST /turn-scrubber/turnIndex`，仅本机 loopback），读取会话完整事件日志——优先 live 会话存储，其次 JSONL 持久化后端——按回合构造 `[{turn, preview, compacted}]`（`turn/start` 事件是回合权威；回合号 1 基；压缩判定用 `compaction/summary.shadowedSeqs`）。client 侧按 `(sessionId, 指纹)` 缓存索引，并核对响应的 sessionId（防会话切换竞态）。
- **未加载导航**：点击未加载刻度走**单飞**加载循环（`ensureTurnLoaded`）——连续翻更早历史直到该回合的 key 出现在已加载窗口（或 `hasMore=false` / 40 页上限 / 会话切换），再平滑滚动。
- **DOM**：轨道挂在 `[data-conversation-scroll]` 滚动容器的父级内，用布局偏移定位（`offsetTop`/`offsetHeight`，对 CSS 缩放免疫）；跳转锚定 DSH 原生 `[data-chat-anchor-key]` 行。
- **滚动**：部分 webview 对程序化 `scrollIntoView({behavior:'smooth'})` 不响应，跳转用手写 rAF 三次缓动。
- **文本**：摘要从字符串、Anthropic 风格内容块数组、结构化对象中安全提取（图片/文件消息不崩溃）；preview 截断 120 字符。

## 安装

克隆仓库后把包装进 DSH Web profile：

```bash
git clone <仓库地址>
cd dsh-plugins
dsh plugin --profile web add "link:$PWD/packages/turn-scrubber"
```

装完后重启现有 `dsh web` 进程并刷新其当前 URL。不要另起第二个替代服务。

> 每次 profile 安装后，检查 `~/.dsh/profiles/web/node_modules/@deepseek-ai` 是否被创建为物理目录。DSH 核心包必须经 profile fallback symlink 解析，以保持 Cordis/Tool Symbol 单例（见 [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)）。

## 构建

```bash
pnpm install          # 在 monorepo 根
pnpm build            # pnpm -r build → packages/turn-scrubber/lib/
```

client bundle 采用官方 DSH client-bundle 预设形态（`window.__ModuleLoader__.load`）、纯度门禁（禁止非平台 `@deepseek-ai` 值导入）、CSS Modules 内联为 `<style data-plugin>` 标签。虚拟 id 为仓库相对路径——构建产物不含任何本机路径。

## 已知边界

- 刻度簇悬浮在消息区右缘留白上（内容列居中时在留白区）；窄窗口下可能与文本重叠。
- 压缩会移除被压缩回合的锚点，对应刻度显示为灰色占位（无法跳转原文）——预期行为。
- 轨道是当前活动会话的覆盖层。
