# dsh-appearance-gallery

DeepSeek Harness Web GUI 的外观画廊插件：**15 个主题家族 + 9 个完整 dsh-web-ui 皮肤复刻**，合并在一个插件里，设置 → 通用下只占一个入口。

由原 `dsh-theme-gallery`、`dsh-skin-gallery`、`dsh-skin-runtime` 三个插件合并而来。已装旧插件的用户请先卸载，迁移命令见[仓库根 README](../../README.md#从旧版本升级装过主题画廊--皮肤画廊的看这里)。**升级不丢设置**：storage 键完全沿用旧键。

## 安装

```bash
dsh plugin --profile web add "link:$PWD/packages/dsh-appearance-gallery"
```

Windows（PowerShell）：

```powershell
dsh plugin --profile web add "link:$PWD\packages\dsh-appearance-gallery"
```

装完重启 `dsh web` 并刷新页面。

## 功能

- **主题**：15 个主题家族（翠玉、陶土、余烬、星夜、蔷薇雾、紫晶、琥珀旧梦、墨川、苔境、日蚀、天际、晴蓝、黑白界、粉霞、紫雾）。只选家族，浅色/深色/跟随系统仍归 DSH 自带的"外观"设置管。
- **皮肤**：9 款 dsh-web-ui 皮肤复刻，支持试穿与应用。**复刻程度不一**：初音未来 / 同花顺 / QQ2008 怀旧版 / Windows XP 为完整界面复刻（含控件与标题栏细节），Minecraft 次之，交易终端 / 蓝色幻想 / 龙的传人 / 鲸吟 以配色为主、界面结构基本保持 DSH 原样。程度沿用上游原包，本插件未做增删。
- **自定义主题**：JSON 导入，只注入 CSS 变量，不执行任何 JS。
- **自定义皮肤**：三文件受控导入（`skin.json` / `client.js` / 可选 `a11y.css`），带高危能力黑名单、256KB 体积上限、最多 8 个。
- **软互斥**：主题轨与皮肤轨经共享键 `dsh-appearance-track-v1` 互斥，同一时刻至多一个轨激活外观。

契约细节、状态机与完整错误码表见[仓库根 README](../../README.md)。

## 结构与构建

```text
src/         # 源码（apply 层 client.js + 两个面板工厂 + 状态机模块）
skins/       # 9 套皮肤资源（每套 skin.json / client.js / a11y.css）
lib/         # 构建产物，勿手工编辑
build.mjs    # 唯一构建入口
```

```bash
node build.mjs          # 生成 lib/client.js
node build.mjs --check  # 只读校验：注册壳、体积上限、皮肤资源完整性
```

`lib/client.js` **不可手工编辑**：DSH 要求 bundle 执行后自行调用 `window.__ModuleLoader__.load(...)` 注册自己，这层壳只存在于构建产物中，手工改动会在下次构建时丢失或破坏注册。`--check` 是只读检查，可直接进 CI。

## 性能说明

设置页与会话页滚动在本机实测为满帧（帧间隔 p95 ≈ 17ms）。皮肤资源做过三项治理：模糊滤镜从 55 处降到 10 处（单皮肤 ≤4）、4 张大图重编码为 WebP（815KB → 341KB）、移除 `background-attachment: fixed`。其中模糊滤镜是实测中唯一能显著拖慢滚动的因素；移除固定背景经对照采样确认无性能收益，仅作代码卫生保留。

## 许可证

MIT。皮肤复刻的著作权与许可归各自作者，详见 `skins/NOTICE.md` 与各皮肤目录内的 `LICENSE`。
