// 指令面板两个"新建/编辑 AGENTS.md"入口的纯决策契约（task-10）。
//
// 需求：全局 + 项目级两个入口**始终显示**；目标不存在→「新建」（走 create API），
// 已存在→「编辑」（直接进编辑态，不报 path-exists）；项目根找不到→项目级禁用并
// 说明"当前会话不在项目内"。这里驱动真实实现 lib/instruction-target.js。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeInstructionTarget,
  describeInstructionTargets,
  globalAgentsPath,
  projectRootAgentsPath,
} from './helpers/contractClient.mjs'

const READY = { ready: true, cwd: '/work/project' }

test.describe('instruction-target 路径推导', () => {
  test('projectRootAgentsPath / globalAgentsPath：拼接 AGENTS.md，容忍目录末尾分隔符', () => {
    assert.equal(projectRootAgentsPath('/work/project'), '/work/project/AGENTS.md')
    assert.equal(projectRootAgentsPath('/work/project/'), '/work/project/AGENTS.md')
    assert.equal(globalAgentsPath('/example/dsh-home/.dsh'), '/example/dsh-home/.dsh/AGENTS.md')
    assert.equal(globalAgentsPath('/example/dsh-home/.dsh/'), '/example/dsh-home/.dsh/AGENTS.md')
  })
  test('目录未知/空串 → undefined', () => {
    for (const bad of [undefined, '']) {
      assert.equal(projectRootAgentsPath(bad), undefined)
      assert.equal(globalAgentsPath(bad), undefined)
    }
  })
})

test.describe('两个入口始终有模型（不再依赖 canCreate* 显隐）', () => {
  const meta = {
    dshHome: '/example/dsh-home/.dsh',
    projectRoot: '/work/project',
    projectRootFound: true,
    canCreateRootAgents: false, // 项目根 AGENTS.md 已存在
    canCreateGlobalAgents: false, // 全局 AGENTS.md 已存在
    files: [],
  }

  test('两个入口都返回模型且都可用（文件存在 → 编辑）', () => {
    const t = describeInstructionTargets(meta, READY)
    assert.equal(t.project.disabled, false)
    assert.equal(t.global.disabled, false)
    assert.equal(t.project.action, 'edit')
    assert.equal(t.global.action, 'edit')
    assert.equal(t.project.label, '编辑项目级 AGENTS.md')
    assert.equal(t.global.label, '编辑全局 AGENTS.md')
    assert.equal(t.project.targetPath, '/work/project/AGENTS.md')
    assert.equal(t.global.targetPath, '/example/dsh-home/.dsh/AGENTS.md')
  })

  test('目标不存在（canCreate*=true）→ 新建文案 + create 动作', () => {
    const t = describeInstructionTargets({ ...meta, canCreateRootAgents: true, canCreateGlobalAgents: true }, READY)
    assert.equal(t.project.action, 'create')
    assert.equal(t.global.action, 'create')
    assert.equal(t.project.label, '新建项目级 AGENTS.md')
    assert.equal(t.global.label, '新建全局 AGENTS.md')
  })

  test('tooltip 说明作用范围', () => {
    const t = describeInstructionTargets({ ...meta, canCreateRootAgents: true, canCreateGlobalAgents: true }, READY)
    assert.match(t.project.title, /仅作用于当前项目/)
    assert.match(t.global.title, /对所有会话生效/)
    // 全局创建前有二次确认提示
    assert.match(t.global.title, /二次确认/)
  })

  test('文件已被发现列表列出（即使 canCreate* 未给 false）→ 编辑', () => {
    const t = describeInstructionTargets({
      dshHome: '/example/dsh-home/.dsh',
      projectRoot: '/work/project',
      projectRootFound: true,
      files: [
        { path: '/example/dsh-home/.dsh/AGENTS.md' },
        { path: '/work/project/AGENTS.md' },
      ],
    }, READY)
    assert.equal(t.project.action, 'edit')
    assert.equal(t.global.action, 'edit')
    assert.equal(t.project.exists, true)
    assert.equal(t.global.exists, true)
  })
})

test.describe('禁用规则', () => {
  test('项目根缺失（projectRootFound=false）→ 项目级禁用 + 指定 tooltip；全局仍可用', () => {
    const t = describeInstructionTargets({
      dshHome: '/example/dsh-home/.dsh',
      projectRoot: '/work/project',
      projectRootFound: false,
      canCreateGlobalAgents: true,
    }, READY)
    assert.equal(t.project.disabled, true)
    assert.match(t.project.title, /当前会话不在项目内/)
    assert.equal(t.project.action, 'create')
    assert.equal(t.global.disabled, false)
    assert.equal(t.global.label, '新建全局 AGENTS.md')
  })

  test('项目根找不到时即使 canCreateRootAgents=true 也禁用（避免 create 变成 host 错误）', () => {
    const t = describeInstructionTarget('project', { projectRoot: '/x', projectRootFound: false, canCreateRootAgents: true }, READY)
    assert.equal(t.disabled, true)
  })

  test('无 cwd → 两个都禁用并说明原因', () => {
    const t = describeInstructionTargets({
      dshHome: '/example/dsh-home/.dsh',
      projectRoot: '/work/project',
      projectRootFound: true,
    }, { ready: true, cwd: undefined })
    assert.equal(t.project.disabled, true)
    assert.equal(t.global.disabled, true)
    assert.match(t.project.title, /无当前会话目录/)
    assert.match(t.global.title, /无当前会话目录/)
  })

  test('列表未就绪 → 两个都禁用并说明"加载完成后可用"', () => {
    const t = describeInstructionTargets(null, { ready: false, cwd: '/work/project' })
    assert.equal(t.project.disabled, true)
    assert.equal(t.global.disabled, true)
    assert.match(t.project.title, /加载完成后可用/)
    assert.match(t.global.title, /加载完成后可用/)
  })

  test('dshHome 缺失 → 全局禁用；项目级正常', () => {
    const t = describeInstructionTargets({
      projectRoot: '/work/project',
      projectRootFound: true,
      canCreateRootAgents: true,
    }, READY)
    assert.equal(t.global.disabled, true)
    assert.match(t.global.title, /无法定位全局指令目录/)
    assert.equal(t.project.disabled, false)
  })

  test('禁用态文案仍是"新建…"（不误导为可编辑）', () => {
    const t = describeInstructionTargets(null, { ready: false, cwd: '/work/project' })
    assert.equal(t.project.label, '新建项目级 AGENTS.md')
    assert.equal(t.global.label, '新建全局 AGENTS.md')
  })
})
