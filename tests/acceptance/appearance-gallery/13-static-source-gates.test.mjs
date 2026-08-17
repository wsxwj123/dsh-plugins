// 静态门禁：INTERFACE §3.1 / §3.4-5 / §3.7 常量 / §3.8 渲染 / §3.9 导出 / §3.10 产物
// 包目录还不存在时全部 skip（skip 原因写清接线方法），04 落地后自动生效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  KEYS, ALL_KEYS, SLOT, BUILTIN_SKIN_IDS, DANGEROUS_SUBSTRINGS, MAX_BUNDLE_B64, MAX_CUSTOM_COUNT,
  MAX_A11Y_BYTES, SKIN_REQUIRED_META, CTX_WHITELIST, SHELL_LINES, SHELL_TAIL,
  CLIENT_JS_HARD_MAX_BYTES, ACCEPTANCE_API_EXPORTS, MODULE_EXPORTS, SURFACE_FIELDS,
} from './helpers/contract.mjs';
import { skipUnlessPkg, readText, walk, countMatches, PKG_DIR } from './helpers/pkg.mjs';

const srcFiles = () => walk('src', ['.js', '.mjs']);
const srcText = () => srcFiles().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const skinFiles = () => walk('skins', ['.js', '.css', '.json']);

// ---------------- §3.1 槽位注册（源码与产物各 1 处）----------------
test('静态_src下slots.register命中数恰好1', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(countMatches(srcText(), /slots\.register\s*\(/g), 1);
});

test('静态_lib客户端产物里slots.register命中数恰好1', (t) => {
  if (skipUnlessPkg(t)) return;
  const lib = readText('lib/client.js');
  assert.notEqual(lib, null, 'lib/client.js 不存在');
  assert.equal(countMatches(lib, /slots\.register\s*\(/g), 1);
});

test('静态_lib客户端产物里不出现priority', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(readText('lib/client.js').includes('priority'), false);
});

test('静态_槽位id字面量出现在产物里', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.ok(readText('lib/client.js').includes(`'${SLOT.id}'`) || readText('lib/client.js').includes(`"${SLOT.id}"`));
});

// ---------------- §3.4 第 5 条：storage 读写白名单 ----------------
test('静态_src与skins下不出现localStorage.clear', (t) => {
  if (skipUnlessPkg(t)) return;
  const all = [...srcFiles(), ...skinFiles()].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.equal(all.includes('localStorage.clear()'), false);
});

test('静态_src与skins下不出现枚举localStorage的写法', (t) => {
  if (skipUnlessPkg(t)) return;
  const all = [...srcFiles(), ...skinFiles()].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.equal(all.includes('Object.keys(localStorage)'), false);
  assert.equal(/localStorage\.key\s*\(/.test(all), false);
});

test('静态_storage调用的key实参不出现8个键以外的字面量', (t) => {
  if (skipUnlessPkg(t)) return;
  const all = [...srcFiles(), ...skinFiles()].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const literals = [...all.matchAll(/(?:getItem|setItem|removeItem)\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const strays = literals.filter((k) => !ALL_KEYS.includes(k));
  assert.deepEqual(strays, [], `出现了白名单外的 storage 键字面量：${strays.join(',')}`);
});

test('静态_9套内置皮肤里不出现任何storage与cookie用法', (t) => {
  if (skipUnlessPkg(t)) return;
  const all = skinFiles().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const bad of ['localStorage', 'sessionStorage', 'document.cookie']) {
    assert.equal(all.includes(bad), false, `内置皮肤里出现了 ${bad}`);
  }
});

test('静态_8个storage键名字面量都在src里出现过', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  for (const k of ALL_KEYS) assert.ok(text.includes(k), `src 里找不到键名 ${k}`);
});

// ---------------- §3.8 渲染硬约定 ----------------
test('静态_src下不出现dangerouslySetInnerHTML', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(srcText().includes('dangerouslySetInnerHTML'), false);
});

test('静态_src下不出现innerHTML', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(srcText().includes('innerHTML'), false);
});

test('静态_src下不出现insertAdjacentHTML', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(srcText().includes('insertAdjacentHTML'), false);
});

// ---------------- §3.7 五组对外承诺常量 ----------------
test('静态_256KB上限字面值是262144', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.ok(new RegExp(`MAX_BUNDLE_B64\\s*=\\s*${MAX_BUNDLE_B64}\\b`).test(srcText()));
});

test('静态_自定义皮肤数量上限字面值是8', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.ok(new RegExp(`MAX_CUSTOM_COUNT\\s*=\\s*${MAX_CUSTOM_COUNT}\\b`).test(srcText()));
});

test('静态_a11y上限字面值是65536', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.ok(new RegExp(`MAX_A11Y_BYTES\\s*=\\s*${MAX_A11Y_BYTES}\\b`).test(srcText()));
});

test('静态_12条高危黑名单全部存在且顺序与INTERFACE一致', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  const positions = DANGEROUS_SUBSTRINGS.map((s) => text.indexOf(JSON.stringify(s).slice(1, -1)));
  for (let i = 0; i < DANGEROUS_SUBSTRINGS.length; i += 1) {
    assert.notEqual(positions[i], -1, `黑名单缺 ${DANGEROUS_SUBSTRINGS[i]}`);
  }
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, sorted, '黑名单顺序与 INTERFACE 声明的代码顺序不一致');
});

test('静态_四个必填字段名都在src里', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  for (const f of SKIN_REQUIRED_META) assert.ok(text.includes(f), `缺必填字段 ${f}`);
});

test('静态_ctx白名单恰好是effect与get两项', (t) => {
  if (skipUnlessPkg(t)) return;
  const m = srcText().match(/CTX_WHITELIST\s*=\s*\[([^\]]*)\]/);
  assert.notEqual(m, null, '找不到 CTX_WHITELIST');
  const names = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepEqual(names.sort(), [...CTX_WHITELIST].sort());
});

// ---------------- §3.9 模块导出与测试钩子 ----------------
test('静态_acceptance-api导出5个约定名字', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = readText('src/acceptance-api.mjs');
  assert.notEqual(text, null, 'src/acceptance-api.mjs 不存在');
  for (const name of ACCEPTANCE_API_EXPORTS) {
    assert.ok(new RegExp(`export[^\\n]*\\b${name}\\b|\\b${name}\\b[^\\n]*}`).test(text), `缺导出 ${name}`);
  }
});

for (const [file, names] of Object.entries(MODULE_EXPORTS)) {
  test(`静态_${file}导出清单齐全`, (t) => {
    if (skipUnlessPkg(t)) return;
    const text = readText(`src/${file}`);
    assert.notEqual(text, null, `src/${file} 不存在`);
    for (const n of names) assert.ok(text.includes(n), `${file} 缺导出 ${n}`);
  });
}

test('静态_两个浏览器测试钩子都保留', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  assert.ok(text.includes('__TG_EXEC_SCRIPT__'), '缺 __TG_EXEC_SCRIPT__ 钩子');
  assert.ok(text.includes('__TG_SURFACE__'), '缺 __TG_SURFACE__ 钩子');
});

test('静态_TG_SURFACE的12个字段名全部出现', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  for (const f of SURFACE_FIELDS) assert.ok(text.includes(f), `surface 缺字段 ${f}`);
});

test('静态_面板文件不引用apply层的模块级标识符', (t) => {
  if (skipUnlessPkg(t)) return;
  // §3.9 边界约束 1 的 grep 版（保守清单：只查明确属于 apply 层的名字）
  const applyLayerOnly = ['teardownSkins', '__SKIN_MANIFEST__', '__SKIN_BUNDLES__', '__SKIN_A11Y__'];
  for (const f of srcFiles().filter((p) => /panel/i.test(path.basename(p)))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const name of applyLayerOnly) {
      assert.equal(text.includes(name), false, `${path.basename(f)} 引用了 apply 层的 ${name}`);
    }
  }
});

// ---------------- §3.10 构建产物契约 ----------------
test('静态_产物壳第1行逐字符匹配', (t) => {
  if (skipUnlessPkg(t)) return;
  const lines = readText('lib/client.js').split('\n');
  assert.equal(lines[0], SHELL_LINES[0]);
});

test('静态_产物壳第2行逐字符匹配', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(readText('lib/client.js').split('\n')[1], SHELL_LINES[1]);
});

test('静态_产物壳第3行逐字符匹配', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(readText('lib/client.js').split('\n')[2], SHELL_LINES[2]);
});

test('静态_产物尾部含load闭合串', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.ok(readText('lib/client.js').includes(SHELL_TAIL));
});

test('静态_产物导出apply与inject', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = readText('lib/client.js');
  assert.ok(text.includes('exports.apply = apply'));
  assert.ok(text.includes("exports.inject = ['slots']"));
});

test('静态_产物已嵌入皮肤三张表', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = readText('lib/client.js');
  for (const tbl of ['__SKIN_MANIFEST__', '__SKIN_BUNDLES__', '__SKIN_A11Y__']) {
    assert.ok(text.includes(tbl), `产物缺 ${tbl}`);
  }
});

test('静态_产物含9个内置皮肤id字符串', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = readText('lib/client.js');
  for (const id of BUILTIN_SKIN_IDS) assert.ok(text.includes(id), `产物缺皮肤 ${id}`);
});

test('静态_lib下只有client.js与index.js两个文件', (t) => {
  if (skipUnlessPkg(t)) return;
  const dir = path.join(PKG_DIR, 'lib');
  assert.ok(fs.existsSync(dir), 'lib/ 不存在');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['client.js', 'index.js']);
});

test('静态_不保留invariant.js', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(fs.existsSync(path.join(PKG_DIR, 'lib/invariant.js')), false);
});

test('静态_packagejson不再导出invariant路径', (t) => {
  if (skipUnlessPkg(t)) return;
  assert.equal(readText('package.json').includes('./invariant'), false);
});

test('静态_产物语法可通过node语法检查', (t) => {
  if (skipUnlessPkg(t)) return;
  // 用 node --check 代替 INTERFACE 写的 new Function(src)：同样是"只解析不执行"的语法门禁，
  // 但完全不进入执行路径（产物内含用户导入的皮肤 bundle 文本，不该被求值）。
  const r = spawnSync(process.execPath, ['--check', path.join(PKG_DIR, 'lib/client.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `产物语法错误：${r.stderr}`);
});

test('静态_产物体积不超过兜底上限900KB', (t) => {
  if (skipUnlessPkg(t)) return;
  const size = fs.statSync(path.join(PKG_DIR, 'lib/client.js')).size;
  assert.ok(size <= CLIENT_JS_HARD_MAX_BYTES, `lib/client.js ${size} B 超过兜底上限 ${CLIENT_JS_HARD_MAX_BYTES} B`);
});

test('静态_designSummary文本已换成新仓库路径与新验收命令', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  assert.equal(text.includes('packages/skin-gallery/skins/'), false, '仍残留旧仓库路径');
  assert.equal(text.includes('pnpm --filter dsh-skin-gallery'), false, '仍残留旧验收命令');
});

test('静态_旧包三个目录已从packages下删除', (t) => {
  if (skipUnlessPkg(t)) return;
  for (const old of ['theme-gallery', 'skin-gallery', 'skin-runtime']) {
    assert.equal(fs.existsSync(path.join(PKG_DIR, '..', old)), false, `packages/${old} 仍在`);
  }
});

test('静态_track键常量名与键名同时存在', (t) => {
  if (skipUnlessPkg(t)) return;
  const text = srcText();
  assert.ok(text.includes('TRACK_KEY'));
  assert.ok(text.includes(KEYS.TRACK));
});

// ---------------- 跨平台（BRIEF「平台范围」第 2 条）----------------
/** 构建链脚本：包内 build.mjs / scripts 下的 .mjs / .js */
function buildScripts() {
  const files = [];
  for (const rel of ['build.mjs', 'check.mjs']) {
    const p = path.join(PKG_DIR, rel);
    if (fs.existsSync(p)) files.push(p);
  }
  return [...files, ...walk('scripts', ['.mjs', '.js'])];
}

test('跨平台_构建脚本不得硬编码POSIX路径拼接', (t) => {
  if (skipUnlessPkg(t)) return;
  const scripts = buildScripts();
  assert.ok(scripts.length > 0, '找不到构建脚本（build.mjs / check.mjs / scripts/**）');
  const bad = [];
  for (const f of scripts) {
    const text = fs.readFileSync(f, 'utf8');
    // 三种硬编码写法：字符串 '/' 参与拼接、__dirname + '/'、绝对路径字面量
    for (const re of [/['"]\/['"]\s*\+/g, /\+\s*['"]\/['"]/g, /__dirname\s*\+\s*['"`]\//g, /['"`]\/Users\//g, /['"`]\/home\//g]) {
      if (re.test(text)) bad.push(`${path.basename(f)} 命中 ${re}`);
    }
  }
  assert.deepEqual(bad, [], `构建脚本里有硬编码 POSIX 路径：${bad.join(' | ')}`);
});

test('跨平台_构建脚本不得调用macOS专属命令', (t) => {
  if (skipUnlessPkg(t)) return;
  const macOnly = ['sips', 'pbcopy', 'pbpaste', 'osascript', 'iconutil', 'textutil', 'afconvert', 'plutil', 'defaults write'];
  const bad = [];
  for (const f of buildScripts()) {
    const text = fs.readFileSync(f, 'utf8');
    for (const cmd of macOnly) {
      if (new RegExp(`['"\`\\s]${cmd}[\\s'"\`]`).test(text)) bad.push(`${path.basename(f)} 用了 ${cmd}`);
    }
  }
  assert.deepEqual(bad, [], `构建脚本用了 macOS 专属命令：${bad.join(' | ')}`);
});

test('跨平台_构建脚本不得依赖shell展开glob', (t) => {
  if (skipUnlessPkg(t)) return;
  const bad = [];
  for (const f of buildScripts()) {
    const text = fs.readFileSync(f, 'utf8');
    // exec/spawn 走 shell 且命令串里带 * ⇒ 依赖 shell 展开，Windows cmd 不展开
    for (const m of text.matchAll(/(?:execSync|exec|spawnSync|spawn)\s*\(\s*[`'"]([^`'"]*)[`'"]/g)) {
      if (m[1].includes('*')) bad.push(`${path.basename(f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `构建脚本依赖 shell glob 展开：${bad.join(' | ')}`);
});

test('跨平台_产物与皮肤源码不得出现盘符或UNC路径字面量', (t) => {
  if (skipUnlessPkg(t)) return;
  const files = [...srcFiles(), ...skinFiles()];
  const bad = files.filter((f) => /[`'"][A-Za-z]:\\\\|[`'"]\\\\\\\\[a-zA-Z]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => path.basename(f)), []);
});
