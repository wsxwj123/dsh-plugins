/**
 * H3 + H4 (高) + L1 (低) — 回收站根的删除门槛与 root 安全校验。
 *
 * H3: empty() 的“只删可识别的回收站条目”只挡分隔符/控制字符/`%`/`_metadata`，
 *     普通文件名（.DS_Store、任意用户文件与目录）全部通过 → rm -rf。
 * H4: trashRoot 安全名单只做全等比较（`/etc/x`、`/usr/local/lib` 一律放行），
 *     且 resolveRoots 后从不 realpath（symlink 绕过所有边界检查）。
 * L1: moveToTrash 的 rename 失败回滚会删掉同 id 的既有 record，老条目变孤儿。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSrc, tmpdir, rmrf, makeCtx } from './_harness.mjs'

const { TrashStore, SESSION_MARKER } = await loadSrc('src/trash.ts')
const { trashRootUnsafeReason, apply } = await loadSrc('src/index.ts')

/** A session dir with the real marker inside, ready to be moved. */
function makeSessionDir(base, id) {
  const dir = path.join(base, 'sessions', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, SESSION_MARKER), 'DUMMY')
  return dir
}

// ---- H3 ----

test('H3: empty() 不得删除回收站根下的普通用户文件', () => {
  const base = tmpdir('h3')
  try {
    const store = new TrashStore(path.join(base, 'trash'))
    const src = makeSessionDir(base, 'real1')
    store.moveToTrash(src, { id: 'real1', originalDir: src, title: null, projectKey: 'sessions' })
    fs.writeFileSync(path.join(store.root, '.DS_Store'), 'x')
    fs.writeFileSync(path.join(store.root, 'notes.txt'), 'user data')

    assert.deepStrictEqual(store.empty(), [], '清空本身不应报错')
    assert.strictEqual(fs.existsSync(path.join(store.root, '.DS_Store')), true, '.DS_Store 不是回收站条目，不得删除')
    assert.strictEqual(fs.existsSync(path.join(store.root, 'notes.txt')), true, '用户文件不得删除')
  } finally {
    rmrf(base)
  }
})

test('H3: empty() 不得递归删除回收站根下无 record、无 session marker 的目录', () => {
  const base = tmpdir('h3b')
  try {
    const store = new TrashStore(path.join(base, 'trash'))
    const photos = path.join(store.root, 'my-photos')
    fs.mkdirSync(photos, { recursive: true })
    fs.writeFileSync(path.join(photos, 'a.jpg'), 'binary')

    assert.deepStrictEqual(store.empty(), [])
    assert.strictEqual(fs.existsSync(photos), true, '既无 record 又无 session marker 的目录不是回收站条目')
    assert.strictEqual(fs.existsSync(path.join(photos, 'a.jpg')), true, '目录内容更不该被 rm -rf')
  } finally {
    rmrf(base)
  }
})

test('H3-相邻: 有 record 的真条目仍然被 empty() 删除', () => {
  const base = tmpdir('h3c')
  try {
    const store = new TrashStore(path.join(base, 'trash'))
    const src = makeSessionDir(base, 'real2')
    store.moveToTrash(src, { id: 'real2', originalDir: src, title: null, projectKey: 'sessions' })
    assert.deepStrictEqual(store.empty(), [])
    assert.strictEqual(fs.existsSync(path.join(store.root, 'real2')), false, '真条目必须被清掉')
    assert.strictEqual(store.hasRecord('real2'), false, 'record 一起清掉')
  } finally {
    rmrf(base)
  }
})

test('H3-相邻: record 丢失但含 session marker 的孤儿仍然被 empty() 删除', () => {
  const base = tmpdir('h3d')
  try {
    const store = new TrashStore(path.join(base, 'trash'))
    const orphan = path.join(store.root, 'orphan-sess-1')
    fs.mkdirSync(orphan, { recursive: true })
    fs.writeFileSync(path.join(orphan, SESSION_MARKER), 'x')
    assert.deepStrictEqual(store.empty(), [])
    assert.strictEqual(fs.existsSync(orphan), false, '带 marker 的孤儿属于回收站条目，必须能清')
  } finally {
    rmrf(base)
  }
})

// ---- H4a：安全名单只做全等比较 ----

test('H4: 系统目录的子目录作为 trashRoot 必须被拒（当前只做全等比较）', () => {
  assert.notStrictEqual(trashRootUnsafeReason('/etc/dsh-trash'), null, '/etc 的子目录必须拒绝')
  assert.notStrictEqual(trashRootUnsafeReason('/usr/local/lib/dsh-trash'), null, '/usr 的子目录必须拒绝')
  assert.notStrictEqual(trashRootUnsafeReason('/private/tmp/dsh-trash'), null, '/private 的子目录必须拒绝')
})

test('H4-相邻: 全等命中的老用例仍然被拒', () => {
  const home = os.homedir()
  assert.notStrictEqual(trashRootUnsafeReason(path.parse(process.cwd()).root), null, '文件系统根')
  assert.notStrictEqual(trashRootUnsafeReason(home), null, 'home 目录')
  assert.notStrictEqual(trashRootUnsafeReason(path.dirname(home)), null, 'home 的父目录')
  assert.notStrictEqual(trashRootUnsafeReason('/tmp'), null, '/tmp 本身')
  assert.notStrictEqual(trashRootUnsafeReason(os.tmpdir()), null, '系统临时目录本身')
})

test('H4-相邻: 正常的 ~/.dsh/session-manager-trash 仍然放行', () => {
  const ok = path.join(os.homedir(), '.dsh', 'session-manager-trash')
  assert.strictEqual(trashRootUnsafeReason(ok), null, '默认回收站位置必须可用')
})

test('H4-相邻: 系统临时目录的子目录仍然放行（否则所有临时目录用例与 CI 全废）', () => {
  // macOS 的 os.tmpdir() 在 /var/folders/... 之下，Linux 在 /tmp 之下——两者都落在
  // 拒绝名单的前缀里。把名单从“全等”改成“前缀”时必须显式豁免 os.tmpdir() 子树，
  // 否则 tests/unit/cordis-access.unit.test.js 与本套 apply() 用例会集体拒绝挂载。
  const underTmp = path.join(os.tmpdir(), 'dsh-sm-trash-fixture')
  assert.strictEqual(trashRootUnsafeReason(underTmp), null, '临时目录的子目录是合法测试 root')
})

// ---- H4b：全程不 realpath ----

test('H4: trashRoot 是指向 sessions root 内部的 symlink 时必须拒绝启用回收站', () => {
  const base = tmpdir('h4b')
  try {
    const sessionsRoot = path.join(base, 'sessions')
    const inside = path.join(sessionsRoot, 'inside-trash')
    fs.mkdirSync(inside, { recursive: true })
    const link = path.join(base, 'trash-link')
    fs.symlinkSync(inside, link, 'dir')

    const { ctx, routes } = makeCtx()
    apply(ctx, { sessionsRoot, trashRoot: link })
    assert.strictEqual(
      routes.length,
      0,
      'symlink 指回 sessions root 内部时必须拒绝挂载（否则 host 扫描会复活被移走的会话）',
    )
  } finally {
    rmrf(base)
  }
})

test('H4-相邻: 两个 root 互不包含时仍然正常挂载 /sm 路由', () => {
  const base = tmpdir('h4c')
  try {
    const { ctx, routes } = makeCtx()
    apply(ctx, { sessionsRoot: path.join(base, 'sessions'), trashRoot: path.join(base, 'trash') })
    assert.strictEqual(routes.length, 1, '正常配置必须挂上 /sm')
    assert.strictEqual(routes[0].path, '/sm')
    assert.strictEqual(routes[0].kind, 'prefix')
  } finally {
    rmrf(base)
  }
})

test('H4-相邻: trashRoot 直接位于 sessions root 内部时仍然拒绝挂载', () => {
  const base = tmpdir('h4d')
  try {
    const sessionsRoot = path.join(base, 'sessions')
    const { ctx, routes } = makeCtx()
    apply(ctx, { sessionsRoot, trashRoot: path.join(sessionsRoot, 'trash') })
    assert.strictEqual(routes.length, 0)
  } finally {
    rmrf(base)
  }
})

// ---- L1：rename 失败回滚删掉同 id 既有 record ----

test('L1: 移动失败的回滚不得删掉同 id 既有 record（老条目会变不可恢复的孤儿）', () => {
  const base = tmpdir('l1')
  try {
    const store = new TrashStore(path.join(base, 'trash'))
    // 第一次删除：id=dup 的旧条目已经在回收站里，record 指向它的原位置。
    const oldSrc = makeSessionDir(base, 'dup')
    store.moveToTrash(oldSrc, { id: 'dup', originalDir: oldSrc, title: '旧条目', projectKey: 'sessions' })
    assert.strictEqual(store.hasItem('dup'), true)

    // 第二次删除同 id（会话重建后又被删）：目标已存在且非空 → rename 抛错。
    const newSrc = path.join(base, 'sessions2', 'dup')
    fs.mkdirSync(newSrc, { recursive: true })
    fs.writeFileSync(path.join(newSrc, SESSION_MARKER), 'NEW')
    assert.throws(
      () => store.moveToTrash(newSrc, { id: 'dup', originalDir: newSrc, title: '新条目', projectKey: 'sessions2' }),
      /ENOTEMPTY|EEXIST|ENOTDIR|dest/i,
      '目标已存在时必须失败，绝不能覆盖',
    )

    const rec = store.readRecord('dup')
    assert.notStrictEqual(rec, null, '既有 record 必须还在（否则回收站里的旧条目再也找不回）')
    assert.strictEqual(rec.originalDir, oldSrc, 'record 必须仍指向旧条目的原位置')
    assert.strictEqual(fs.existsSync(path.join(newSrc, SESSION_MARKER)), true, '失败的移动不得动源目录')
  } finally {
    rmrf(base)
  }
})

test('L1-相邻: 无既有 record 时移动失败仍然不留 record（回滚语义不变）', () => {
  const base = tmpdir('l1b')
  try {
    const store = new TrashStore(path.join(base, 'trash'))
    // 目标位置被一个非空的同名目录占住，但没有对应 record。
    const squatter = path.join(store.root, 'ghost')
    fs.mkdirSync(squatter, { recursive: true })
    fs.writeFileSync(path.join(squatter, 'x'), 'x')
    const src = makeSessionDir(base, 'ghost')
    assert.throws(() => store.moveToTrash(src, { id: 'ghost', originalDir: src, title: null, projectKey: 'sessions' }))
    assert.strictEqual(store.hasRecord('ghost'), false, '失败的移动不得留下 record')
  } finally {
    rmrf(base)
  }
})
