// dsh-0.2-adapt 静态门禁公共工具：定位三个包目录、读「数据」（文本 / JSON）、
// 递归列文件。所有静态断言只读文本比较，绝不执行包内代码。
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '../../..')

export const PKGS = {
  turnScrubber: path.join(REPO_ROOT, 'packages/dsh-turn-scrubber'),
  composerTools: path.join(REPO_ROOT, 'packages/dsh-composer-tools'),
  appearanceGallery: path.join(REPO_ROOT, 'packages/dsh-appearance-gallery'),
}

export function readText(abs) {
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

export function readJson(abs) {
  const t = readText(abs)
  if (t == null) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** 递归列出 dir 下匹配扩展名的文件（绝对路径）；dir 不存在返回 []。 */
export function walk(dir, exts) {
  if (!fs.existsSync(dir)) return []
  const out = []
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') rec(full)
      } else if (!exts || exts.includes(path.extname(e.name))) {
        out.push(full)
      }
    }
  }
  rec(dir)
  return out
}

/** 从一段 JS/TS 文本里提取 inject 数组（字符串字面量列表）；找不到返回 null。 */
export function extractInject(text) {
  if (!text) return null
  const m = text.match(/inject\s*[:=]\s*\[([^\]]*)\]/)
  if (!m) return null
  const literals = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  return literals.length ? literals : null
}
