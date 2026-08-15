// 白盒单测：instructions.ts（lib/instructions.js 真实实现）
//
// 与 tests/acceptance/test-10-discover-pure.test.mjs 的分工：
//   验收测覆盖契约语义的典型路径；本文件补内部逻辑与边界细节——
//   resolveDshHomeLocal 的零参/双空白、findProjectRootSync 的根目录/
//   .git 为符号链接、ancestorChain 的"cwd 不在 root 下"与文件系统根、
//   discoverInstructions 的 displayPath 默认 home/非目录候选/去重 spell、
//   isDiscoveredPath 的相对路径与 `..` 规约。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  resolveDshHomeLocal,
  findProjectRootSync,
  ancestorChain,
  discoverInstructions,
  isDiscoveredPath,
  INSTRUCTION_CANDIDATES,
  LOCAL_INSTRUCTION_CANDIDATES,
  PROJECT_ROOT_MARKERS,
  MAX_SOURCE_BYTES,
} from '../../lib/instructions.js'
import { buildTree } from '../acceptance/helpers/scenarios.mjs'

test.describe('instructions.unit', () => {
  test.describe('resolveDshHomeLocal', () => {
    test('零参调用回退默认 ~/.dsh 并 path.resolve', () => {
      assert.equal(resolveDshHomeLocal(), resolve(homedir(), '.dsh'))
      assert.equal(resolveDshHomeLocal(undefined, undefined), resolve(homedir(), '.dsh'))
    })

    test('configured 与 env 同时空白 → 回退默认', () => {
      assert.equal(resolveDshHomeLocal('   ', { DSH_HOME: '' }), resolve(homedir(), '.dsh'))
      assert.equal(resolveDshHomeLocal('', { DSH_HOME: '\t\n' }), resolve(homedir(), '.dsh'))
    })

    test('configured 优先于 env；相对路径被 resolve 为绝对', () => {
      assert.equal(resolveDshHomeLocal('rel/home', { DSH_HOME: '/env' }), resolve('rel/home'))
      assert.equal(resolveDshHomeLocal('/cfg', { DSH_HOME: '/env' }), '/cfg')
      assert.equal(resolveDshHomeLocal(undefined, { DSH_HOME: 'envrel' }), resolve('envrel'))
    })
  })

  test.describe('findProjectRootSync', () => {
    test('cwd 与项目根重合、.git 是目录', () => {
      const tree = buildTree()
      try {
        assert.equal(findProjectRootSync(tree.project), tree.project)
      } finally {
        tree.cleanup()
      }
    })

    test('向上越过 .git 标记子目录：深层 cwd 冒泡到最近含 .git 祖先', () => {
      const tree = buildTree()
      try {
        assert.equal(findProjectRootSync(join(tree.nested, 'deep', 'deeper')), tree.project)
      } finally {
        tree.cleanup()
      }
    })

    test('.git 是一个指向别处的符号链接也算命中（lstat 存在即算）', () => {
      const tree = buildTree()
      try {
        rmSync(join(tree.project, '.git'), { recursive: true })
        const target = join(tree.path('git-target'), 'gitrepo')
        mkdirSync(target, { recursive: true })
        symlinkSync(target, join(tree.project, '.git'), 'dir')
        assert.equal(findProjectRootSync(tree.nested), tree.project)
      } finally {
        tree.cleanup()
      }
    })

    test('从文件系统根开始冒泡不越界：cwd=/ 返回 /（不死循环）', () => {
      assert.equal(findProjectRootSync('/'), resolve('/'))
    })

    test('路径含尾斜杠仍正确 resolve', () => {
      const tree = buildTree()
      try {
        assert.equal(findProjectRootSync(tree.project + '/'), tree.project)
      } finally {
        tree.cleanup()
      }
    })
  })

  test.describe('ancestorChain', () => {
    test('root 恰为 cwd 的祖父之上：含两端且由宽到窄', () => {
      const tree = buildTree()
      try {
        // tree.path('') 即临时根，是 project 的真实父级（ancestorChain 走 dirname 链）
        const g = tree.path('')
        assert.deepEqual(ancestorChain(g, tree.nested), [g, tree.project, tree.sub, tree.nested])
      } finally {
        tree.cleanup()
      }
    })

    test('cwd 不在 root 之下：从 cwd 冒到文件系统根且不含 root，由宽到窄', () => {
      const r = ancestorChain('/a/root', '/b/c/d')
      // root(/a/root) 不是 /b/c/d 的祖先，链靠 dirname 一路到文件系统根 '/'
      assert.deepEqual(r, [resolve('/'), resolve('/b'), resolve('/b/c'), resolve('/b/c/d')])
      assert.equal(r[0], resolve('/'))
      assert.equal(r[r.length - 1], resolve('/b/c/d'))
    })

    test('root 与 cwd 相同 → 单元素链', () => {
      assert.deepEqual(ancestorChain('/x', '/x').map((p) => resolve(p)), [resolve('/x')])
    })

    test('cwd 为不存在路径仍返回 resolve 后的链（不抛）', () => {
      assert.doesNotThrow(() => ancestorChain('/root', '/dead/bean'))
    })
  })

  test.describe('discoverInstructions', () => {
    test('默认 dshHome（~/.dsh）时全局文件 displayPath 为 ~/.dsh/AGENTS.md', () => {
      const tree = buildTree()
      try {
        writeFileSync(join(homedir(), '.dsh', 'AGENTS.md'), 'g', 'utf8')
        const d = discoverInstructions({ cwd: tree.project }) // 不传 dshHome → 默认
        const g = d.files.find((f) => f.level === 'global')
        try {
          assert.ok(g, '默认 home 下有 ~/.dsh/AGENTS.md 时应发现全局文件')
          assert.equal(g.displayPath, '~/.dsh/AGENTS.md')
        } finally {
          rmSync(join(homedir(), '.dsh', 'AGENTS.md'), { force: true })
        }
      } finally {
        tree.cleanup()
      }
    })

    test('非默认 home displayPath 为 $DSH_HOME/AGENTS.md', () => {
      const tree = buildTree()
      try {
        writeFileSync(join(tree.home, 'AGENTS.md'), 'g', 'utf8')
        const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
        const g = d.files.find((f) => f.level === 'global')
        assert.equal(g.displayPath, '$DSH_HOME/AGENTS.md')
      } finally {
        tree.cleanup()
      }
    })

    test('项目内 displayPath 是相对 projectRoot 的路径（含子目录）', () => {
      const tree = buildTree()
      try {
        tree.write('sub/nested/CLAUDE.md', 'x')
        const d = discoverInstructions({ cwd: tree.nested, dshHome: tree.home })
        const f = d.files.find((x) => x.name === 'CLAUDE.md')
        assert.equal(f.displayPath, 'sub/nested/CLAUDE.md')
        assert.equal(f.level, 'project')
      } finally {
        tree.cleanup()
      }
    })

    test('同名文件以不同 spell 传入 cwd 去重（resolve 归一）', () => {
      const tree = buildTree()
      try {
        tree.write('AGENTS.md', 'r')
        const d = discoverInstructions({ cwd: tree.project + '/./sub/../', dshHome: tree.home })
        const paths = d.files.map((f) => f.path)
        assert.equal(new Set(paths).size, paths.length)
        assert.equal(paths.filter((p) => p === join(tree.project, 'AGENTS.md')).length, 1)
      } finally {
        tree.cleanup()
      }
    })

    test('候选名是目录（非符号链接）也被收录：lstat 通过，size 为目录大小', () => {
      const tree = buildTree()
      try {
        mkdirSync(join(tree.project, 'CLAUDE.md'), { recursive: true })
        const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
        const f = d.files.find((x) => x.path === join(tree.project, 'CLAUDE.md'))
        assert.ok(f, '目录候选不因 isSymbolicLink=false 被拒收')
        assert.equal(typeof f.sizeBytes, 'number')
      } finally {
        tree.cleanup()
      }
    })

    test('.local.md 为符号链接同样拒收（local 候选也要拒 symlink）', () => {
      const tree = buildTree()
      try {
        const target = join(tree.path('ext'), 'real.md')
        mkdirSync(tree.path('ext'), { recursive: true })
        writeFileSync(target, 'rr', 'utf8')
        symlinkSync(target, join(tree.project, 'AGENTS.local.md'), 'file')
        const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
        assert.equal(d.files.some((f) => f.path === join(tree.project, 'AGENTS.local.md')), false)
      } finally {
        tree.cleanup()
      }
    })

    test('同一目录下常规候选先于 local 候选', () => {
      const tree = buildTree()
      try {
        tree.write('CLAUDE.md', 'c')
        tree.write('AGENTS.md', 'a')
        const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
        const rel = d.files.map((f) => f.name)
        // 常规候选顺序固定 AGENTS.md → CLAUDE.md，再 local
        assert.deepEqual(rel, ['AGENTS.md', 'CLAUDE.md'])
      } finally {
        tree.cleanup()
      }
    })

    test('dshHome 不存在时全局候选 stat 失败被跳过不抛', () => {
      const tree = buildTree()
      try {
        const ghostHome = join(tree.path('no'), 'such', 'home')
        assert.doesNotThrow(() => discoverInstructions({ cwd: tree.project, dshHome: ghostHome }))
        const d = discoverInstructions({ cwd: tree.project, dshHome: ghostHome })
        assert.equal(d.dshHome, ghostHome)
        assert.equal(d.files.some((f) => f.level === 'global'), false)
      } finally {
        tree.cleanup()
      }
    })
  })

  test.describe('isDiscoveredPath', () => {
    test('相对 inputPath 经由 resolve 规约后仍命中绝对集合', () => {
      const tree = buildTree()
      try {
        tree.write('AGENTS.md', 'r')
        const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
        // 相对 cwd 的相对路径应被 resolve 为绝对后仍能命中
        assert.equal(isDiscoveredPath('AGENTS.md', d), false, '相对字符串 resolve 到 /cwd 相对，非项目内')
        assert.equal(isDiscoveredPath(join(tree.project, 'AGENTS.md'), d), true)
      } finally {
        tree.cleanup()
      }
    })

    test('带 .. 的 inputPath 规约后命中；越界仍 false', () => {
      const tree = buildTree()
      try {
        tree.write('AGENTS.md', 'r')
        tree.write('sub/AGENTS.md', 's')
        const d = discoverInstructions({ cwd: tree.sub, dshHome: tree.home })
        // sub/../AGENTS.md → project/AGENTS.md（在 sub 的发现范围内）
        assert.equal(isDiscoveredPath(join(tree.sub, '..', 'AGENTS.md'), d), true)
        assert.equal(isDiscoveredPath('/etc/passwd', d), false)
        assert.equal(isDiscoveredPath('', d), false)
      } finally {
        tree.cleanup()
      }
    })

    test('非符号链接 + 已发现的本地文件命中；符号链接对应路径不命中', () => {
      const tree = buildTree()
      try {
        tree.write('AGENTS.local.md', 'r')
        const d = discoverInstructions({ cwd: tree.project, dshHome: tree.home })
        assert.equal(isDiscoveredPath(join(tree.project, 'AGENTS.local.md'), d), true)
      } finally {
        tree.cleanup()
      }
    })
  })

  test.describe('契约常量', () => {
    test('候选组与上限与契约一致', () => {
      assert.deepEqual([...INSTRUCTION_CANDIDATES], ['AGENTS.md', 'CLAUDE.md'])
      assert.deepEqual([...LOCAL_INSTRUCTION_CANDIDATES], ['AGENTS.local.md', 'CLAUDE.local.md'])
      assert.deepEqual([...PROJECT_ROOT_MARKERS], ['.git'])
      assert.equal(MAX_SOURCE_BYTES, 1048576)
    })
  })
})
