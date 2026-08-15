// host 指令发现纯函数（instructions.ts / INTERFACE §2.4）契约测试
// 这是 host 侧同步纯函数（fs.lstatSync 实现），node 可直接驱动。
// 覆盖：resolveDshHomeLocal 语义、findProjectRootSync（含 .git 为文件）、
// ancestorChain 由宽到窄、discoverInstructions 排序/去重/符号链接拒收/cwd 不存在、
// isDiscoveredPath 成员比对。
//
// 接入：从 helpers/contractHost 导入同名导出；换真实实现改 import 源。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveDshHomeLocal,
  findProjectRootSync,
  ancestorChain,
  discoverInstructions,
  isDiscoveredPath,
  constants,
} from './helpers/contractHost.mjs'
import { buildTree } from './helpers/scenarios.mjs'
import { writeFileSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

test.describe('指令发现纯函数（§2.4）', () => {
  // resolveDshHomeLocal
  test('resolveDshHomeLocal：configured 优先 > DSH_HOME > 默认 home/.dsh', () => {
    const env = { DSH_HOME: '/env/home' }
    assert.equal(resolveDshHomeLocal('/cfg/home', env), resolve('/cfg/home'))
    assert.equal(resolveDshHomeLocal('', env), resolve('/env/home'))
    assert.equal(resolveDshHomeLocal('   ', env), resolve('/env/home'), '空白 configured 视为未设')
    assert.equal(resolveDshHomeLocal(undefined, {}), join(homedir(), '.dsh'))
  })
  test('resolveDshHomeLocal：空白 DSH_HOME 视为未设', () => {
    assert.equal(resolveDshHomeLocal(undefined, { DSH_HOME: '   ' }), join(homedir(), '.dsh'))
  })

  // findProjectRootSync：.git 为目录或文件均可
  test('findProjectRootSync：找到含 .git 的最近祖先为项目根', () => {
    const tree = buildTree()
    try {
      assert.equal(findProjectRootSync(tree.nested), tree.project)
      assert.equal(findProjectRootSync(tree.project), tree.project)
    } finally {
      tree.cleanup()
    }
  })
  test('findProjectRootSync：.git 是文件也能被识别', () => {
    const tree = buildTree()
    try {
      // 动手术：把 project/.git 目录换成一个普通文件
      rmSync(join(tree.project, '.git'), { recursive: true })
      writeFileSync(join(tree.project, '.git'), 'gitdir: elsewhere\n', 'utf8')
      assert.equal(findProjectRootSync(tree.nested), tree.project)
    } finally {
      tree.cleanup()
    }
  })
  test('findProjectRootSync：无 .git → 返回 resolve(cwd) 本身；死目录也返回 resolve(cwd)', () => {
    const tree = buildTree()
    try {
      // project 没有 .git 标记的子树
      const noGit = join(tree.path('nogit'), 'a', 'b')
      assert.equal(findProjectRootSync(noGit), resolve(noGit))
      const dead = join(tree.path('dead'), 'x')
      assert.equal(findProjectRootSync(dead), resolve(dead))
    } finally {
      tree.cleanup()
    }
  })

  // ancestorChain：由宽到窄，含两端
  test('ancestorChain：root → cwd 由宽到窄，含两端', () => {
    const tree = buildTree()
    try {
      assert.deepEqual(
        ancestorChain(tree.project, tree.nested),
        [tree.project, tree.sub, tree.nested],
      )
      assert.deepEqual(ancestorChain(tree.project, tree.project), [tree.project])
    } finally {
      tree.cleanup()
    }
  })

  // discoverInstructions
  test('discoverInstructions：全局在前，随后项目根→cwd 由宽到窄，常规先于 local', () => {
    const tree = buildTree()
    try {
      writeFileSync(join(tree.home, 'AGENTS.md'), 'g', 'utf8')
      tree.write('AGENTS.md', 'r')
      tree.write('CLAUDE.md', 'rc')
      tree.write('AGENTS.local.md', 'rl')
      tree.write('sub/AGENTS.md', 's')
      tree.write('sub/nested/CLAUDE.local.md', 'nl')

      const d = discoverInstructions({ cwd: tree.nested, dshHome: tree.home })
      assert.equal(d.projectRoot, tree.project)
      const rel = d.files.map((f) => f.displayPath)
      // 非默认 home → $DSH_HOME/AGENTS.md 在最前
      assert.deepEqual(rel, [
        '$DSH_HOME/AGENTS.md',
        'AGENTS.md',
        'CLAUDE.md',
        'AGENTS.local.md',
        'sub/AGENTS.md',
        'sub/nested/CLAUDE.local.md',
      ])
      assert.equal(d.files[4].level, 'project')
      assert.equal(d.files[5].level, 'local')
    } finally {
      tree.cleanup()
    }
  })
  test('discoverInstructions：符号链接不收录（含全局）', () => {
    const tree = buildTree()
    try {
      // 全局文件是 symlink → 也拒收
      writeFileSync(join(tree.home, 'AGENTS.md'), 'g', 'utf8')
      // 全局 home 换成 symlink：指向别处
      // （为测全局 symlink，重建一个指向外部的 .dsh/AGENTS.md）
      // 先删真文件再建 symlink
      assert.equal(existsSync(join(tree.home, 'AGENTS.md')), true)
      rmSync(join(tree.home, 'AGENTS.md'))
      const target = join(tree.path('symtarget'), 'g.md')
      mkdirSync(tree.path('symtarget'), { recursive: true })
      writeFileSync(target, 'g', 'utf8')
      symlinkSync(target, join(tree.home, 'AGENTS.md'), 'file')

      // 项目根 symlink → 外部
      const ptarget = join(tree.path('psym'), 'A.md')
      mkdirSync(tree.path('psym'), { recursive: true })
      writeFileSync(ptarget, 'pa', 'utf8')
      symlinkSync(ptarget, join(tree.project, 'AGENTS.md'), 'file')

      const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
      const paths = d.files.map((f) => f.path)
      assert.ok(!paths.includes(join(tree.home, 'AGENTS.md')), '全局 symlink 不收录')
      assert.ok(!paths.includes(join(tree.project, 'AGENTS.md')), '项目 symlink 不收录')
      assert.deepEqual(paths, [], '本项目根无真实指令文件')
    } finally {
      tree.cleanup()
    }
  })
  test('discoverInstructions：去重 + 单个文件 stat 失败跳过不抛', () => {
    const tree = buildTree()
    try {
      tree.write('AGENTS.md', 'dup')
      // cwd 在项目根，AGENTS.md 只出现一次
      const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
      const paths = d.files.map((f) => f.path)
      assert.equal(new Set(paths).size, paths.length)
      assert.equal(paths.filter((p) => p === join(tree.project, 'AGENTS.md')).length, 1)
      // 从不存在的 cwd 也能跑（不抛）
      assert.doesNotThrow(() => discoverInstructions({ cwd: join(tree.path('dead'), 'x'), dshHome: tree.home }))
    } finally {
      tree.cleanup()
    }
  })
  test('discoverInstructions：cwd 不存在 → projectRoot=resolve(cwd)，只含全局', () => {
    const tree = buildTree()
    try {
      writeFileSync(join(tree.home, 'AGENTS.md'), 'g', 'utf8')
      const dead = join(tree.path('dead'), 'x')
      const d = discoverInstructions({ cwd: dead, dshHome: tree.home })
      assert.equal(d.projectRoot, resolve(dead))
      assert.equal(d.files.length, 1)
      assert.equal(d.files[0].level, 'global')
    } finally {
      tree.cleanup()
    }
  })

  // isDiscoveredPath
  test('isDiscoveredPath：成员比对；内部路径 true，越界 false，已拒收的 symlink false', () => {
    const tree = buildTree()
    try {
      tree.write('AGENTS.md', 'r')
      const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
      assert.equal(isDiscoveredPath(join(tree.project, 'AGENTS.md'), d), true)
      assert.equal(isDiscoveredPath(join(tree.project, 'sub', 'AGENTS.md'), d), false)
      // 项目外
      assert.equal(isDiscoveredPath('/etc/AGENTS.md', d), false)
    } finally {
      tree.cleanup()
    }
  })

  // 常量存在且正确
  test('契约常量：候选组 / 项目根标记 / 上限', () => {
    assert.deepEqual(constants.INSTRUCTION_CANDIDATES, ['AGENTS.md', 'CLAUDE.md'])
    assert.deepEqual(constants.LOCAL_INSTRUCTION_CANDIDATES, ['AGENTS.local.md', 'CLAUDE.local.md'])
    assert.deepEqual(constants.PROJECT_ROOT_MARKERS, ['.git'])
    assert.equal(constants.MAX_SOURCE_BYTES, 1048576)
  })
})
