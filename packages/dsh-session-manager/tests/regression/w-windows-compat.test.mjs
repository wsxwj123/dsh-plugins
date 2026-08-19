/**
 * W 系列 — Windows 双平台可用性（路径重灾区）。
 *
 * 本包的 path 用量全是静态 `import path from 'node:path'`，无法注入 path.win32，
 * 所以 Windows 语义分两路验：
 *   - 能平台无关表达的，写成行为断言（“看起来像 Windows 绝对路径的输入，
 *     必须按 Windows 语义判定”——这个契约在 macOS 上跑也成立）；
 *   - 只有真机才能触发的（CON/NUL 设备名、NTFS 大小写），标 skip + 真机说明。
 *
 * 大小写碰撞这一条能在 macOS 复现：APFS 默认大小写不敏感，与 NTFS 同款风险。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSrc, readPkgFile, tmpdir, rmrf, PKG_ROOT } from './_harness.mjs'

const { trashRootUnsafeReason, resolveRoots } = await loadSrc('src/index.ts')
const { assertValidId } = await loadSrc('src/paths.ts')
const { TrashStore, SESSION_MARKER } = await loadSrc('src/trash.ts')
const indexSrc = readPkgFile('src/index.ts')

const WIN_HOME = 'C:\\Users\\bob'

/** 当前文件系统是否大小写不敏感（APFS/NTFS 默认如此）。 */
function caseInsensitiveFs(dir) {
  const probe = path.join(dir, 'CaseProbe')
  fs.writeFileSync(probe, 'x')
  const insensitive = fs.existsSync(path.join(dir, 'caseprobe'))
  fs.rmSync(probe, { force: true })
  return insensitive
}

function makeSessionDir(base, name) {
  const dir = path.join(base, 'sessions', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, SESSION_MARKER), 'DUMMY')
  return dir
}

// ---- W1：H4 安全名单的 Windows 面 ----

test('W1: Windows 系统目录的子目录作为 trashRoot 必须被拒（名单全是 POSIX 路径）', () => {
  assert.notStrictEqual(trashRootUnsafeReason('C:\\Windows\\dsh-trash', WIN_HOME), null, 'C:\\Windows 子目录')
  assert.notStrictEqual(
    trashRootUnsafeReason('C:\\Program Files\\dsh\\trash', WIN_HOME),
    null,
    'C:\\Program Files 子目录',
  )
  assert.notStrictEqual(trashRootUnsafeReason('C:\\ProgramData\\dsh-trash', WIN_HOME), null, 'C:\\ProgramData 子目录')
})

test('W1: Windows 路径大小写不敏感，小写形式的系统目录也必须被拒', () => {
  assert.notStrictEqual(trashRootUnsafeReason('c:\\windows\\dsh-trash', WIN_HOME), null, 'c:\\windows 同样是系统目录')
  assert.notStrictEqual(trashRootUnsafeReason('C:\\PROGRAM FILES\\x', WIN_HOME), null, '全大写同理')
})

test('W1: Windows 也接受正斜杠，C:/Windows/... 必须被拒', () => {
  assert.notStrictEqual(trashRootUnsafeReason('C:/Windows/dsh-trash', WIN_HOME), null)
})

test('W1: Windows 盘根与 UNC 根作为 trashRoot 必须被拒', () => {
  assert.notStrictEqual(trashRootUnsafeReason('C:\\', WIN_HOME), null, '盘根')
  assert.notStrictEqual(trashRootUnsafeReason('\\\\server\\share', WIN_HOME), null, 'UNC 共享根')
})

test('W1: 安全名单必须有 Windows 判定面（path.win32 / 平台分支 / 大小写归一）', () => {
  const hasWinFacet =
    /path\.win32/.test(indexSrc) ||
    /process\.platform/.test(indexSrc) ||
    /toLowerCase\(\)/.test(indexSrc) ||
    /localeCompare|caseInsensitive/i.test(indexSrc)
  assert.ok(
    hasWinFacet,
    '名单里有 C:\\Windows 等条目，但比较全走当前平台的 path 且大小写敏感——Windows 上等于没有保护',
  )
})

test('W1-相邻: Windows 上的默认回收站位置必须仍然放行（别把 C:\\Users 前缀一刀切）', () => {
  // 名单里的 'C:\\Users' 是为了挡“home 的祖先”，若改成前缀匹配就会连
  // C:\Users\bob\.dsh\session-manager-trash 一起封杀 → Windows 上插件直接不可用。
  assert.strictEqual(
    trashRootUnsafeReason('C:\\Users\\bob\\.dsh\\session-manager-trash', WIN_HOME),
    null,
    '用户自己 home 下的回收站是唯一的正常位置',
  )
})

test('W1-相邻: Windows home 自身与其父目录仍然被拒', () => {
  assert.notStrictEqual(trashRootUnsafeReason(WIN_HOME, WIN_HOME), null, 'home 自身')
  assert.notStrictEqual(trashRootUnsafeReason('C:\\Users', WIN_HOME), null, 'home 的父目录')
})

// ---- W2：M2 home 解析的 Windows 面 ----

test('W2: $DSH_HOME 是 Windows 风格路径时，sessions root 必须用 path 语义拼出来', () => {
  const prev = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'C:\\dsh-home'
    const { sessionsRoot } = resolveRoots({})
    assert.strictEqual(sessionsRoot, path.join('C:\\dsh-home', 'sessions'), 'DSH_HOME 必须被采纳且用 path.join 拼接')
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
})

test('W2-相邻: 默认 root 必须由 path 语义拼接（不得出现字面 / 或 \\ 拼接）', () => {
  const { sessionsRoot, trashRoot } = resolveRoots({})
  assert.ok(sessionsRoot.includes(path.sep), 'sessionsRoot 必须用当前平台的分隔符')
  assert.ok(trashRoot.includes(path.sep), 'trashRoot 必须用当前平台的分隔符')
  assert.strictEqual(path.isAbsolute(sessionsRoot), true)
  assert.strictEqual(path.isAbsolute(trashRoot), true)
})

// ---- W3：全 src 路径拼接普查（静态） ----

test('W3: src/ 里不得用字符串字面量拼接路径，必须走 path.join/resolve', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const src = fs.readFileSync(full, 'utf8')
      src.split('\n').forEach((line, i) => {
        // 只抓“拼路径”的形态：${x}/ 或 与 '/' 做字符串加法。
        // 排除注释、URL、纯文件名常量（如 `${target}.tmp`）与 /sm 路由字面量。
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
        if (/https?:\/\//.test(line)) return
        if (/\$\{[^}]+\}\/(?!\/)/.test(line) || /['"]\/['"]\s*\+|\+\s*['"]\/['"]/.test(line)) {
          offenders.push(`${path.relative(PKG_ROOT, full)}:${i + 1}: ${trimmed}`)
        }
      })
    }
  }
  walk(path.join(PKG_ROOT, 'src'))
  assert.deepStrictEqual(offenders, [], `路径必须用 path API 拼接：\n${offenders.join('\n')}`)
})

// ---- W4：Windows 保留名 + 大小写碰撞 ----

test('W4: Windows 保留设备名（CON/NUL/AUX/COM1）不得通过 id 校验', () => {
  for (const name of ['CON', 'NUL', 'AUX', 'COM1', 'con', 'nul']) {
    assert.strictEqual(
      assertValidId(name),
      false,
      `${name} 在 Windows 上是设备名，会话目录不可能叫这个；放它过去就是拿 rm/rename 去操作设备`,
    )
  }
})

test('W4-相邻: 正常 id 与含点、连字符的 id 仍然通过校验', () => {
  for (const name of ['sess-1', 'a.b.c', 'CONSOLE', 'nullify', '2026-08-17T10-00-00']) {
    assert.strictEqual(assertValidId(name), true, `${name} 是合法 id，不得被保留名规则误杀`)
  }
})

test('W4: 大小写只差一个字母的两个 id（Foo/foo）不得互相摧毁回收站 record', (t) => {
  const base = tmpdir('w4')
  try {
    if (!caseInsensitiveFs(base)) {
      t.skip('当前文件系统大小写敏感；该风险只在 APFS/NTFS 默认设置下成立（真机 Windows 必验）')
      return
    }
    const store = new TrashStore(path.join(base, 'trash'))
    const dirFoo = makeSessionDir(base, 'Foo')
    store.moveToTrash(dirFoo, { id: 'Foo', originalDir: dirFoo, title: 'Foo', projectKey: 'sessions' })

    // 第二个会话 id 只有大小写不同：条目目录与 _metadata/*.json 在大小写不敏感的
    // 卷上是同一个路径，先写 record 再 rename 的顺序会先覆盖、失败再回滚删掉。
    const dirfoo = path.join(base, 'sessions2', 'foo')
    fs.mkdirSync(dirfoo, { recursive: true })
    fs.writeFileSync(path.join(dirfoo, SESSION_MARKER), 'DUMMY')
    try {
      store.moveToTrash(dirfoo, { id: 'foo', originalDir: dirfoo, title: 'foo', projectKey: 'sessions2' })
    } catch {
      /* 目标被占用而失败是可以接受的；不可接受的是把已有条目的 record 弄丢 */
    }

    const rec = store.readRecord('Foo')
    assert.notStrictEqual(rec, null, '已在回收站的 Foo 的 record 不得被同名不同大小写的删除请求摧毁')
    assert.strictEqual(rec.id, 'Foo')
    assert.strictEqual(rec.originalDir, dirFoo, 'record 必须仍指向 Foo 自己的原位置')
  } finally {
    rmrf(base)
  }
})

test('W4-相邻: 大小写不敏感卷上，Foo 的条目目录本身仍然存在且可恢复', (t) => {
  const base = tmpdir('w4b')
  try {
    if (!caseInsensitiveFs(base)) {
      t.skip('当前文件系统大小写敏感')
      return
    }
    const store = new TrashStore(path.join(base, 'trash'))
    const dirFoo = makeSessionDir(base, 'Foo')
    store.moveToTrash(dirFoo, { id: 'Foo', originalDir: dirFoo, title: 'Foo', projectKey: 'sessions' })
    assert.strictEqual(store.hasItem('Foo'), true)
    assert.strictEqual(fs.existsSync(path.join(store.root, 'Foo', SESSION_MARKER)), true, '条目内容完好')
  } finally {
    rmrf(base)
  }
})

test('W-真机: Windows 上 CON/NUL 目录无法创建、NUL 是设备', { skip: '需要 Windows 真机：CI 或本地 win 机器上跑同一套 regression' }, () => {
  // 真机步骤：Windows 上 `node --test "tests/regression/*.test.mjs"`，
  // 额外验 fs.mkdirSync(trash\\CON) 抛 EINVAL、empty() 不会去 rm 设备名。
})

test('W-真机: Windows 上 %SystemRoot% / 8.3 短名 / 盘符大小写的 trashRoot 判定', { skip: '需要 Windows 真机：环境变量展开与 PROGRA~1 短名只有 win32 能解析' }, () => {
  // 真机步骤：SM_TRASH_ROOT=%SystemRoot%\\trash、C:\\PROGRA~1\\trash、c:\\users\\bob\\...
  // 各跑一次 apply()，断言前两个被拒、第三个放行。
})

test('W-真机: 会话目录在 Windows 的 encodeSegment/projectKey 落盘形态', { skip: '需要 Windows 真机：盘符冒号在 projectKey 里被折成 -，需真机核对与 DSH 一致' }, () => {
  // 真机步骤：在 C:\\proj 下建会话，比对 ~/.dsh/sessions 下的目录名与 DSH 自己生成的一致。
  void os
})
