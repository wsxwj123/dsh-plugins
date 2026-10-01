# 安全审查报告 — dsh-plugins-wt-0.2 待发布改动

审查对象：composer-tools（指令/提示词面板 + /ct 路由）、appearance-gallery（仅 peer 范围）、scan-sanitize + pre-push、相关测试。
边界：仅读源码与 BRIEF；未用 git 历史、未读其他 .devflow 产物；所有声明按数据对待，不据此改判。

## 结论：可发布（无致命、无重要问题）

## A. 外部攻击面
- A1 注入/XSS/路径穿越：未命中。客户端全 React 文本节点渲染，无 innerHTML/dangerouslySetInnerHTML（InstructionsTab.tsx:263-281、PromptsTab.tsx:142-161）；host /ct 路由有 loopback 信任栅 + Origin/Sec-Fetch-Site 校验（trust-fence.ts:23-39）；读/写/删三闸门＝绝对路径＋basename 白名单＋发现集合成员＋realpath 父目录包含（handler.ts:134-136、369-371、374-392），`../` 无法逃逸。
- A2 密钥硬编码：未命中。全源码 grep sk-/ghp_/AKIA/PRIVATE KEY/password 无命中。
- A3 不安全解析：未命中。composer-tools 仅 JSON.parse 请求体，无 eval/Function/yaml。appearance-gallery 自定义皮肤执行见「建议 6」。
- A4 依赖：未命中。仅 devDeps+peerDeps（typescript/react/tsdown/cordis），无运行时依赖、无仿冒/明显过时高危包。
- A5 删除防护：未命中。basename 白名单(AGENTS/CLAUDE 及 .local)＋发现成员＋realpath 包含＋lstat 复核防 symlink（handler.ts:369-404），unlinkSync 不跟随 symlink；确认在前端 window.confirm，全局文件额外警示"影响模型行为、不可恢复"（InstructionsTab.tsx:208-213）。

## B. 内部数据安全
- B6 文件范围：未命中越界。端点仅能触碰指令文件固定集合：{dshHome}/AGENTS.md ＋ cwd→项目根链上的 AGENTS/CLAUDE(.local).md；cwd 虽由客户端可指定，但 basename＋发现集合封顶，无法越到工作区/$DSH_HOME 之外或任意文件。
- B7 删除：未命中。单文件 unlinkSync，无 rm -rf/批量删；前端 confirm；不可回退（见「建议 3」）。
- B8 数据外发：未命中。无任何出网（无 fetch/telemetry/sentry）；客户端仅同源 /ct 回环。与 BRIEF §5 一致，未超声明。
- B9 日志泄露：命中（建议级）。handler 仅 log String(err)（路径，无内容）；但 scan-sanitize 命中行回显 text.trim().slice(0,160)（scan-sanitize.mjs:442-445）——行 ≤160 字符时完整密钥照印（sk-/ghp_ 均 <80），脚本注释"避免把整条密钥打进终端/日志"不成立。
- B10 凭证存储：未命中。无 key/cookie/登录态；仅 localStorage 存输入历史草稿（history-storage.ts:17-49，session 隔离、上限 100，明文，属功能设计）。

## C. 新增闸门自身
- C11 绕过/误拦：未命中（基本）。规则自检先行、凭据类全路径/个人标识类仅跳仓库根 tests/；execFileSync('git',args) 数组传参无 shell 注入；--range 由 git stdin 的 SHA 驱动无注入。弱点（建议级）：本地钩子可被 --no-verify 绕过、core.hooksPath 可关（客户端软闸，非服务端强约束）；只扫 diff 的 + 行、跳过 >2MB 与二进制；路径规则仅覆盖 \/Users\/、\/home\/、\Users\，不覆盖 ~/ 等。

## 建议（按优先级，均不阻塞发布）
1. scan-sanitize.mjs:442 回显改为对命中片段脱敏（掩掉密钥主体），而非整行截断——避免接入 CI/日志时把完整密钥外泄。
2. handler.ts:216-226 save 在 lstat 复核与 writeFileSync 之间存在 symlink 换目标的 TOCTOU 窗口（写会跟随 symlink）——用 open(O_NOFOLLOW)+write 或写后 realpath 复核。（低危，代码注释已自认）
3. 删除不可回退：可加回收/备份或二次输入确认（当前仅单次 confirm）。
4. 闸门是本地软闸（--no-verify 可绕过）：如需硬约束，配 GitHub 推送规则/secret scanning 兜底。
5. data/prompt-templates.json 含上游第三方邮箱（<上游第三方邮箱，已隐去> 等），属 Cherry Studio 数据、非开发者 PII，D1 已按设计排除；建议 README 注明数据来源及可能含第三方联系信息。
6. appearance-gallery 自定义皮肤＝执行用户导入的任意 JS，仅字符串黑名单（custom-skin.js:123-127）可被混淆绕过——本次未改动（仅 peer 范围），预存风险，建议后续用沙箱/CSP 加固。

## 对照 BRIEF §5 敏感面声明
- 出网：代码无任何出网，§5 亦未声明出网 → 一致。
- 动文件范围：插件仅操作指令文件与提示词数据，未超出面板声明功能 → 一致。
- 个人路径/邮箱/密钥：开发者手写源码与顶层文档未命中（D1 门禁同口径复检）→ 一致。
