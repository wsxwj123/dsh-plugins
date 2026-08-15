// 指令发现场景构建器：造一套"假的 dshHome + 项目树"，供 instructions.* 端点测试。
// 只建目录/文件，不含任何实现私有约定。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempDir } from './fixture.mjs'

/**
 * 造一套测试用的 dshHome 与项目树。
 *
 * 返回：
 *  {
 *    home,     // 假 dshHome
 *    project,  // 项目根（含 .git 标记）
 *    sub,      // project/sub
 *    nested,   // project/sub/nested
 *    path,     // (...seg) => 绝对路径
 *    write,    // (rel, content) => 写项目内文件
 *    cleanup
 *  }
 */
export function buildTree() {
  const { root, path, cleanup } = createTempDir()
  const home = path('fakeds_home', '.dsh')
  const project = path('project')
  const sub = path('project', 'sub')
  const nested = path('project', 'sub', 'nested')

  mkdirSync(home, { recursive: true })
  mkdirSync(project, { recursive: true })
  mkdirSync(sub, { recursive: true })
  mkdirSync(nested, { recursive: true })
  mkdirSync(path('project', '.git'), { recursive: true }) // 项目根标记

  const write = (rel, content) => {
    // 相对 project 根写文件（指令文件都在项目内）
    const full = join(project, ...rel.split('/'))
    const dir = full.slice(0, full.lastIndexOf('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(full, content, 'utf8')
    return full
  }

  return { home, project, sub, nested, path, write, cleanup }
}
