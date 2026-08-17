// 白盒单测：instruction-view.ts（lib/instruction-view.js 真实实现）
//
// 覆盖 INTERFACE §2.6 的 9 个事件主路径与边界：
//   防重复点击（同 scope 原样返回同一引用）、换 scope 重置、create-succeeded
//   只在 create 态生效、mark-dirty 的 edit/create/list 三分支、saved 的 path
//   匹配/不匹配、open-list/cancel-edit 的任意状态回收、纯函数不改入参。
// 与 tests/acceptance/test-13 D 组的分工：D 组目前驱动文件内置的 §2.6 参考
// reducer（锁定验收不可改），本文件直接驱动真实实现，逐条锚定同一契约。

import test from 'node:test'
import assert from 'node:assert/strict'
import { instructionViewReducer } from '../../lib/instruction-view.js'

test.describe('instructionViewReducer（§2.6）', () => {
  test('完整主流程：list → start-create(global) → create-pending → create-succeeded → mark-dirty → saved → list', () => {
    let v = instructionViewReducer({ kind: 'list' }, { type: 'open-list' })
    assert.deepEqual(v, { kind: 'list' })

    v = instructionViewReducer(v, { type: 'start-create', scope: 'global' })
    assert.deepEqual(v, { kind: 'create', scope: 'global', pending: true })

    v = instructionViewReducer(v, { type: 'create-pending' })
    assert.equal(v.pending, true)

    v = instructionViewReducer(v, { type: 'create-succeeded', path: '/home/AGENTS.md' })
    assert.deepEqual(v, { kind: 'create', scope: 'global', pending: false, path: '/home/AGENTS.md' })
    assert.equal(v.dirty, undefined, '创建成功未保存前 dirty 不置位')

    v = instructionViewReducer(v, { type: 'mark-dirty' })
    assert.equal(v.dirty, true)

    v = instructionViewReducer(v, { type: 'saved', path: '/home/AGENTS.md' })
    assert.deepEqual(v, { kind: 'list' })
  })

  test('open-edit → mark-dirty → cancel-edit 回 list（丢弃草稿）', () => {
    let v = instructionViewReducer({ kind: 'list' }, { type: 'open-edit', path: '/p/AGENTS.md' })
    assert.deepEqual(v, { kind: 'edit', path: '/p/AGENTS.md', dirty: false })
    v = instructionViewReducer(v, { type: 'mark-dirty' })
    assert.deepEqual(v, { kind: 'edit', path: '/p/AGENTS.md', dirty: true })
    v = instructionViewReducer(v, { type: 'cancel-edit' })
    assert.deepEqual(v, { kind: 'list' })
  })

  test('start-create 同 scope 防重复点击：原样返回同一引用；换 scope 生成新 create 态', () => {
    const orig = { kind: 'create', scope: 'project', pending: true }
    const again = instructionViewReducer(orig, { type: 'start-create', scope: 'project' })
    assert.strictEqual(again, orig, '同 scope 重复 start-create 必须返回同一引用')
    const switched = instructionViewReducer(orig, { type: 'start-create', scope: 'global' })
    assert.deepEqual(switched, { kind: 'create', scope: 'global', pending: true })
  })

  test('start-create 从 edit 态也可发起（覆盖 edit 态）', () => {
    const v = instructionViewReducer(
      { kind: 'edit', path: '/a/AGENTS.md', dirty: true },
      { type: 'start-create', scope: 'project' },
    )
    assert.deepEqual(v, { kind: 'create', scope: 'project', pending: true })
  })

  test('create-pending：非 create 态原样返回；create 态保持并置 pending:true', () => {
    const list = { kind: 'list' }
    assert.strictEqual(instructionViewReducer(list, { type: 'create-pending' }), list)
    const edit = { kind: 'edit', path: '/x', dirty: false }
    assert.strictEqual(instructionViewReducer(edit, { type: 'create-pending' }), edit)
    assert.deepEqual(
      instructionViewReducer(
        { kind: 'create', scope: 'global', pending: false, path: '/g' },
        { type: 'create-pending' },
      ),
      { kind: 'create', scope: 'global', pending: true, path: '/g' },
    )
  })

  test('create-succeeded 只在 create 态生效；list/edit 态原样返回', () => {
    const list = { kind: 'list' }
    assert.strictEqual(instructionViewReducer(list, { type: 'create-succeeded', path: '/p' }), list)
    const edit = { kind: 'edit', path: '/x', dirty: true }
    assert.strictEqual(instructionViewReducer(edit, { type: 'create-succeeded', path: '/p' }), edit)
  })

  test('create-failed：任何状态回 list', () => {
    assert.deepEqual(
      instructionViewReducer({ kind: 'create', scope: 'global', pending: true }, { type: 'create-failed' }),
      { kind: 'list' },
    )
    assert.deepEqual(
      instructionViewReducer({ kind: 'edit', path: '/x', dirty: true }, { type: 'create-failed' }),
      { kind: 'list' },
    )
  })

  test('mark-dirty：list 与未成功的 create（pending:true / 无 path）不置位', () => {
    assert.deepEqual(instructionViewReducer({ kind: 'list' }, { type: 'mark-dirty' }), { kind: 'list' })
    assert.deepEqual(
      instructionViewReducer({ kind: 'create', scope: 'global', pending: true }, { type: 'mark-dirty' }),
      { kind: 'create', scope: 'global', pending: true },
    )
    assert.deepEqual(
      instructionViewReducer({ kind: 'create', scope: 'project', pending: false }, { type: 'mark-dirty' }),
      { kind: 'create', scope: 'project', pending: false },
      'create 态 pending:false 但尚无 path（未成功）不置位',
    )
  })

  test('saved：path 匹配当前编辑目标回 list；不匹配保持原状（edit 与 create 两态）', () => {
    const edit = { kind: 'edit', path: '/a/AGENTS.md', dirty: true }
    assert.deepEqual(instructionViewReducer(edit, { type: 'saved', path: '/a/AGENTS.md' }), { kind: 'list' })
    assert.deepEqual(instructionViewReducer(edit, { type: 'saved', path: '/other/AGENTS.md' }), edit)
    const create = { kind: 'create', scope: 'global', pending: false, path: '/g/AGENTS.md', dirty: true }
    assert.deepEqual(instructionViewReducer(create, { type: 'saved', path: '/g/AGENTS.md' }), { kind: 'list' })
    assert.deepEqual(instructionViewReducer(create, { type: 'saved', path: '/nope' }), create)
    const list = { kind: 'list' }
    assert.strictEqual(instructionViewReducer(list, { type: 'saved', path: '/a' }), list)
  })

  test('open-list：任何状态都回 list', () => {
    assert.deepEqual(instructionViewReducer({ kind: 'edit', path: '/x', dirty: true }, { type: 'open-list' }), {
      kind: 'list',
    })
    assert.deepEqual(
      instructionViewReducer({ kind: 'create', scope: 'global', pending: false, path: '/x' }, { type: 'open-list' }),
      { kind: 'list' },
    )
    assert.deepEqual(
      instructionViewReducer({ kind: 'create', scope: 'project', pending: true }, { type: 'open-list' }),
      { kind: 'list' },
    )
  })

  test('cancel-edit：任何状态都回 list（未保存确认由调用层先做）', () => {
    assert.deepEqual(
      instructionViewReducer({ kind: 'create', scope: 'global', pending: false, path: '/x', dirty: true }, { type: 'cancel-edit' }),
      { kind: 'list' },
    )
    assert.deepEqual(instructionViewReducer({ kind: 'list' }, { type: 'cancel-edit' }), { kind: 'list' })
  })

  test('未知事件类型：原样返回同一引用', () => {
    const v = { kind: 'edit', path: '/x', dirty: false }
    assert.strictEqual(instructionViewReducer(v, { type: 'nope' }), v)
  })

  test('纯函数：不改入参、返回新对象', () => {
    const before = { kind: 'create', scope: 'global', pending: true }
    const out = instructionViewReducer(before, { type: 'open-edit', path: '/p/AGENTS.md' })
    assert.deepEqual(out, { kind: 'edit', path: '/p/AGENTS.md', dirty: false })
    assert.notStrictEqual(out, before)
    assert.deepEqual(before, { kind: 'create', scope: 'global', pending: true }, '入参不被修改')

    const dirtyIn = { kind: 'edit', path: '/x', dirty: false }
    const dirtyOut = instructionViewReducer(dirtyIn, { type: 'mark-dirty' })
    assert.notStrictEqual(dirtyOut, dirtyIn)
    assert.deepEqual(dirtyIn, { kind: 'edit', path: '/x', dirty: false }, 'mark-dirty 不改入参')
  })
})
