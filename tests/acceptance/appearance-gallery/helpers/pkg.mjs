// 静态门禁用的文件访问层。包目录还不存在时，测试统一 skip 并说明接线方法，
// 不允许静态断言"因为文件不存在"而假绿。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const PKG_DIR = path.join(REPO_ROOT, 'packages/appearance-gallery');

export const pkgExists = () => fs.existsSync(PKG_DIR);

/** 在测试开头调用：包不存在就 skip（返回 true 表示调用方应直接 return） */
export function skipUnlessPkg(t) {
  if (pkgExists()) return false;
  t.skip('packages/appearance-gallery 尚未创建（04 实现落地后此断言自动生效，无需改测试）');
  return true;
}

export function readText(rel) {
  const p = path.join(PKG_DIR, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/** 递归列出某子目录下匹配扩展名的文件（绝对路径） */
export function walk(rel, exts) {
  const root = path.join(PKG_DIR, rel);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else if (!exts || exts.includes(path.extname(e.name))) out.push(full);
    }
  };
  rec(root);
  return out;
}

/** 统计一个正则在文本里的命中次数 */
export function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return (text.match(g) || []).length;
}

/** 整个 repo 的 packages/ 下找某个文件名（P8 用） */
export function findInPackages(filename) {
  const root = path.join(REPO_ROOT, 'packages');
  const out = [];
  if (!fs.existsSync(root)) return out;
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else if (e.name === filename) out.push(full);
    }
  };
  rec(root);
  return out;
}
