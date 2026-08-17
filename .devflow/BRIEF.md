# BRIEF — 外观插件合并（theme + skin → 单一插件）

## 要解决什么

1. theme-gallery（15 主题家族）与 skin-gallery + skin-runtime（9 套完整皮肤）目前是 2~3 个安装单元、设置页两个入口，用户要求合并为**一个插件**：装一次、设置→通用只有一个入口。
2. 设置→通用打开与上下滚动**不卡顿**（用户原话："我打开设置、通用时上下滑动查看时不卡"）。

## 用户已拍板（2026-08-17）

- 形态：设置页一个轻量入口按钮 → 点开二级完整面板（主题区 + 皮肤区）。
- 旧包处置：新建合并包；theme-gallery / skin-gallery / skin-runtime 三个文件夹从 packages/ 删除；README 写迁移命令。
- ⚠️ 拍板背景修正：用户选"入口+二级面板"时，选项描述称"延续已验证的懒加载路线"。事后调研（RESEARCH-merge-baseline.md）证明 **cordis 包级懒加载并不成立**（启用的条目宿主启动即 import，见报告"关键纠正"节）。方案代理必须基于真实机制重新论证形态：入口+二级面板仍可行（React 组件层面的懒渲染/懒挂载不受 cordis 限制），但"不卡"的解法必须对准调研查明的真根因（皮肤 fixed 大图背景 + blur 滤镜、大 base64 资源），不许再押注包级懒加载。若有比已拍板形态更优的方案，在 PLAN 里并列说明，卡点1 时向用户坦白并让用户重新拍板。

## 成功标准

1. 一个包、一次安装（`dsh plugin --profile web add link:...` 一条命令）、设置→通用一个入口。
2. 15 主题 + 9 皮肤 + 主题 JSON 导入 + 皮肤三件套导入 + 试穿/应用/删除/恢复默认 全部功能不丢。
3. 主题↔皮肤软互斥语义（dsh-appearance-track-v1）保留，已应用外观的用户升级后不丢当前选择（storage 键兼容或迁移）。
4. 性能验收（写进测试计划）：设置→通用滚动无可感知卡顿；应用任一皮肤后全页滚动帧率不因 fixed 背景/blur 显著劣化（调研已定位 5 套皮肤 fixed 大图 + miku 45 处 blur 为滚动卡顿主因，必须治理）。
5. `dsh web --port 3199` 隔离实例启动，loader 失败计数 0。

## 硬约束

- lib/client.js 必须带 `__ModuleLoader__.load` 注册壳（≠src），正式构建脚本必须含壳校验（--check）；`pnpm -r build/check` 不得再静默摧毁手工产物（LEARNINGS.md [LRN-20260817]）。
- settings.general.item 槽位遮盖语义：同 id 同优先级=报错，同 id 不同优先级=合法遮盖、数值最低者渲染。
- 不回退 70c230d。
- 1.26MB 皮肤资源目前 src/lib 存两遍、815KB 是 4 张 base64 图（调研第 1 节）——合并方案须给出资源去重与体积治理办法。

## 敏感面声明

- 不新增外部网络请求、不碰密钥。
- 触碰用户浏览器 localStorage 里的外观状态（applied 主题/皮肤、自定义导入内容、track 互斥键）：迁移/兼容策略必须保证不丢用户已导入的自定义主题与皮肤、不越界读写其他键。
- 自定义皮肤导入的既有安全闸（高危 API 黑名单、256KB 限制、author/license 必填）不得放松；外部已交付的 navigation-diary 皮肤包依赖此导入契约，合并后契约不得破坏。

## 现状输入

- 现状调研：.devflow/RESEARCH-merge-baseline.md（505 行，10 节，含体积清单、slot 注册全景、卡顿根因证据、构建链地雷、互斥/导入实现分布、README 待改清单、测试现状——注意 theme scroll 测试已红、build-static 假绿）。
- 基线：feature/theme-skin-custom-system = github/main = 70c230d，无未提交改动。
