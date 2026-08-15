// 测试夹具：临时目录 / 临时文件的创建与清理。
// 只依赖 node 内置库，不引外部框架。
// 每个测试通过 createTempDir() 拿到独立临时目录，t.after 里清理；
// 目录名带随机后缀，测试互不干扰、可任意顺序跑。

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

let dirSeq = 0

/**
 * 创建一个独立临时目录。返回 { root, cleanup, path(...) }
 * - root          目录绝对路径
 * - cleanup()     递归删除（在测试的 after 钩子里调用）
 * - path(...seg)  拼出 root 下路径
 */
export function createTempDir() {
  const root = join(tmpdir(), `ct-test-${process.pid}-${Date.now()}-${dirSeq++}-${randomBytes(4).toString('hex')}`)
  mkdirSync(root, { recursive: true })
  return {
    root,
    path: (...seg) => join(root, ...seg),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** mkdir -p 语义 */
export function mkdirp(dir) {
  mkdirSync(dir, { recursive: true })
}

/** 写文本文件（UTF-8），若父目录不存在自动创建 */
export function writeFile(parent, rel, content) {
  const full = join(parent, rel)
  const parentDir = full.slice(0, full.lastIndexOf(sep))
  mkdirp(parentDir)
  writeFileSync(full, content, 'utf8')
  return full
}

/**
 * 创建新文件系统（项目根骨架），返回已创建模板。
 * dir 为临时根。
 */
export function makeTree(dir) {
  return {
    root: dir,
    project: join(dir, 'project'),
    sub: join(dir, 'project', 'sub'),
    nested: join(dir, 'project', 'sub', 'nested'),
  }
}

/** 建一个指向项目外文件的符号链接，返回链接路径 */
export function makeSymlink(linkPath, targetPath) {
  mkdirp(linkPath.slice(0, linkPath.lastIndexOf(sep)))
  symlinkSync(targetPath, linkPath, 'file')
  return linkPath
}

/** 确认路径是（或不）符号链接，供反向用例断言 */
export function isSymlink(p) {
  return lstatSync(p).isSymbolicLink()
}
