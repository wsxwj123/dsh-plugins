/**
 * skin-folder-pick.test.mjs — 「选皮肤文件夹」的挑文件纯函数门禁。
 *
 * 只测 pickSkinFolderFiles：给一份 FileList 形状的替身（name / size / webkitRelativePath），
 * 断言它挑对根层三件套、忽略子目录与无关文件、缺件与超体积按既有错误契约抛。
 * 不碰 DOM、不读文件内容——读内容与校验分别归 UI 与导入管道。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickSkinFolderFiles } from '../../src/panel-skin.js'
import { MAX_BUNDLE_B64, MAX_A11Y_BYTES, ERR } from '../../src/custom-skin.js'

/** FileList 替身：webkitdirectory 下浏览器给的 webkitRelativePath 一律正斜杠 */
const f = (relPath, size = 10) => ({ name: relPath.split('/').pop(), size, webkitRelativePath: relPath })

test('挑出根层三件套并忽略无关文件', () => {
  const got = pickSkinFolderFiles([
    f('my-skin/README.md'), f('my-skin/skin.json'), f('my-skin/client.js'),
    f('my-skin/a11y.css'), f('my-skin/preview.png'),
  ])
  assert.equal(got.skin.name, 'skin.json')
  assert.equal(got.client.name, 'client.js')
  assert.equal(got.a11y.name, 'a11y.css')
})

test('文件名大小写不敏感', () => {
  const got = pickSkinFolderFiles([f('S/Skin.JSON'), f('S/CLIENT.js'), f('S/A11Y.Css')])
  assert.equal(got.skin.name, 'Skin.JSON')
  assert.equal(got.client.name, 'CLIENT.js')
  assert.equal(got.a11y.name, 'A11Y.Css')
})

test('子目录里的同名文件不被误取', () => {
  const got = pickSkinFolderFiles([
    f('my-skin/nested/skin.json', 1), f('my-skin/skin.json', 2),
    f('my-skin/deep/a/client.js', 3), f('my-skin/client.js', 4),
    f('my-skin/nested/a11y.css', 5),
  ])
  assert.equal(got.skin.size, 2)
  assert.equal(got.client.size, 4)
  assert.equal(got.a11y, null, '只有子目录有 a11y.css 时不算数')
})

test('子目录里凑齐三件套也不算数（缺件报错）', () => {
  assert.throws(() => pickSkinFolderFiles([f('outer/inner/skin.json'), f('outer/inner/client.js')]), (e) => {
    assert.equal(e.code, ERR.MISSING_FILE)
    assert.match(e.message, /缺 skin\.json 和 client\.js/)
    return true
  })
})

test('a11y.css 缺失合法', () => {
  const got = pickSkinFolderFiles([f('s/skin.json'), f('s/client.js')])
  assert.equal(got.a11y, null)
})

test('缺 client.js 报 ERR_SKIN_MISSING_FILE 且点名缺的那个', () => {
  assert.throws(() => pickSkinFolderFiles([f('s/skin.json'), f('s/a11y.css')]), (e) => {
    assert.equal(e.code, ERR.MISSING_FILE)
    assert.equal(e.message.includes('client.js'), true)
    assert.equal(e.message.includes('skin.json'), false)
    return true
  })
})

test('空选择 / 非法入参报缺件而不是崩', () => {
  for (const input of [undefined, null, []]) {
    assert.throws(() => pickSkinFolderFiles(input), (e) => e.code === ERR.MISSING_FILE)
  }
})

test('skin.json + client.js 原始字节超 256KB 直接拒（不读内容）', () => {
  assert.throws(() => pickSkinFolderFiles([
    f('s/skin.json', 200), f('s/client.js', MAX_BUNDLE_B64),
  ]), (e) => {
    assert.equal(e.code, ERR.SIZE)
    assert.match(e.message, /超 256KB/)
    return true
  })
})

test('刚好压线的包不拒（真门禁留给导入管道）', () => {
  const got = pickSkinFolderFiles([f('s/skin.json', 144), f('s/client.js', MAX_BUNDLE_B64 - 144)])
  assert.equal(got.client.size, MAX_BUNDLE_B64 - 144)
})

test('a11y.css 超 65536 字节直接拒', () => {
  assert.throws(() => pickSkinFolderFiles([
    f('s/skin.json'), f('s/client.js'), f('s/a11y.css', MAX_A11Y_BYTES + 1),
  ]), (e) => {
    assert.equal(e.code, ERR.SIZE)
    assert.match(e.message, /a11y\.css 超 65536 字节/)
    return true
  })
})

test('webkitRelativePath 为空的环境按根层文件处理', () => {
  const bare = (name, size = 10) => ({ name, size, webkitRelativePath: '' })
  const got = pickSkinFolderFiles([bare('skin.json'), bare('client.js')])
  assert.equal(got.skin.name, 'skin.json')
  assert.equal(got.a11y, null)
})
