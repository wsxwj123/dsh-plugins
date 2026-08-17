# dsh-session-manager

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 补上会话管理能力：**删除会话**（5 秒可撤销 + 回收站式硬删）和**归档视图**（查看已归档会话 + 取消归档）。纯插件实现，不改官方源码。

## 功能

### 删除会话（5 秒可撤销）

- 悬停会话行，右侧出现删除按钮（SVG 垃圾桶图标，跟随官方悬停显隐）。
- 点击删除 → 会话立即从列表隐藏，顶部弹出撤销条并倒计时 5 秒。
- 5 秒内点「撤销」→ 会话恢复原位，不执行删除。
- 倒计时结束 → 会话文件移入回收站（`~/.dsh/session-manager-trash/`），可恢复。
- AI 正在回复/跑任务的会话：删除时先弹确认「会话正在运行任务，确认删除？」；空闲会话直接删除。
- 支持连续删除多个会话，每个独立撤销条。

### 归档视图

- 侧栏底部「归档」入口，打开归档视图，列出所有已归档会话。
- 每个归档会话可「取消归档」（回正常列表）或「删除」（走同一撤销/回收站流程）。
- 归档视图页脚「清空回收站」：永久删除回收站中的会话（二次确认，不可撤销）。
- 点击空白处自动收起归档视图。

## 安装

插件装进 DSH 的 **web profile**（`dsh web` 对应 `web` profile）：

```bash
# 从全家桶 monorepo 克隆后，先构建（lib/ 不入库），再用 link 方式装
cd dsh-plugins
pnpm install          # 装依赖
node build.mjs        # 或 pnpm -r build：生成 packages/dsh-session-manager/lib/
dsh plugin --profile web add "link:$PWD/packages/dsh-session-manager"
```

装完重启 `dsh web`，刷新当前 URL 即可看到侧栏「归档」入口和会话行的删除按钮。

> 装完务必检查 `~/.dsh/profiles/web/node_modules/@deepseek-ai/` 是否被 pnpm 复制成物理目录（会导致核心包 Symbol 分裂、所有工具调用报错）。若是真目录，`mv` 走它让插件回退到 fallback symlink，再重启。详见 [deepseek-harness discussion #783](https://github.com/deepseek-ai/deepseek-harness/discussions/783)。

## 工作原理

- **双端插件**：client（浏览器 React，DOM 注入删除按钮/撤销条/归档视图）+ node（host 侧 cordis 插件，`/sm/*` HTTP 路由 + 文件移动 + 归档域写入）。
- **删除 = 延迟提交**：点击后先本地隐藏 + 倒计时，倒计时结束才调 `/sm/delete` 把会话目录移入回收站。撤销窗口内存活在模块作用域，不随面板切换丢失；刷新页面只丢内存队列、不真删（数据安全）。
- **路径解析**：host 用 live Session 的 `header.cwd`（权威元数据）做 `projectKey`/`encodeSegment` 编码定位会话目录，不依赖客户端快照里可能缺失的 cwd。
- **信任边界**：`/sm/*` 路由挂载带 loopback 信任 fence（非本机 Host / 跨源 / 非同源 Origin 一律 403）；清空回收站需 `confirm:true`。

## 边界与已知限制

- 删除只把会话目录移入回收站（软删除），不立即销毁磁盘内容；「清空回收站」才是不可撤销的硬删。
- 回收站**不会自动过期清理**：`/sm/trash` 给出 `deletedAt`（真实删除时间）与
  `deadline = deletedAt + 30 天`，`deadline` 只是"可以考虑清理了"的参考值，到点不会
  自动删任何东西——自动销毁会话数据正是回收站要消除的风险。清理入口只有用户手动
  「清空回收站」（或单条「恢复」）。
- 会话文件移走后，host 的会话注册表不会自动移除该条目——插件在 client 侧用 localStorage 持久化"已删除 id"保持列表隐藏；host 重启后重新扫描磁盘，会话彻底消失。
- macOS 优先；Windows 路径语义（盘符/UNC/保留设备名/大小写不敏感）已在代码里做判定，但未在 Windows 真机跑过全套测试。
- 归档/取消归档复用 DSH 官方的 archive set 机制。
- **「取消归档」当场生效、刷新可能回滚（已知限制）**：DSH 没有对外暴露 unarchive
  接口，插件只能直接写 `workspace` 存储域。而官方 `dsh-workspace` 的归档集是
  启动时读一次的内存缓存、且不监听域变更，所以：活着的页面会即时更新（apiproxy
  监听 `domain/changed`），**刷新页面或下一次官方归档写入会把该会话又标回已归档**。
  磁盘上的域文件是正确的——重启 `dsh web` 后以磁盘为准。要彻底修需要上游提供
  unarchive API 或让 `dsh-workspace` 监听域变更。

## License

MIT
