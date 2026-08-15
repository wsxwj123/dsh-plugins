// helpers.js — dsh-session-manager 验收测试基础设施
//
// 角色定位：本文件根据 .devflow/INTERFACE.md 的对外契约，构建一个"契约的可执行镜像"
// （executable spec）。它起一个真实的 loopback HTTP 服务器，路由 `/sm/<method>`，
// 用临时目录模拟 `~/.dsh/sessions` 与回收站根，按接口契约逐条实现每个端点的判定顺序、
// 幂等真值、错误码与文件系统行为。测试通过真实 HTTP 请求它（127.0.0.1，随机端口），
// 断言 HTTP 状态码 + JSON `code` + 落盘文件状态。
//
// 这样写的原因：node 半插件在 03 阶段尚未实现，而验收测试要在实现之前设计和落盘。
// harness 就是"实现必须满足的行为"的既定版本——实现方写真实 node 半侧时，应保证
// 同一批测试（切换注入点后）仍全绿。测试本身绝不触碰真实 ~/.dsh：所有路径都在
// 由 Mkdtemp 生成的临时目录里。
//
// 切换点：getTestContext() 内 loadBackend()。当前返回本地 harness；实现方此后应将
// 注入点指向真实 node 半侧的对外 handler，保持同一组断言不变。
//
// 零第三方依赖：仅 node 内置（node:http / node:fs / node:os / node:path / node:test）。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

// ---------- 常量（与 INTERFACE 对齐）----------
const ENCODE_CHECK = 2 ** 20; // 深度保护
// 会话骨架文件：删除/恢复只整体移动目录，不读写正文。存在即视为"有效会话目录"。
const SESSION_MARKER = 'session.jsonl.zstd';
const MARKER_CONTENT = 'DUMMY_SESSION_LOG\n'; // 测试构造的占位内容，绝不模拟真实会话

// ---------- 工具：id 合法性校验（INTERFACE §3.1）----------
// id 非法 = 非字符串 / 空串 / 含路径分隔符或控制字符 / 含会被 encodeSegment 映射出逃逸的字符。
function assertValidId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  // 拒绝路径分隔符、`.` 段、控制字符
  return !/[\\/\n\r\t\0\u0000-\u001f]/.test(id) && id !== '.' && id !== '..' && id !== '';
}

// encodeSegment 兜底判定：id 作为单段文件名必须是"安全段"——不含会改变路径语义的字符。
// assertValidId 已挡路径分隔符与控制字符；这里再确认 id 作为段名 round-trip 后不产生 `.`/`..`
// 或路径分隔的歧义（例如纯中文/空格 id 是安全段，应放行，不判越界）。
function encodeSegmentId(id) {
  // 安全段：basename(id)===id 且 id 不是 '.'/'..'（assertValidId 已拒），且不含 %（URL 逃逸歧义）
  if (typeof id !== 'string') return '';
  if (path.basename(id) !== id) return encodeURIComponent(id); // 含路径分隔 → 非安全段
  if (id.includes('%')) return encodeURIComponent(id);
  return id; // 中文/空格/普通字符 → 安全段，保持原样
}

// ---------- 假会话 / 环境构建 ----------
// 在 tmp 根下构造 ~/.dsh/sessions 树的镜像。
function makeFakeSessionsRoot(tmpRoot) {
  const sessionsRoot = path.join(tmpRoot, 'sessions');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  return sessionsRoot;
}

// 造一个假会话目录：<root>/sessions 树下的 <projectKey>/<id>/session.jsonl.zstd
// 约定 root = 会话树根（sessions 目录本身）；projectKey 缺省 = ""（目录落在根，id 直接作段）。
// 返回 { dir, projectDir, markerPath }
function makeFakeSession(root, projectKey = '', id, opts = {}) {
  const projectDir = projectKey ? path.join(root, projectKey) : root;
  const dir = path.join(projectDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SESSION_MARKER), opts.content || MARKER_CONTENT);
  return { dir, projectDir, markerPath: path.join(dir, SESSION_MARKER) };
}

// 造假 workspace 全局归档集合 ({ initialized, workspaceIds, archivedSessionIds })。
function makeWorkspaceGlobal(tmpRoot, archiveIds = []) {
  const file = path.join(tmpRoot, 'workspace.json');
  const store = { initialized: true, workspaceIds: ['main'], archivedSessionIds: [...archiveIds] };
  const dir = path.dirname(file);
  if (dir !== tmpRoot) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store));
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { initialized: true, workspaceIds: [], archivedSessionIds: [] }; }
  }
  function write(v) { fs.writeFileSync(file, JSON.stringify(v)); }
  return {
    path: file,
    read,
    write,
    archived() { return read().archivedSessionIds || []; },
    setArchived(next) {
      const cur = read();
      cur.archivedSessionIds = [...next];
      write(cur);
    },
  };
}

// 回收站记录：每删除只应移目录 + 写一条 record { id, originalDir, title, deletedAt }。
// 记录放 trashRoot/metadata/<id>.json（路径不对外，/sm/trash 不回传 originalDir）。
function makeTrashRoot(tmpRoot) {
  const trashRoot = path.join(tmpRoot, 'trash');
  const metaDir = path.join(trashRoot, '_metadata');
  fs.mkdirSync(metaDir, { recursive: true });
  return {
    root: trashRoot,
    metaDir,
    recordPath: (id) => path.join(metaDir, `${id}.json`),
    writeRecord(rec) { fs.writeFileSync(this.recordPath(rec.id), JSON.stringify(rec)); },
    readRecord(id) {
      try { return JSON.parse(fs.readFileSync(this.recordPath(id), 'utf8')); }
      catch { return null; }
    },
    deleteRecord(id) { fs.rmSync(this.recordPath(id), { force: true }); },
    records() {
      if (!fs.existsSync(this.metaDir)) return [];
      return fs.readdirSync(this.metaDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(this.metaDir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean);
    },
  };
}

// ---------- ctx：node 半注册点的可注入替身（shape 取自 INTERFACE §6）----------
// 测试通过它模拟"官方依赖是否可用"，以覆盖 依赖不可用 错误路径。
function makeCtx(env) {
  // live 会话判定：env.cfg.state.liveIds 里的 id 视为运行中
  const liveIds = env.cfg.state.liveIds || new Set();
  return {
    // ctx.sessions.get(id)：node SessionStore；live → 返回对象，否则 null
    sessions: {
      get(id) { return liveIds.has(id) ? { id, running: true } : null; },
    },
    // ctx.storageDomain.get("workspace")：可选模拟"域不可用"
    storageDomain: {
      get(domain) {
        if (env.cfg.state.domainUnavailable) return null;
        return {
          global: {
            // 读归档集合；可选模拟"存储写失败"
            set(nextGlobal) {
              if (env.cfg.state.storageWriteFail) throw new Error('storage write failed (simulated)');
              env.workspace.setArchived(nextGlobal.archivedSessionIds);
            },
          },
        };
      },
    },
  };
}

// ---------- 回收站操作（核心行为，按 INTERFACE）----------
// 所有动作在临时目录内：fromDir 移到 trashRoot/<id>/，绝不触碰真实会话。
function moveToTrash(env, { id, originalDir, projectKey, title }) {
  const dest = path.join(env.trash.root, id);
  fs.renameSync(originalDir, dest); // 整目录移动
  env.trash.writeRecord({ id, originalDir, title: title || null, deletedAt: Date.now(), projectKey });
  return dest;
}

function restoreFromTrash(env, id) {
  const record = env.trash.readRecord(id);
  if (!record) return { status: 200, json: { ok: false, code: 'not-in-trash', message: 'no such trash entry' } };
  if (fs.existsSync(record.originalDir)) {
    // 原路径已被占：拒绝覆盖，不做移动
    return { status: 200, json: { ok: false, code: 'restore-target-exists', message: 'original dir occupied; refusing to overwrite' } };
  }
  const from = path.join(env.trash.root, id);
  if (!fs.existsSync(from)) return { status: 200, json: { ok: false, code: 'system-error', message: 'trash entry dir missing' } };
  fs.mkdirSync(path.dirname(record.originalDir), { recursive: true });
  fs.renameSync(from, record.originalDir);
  env.trash.deleteRecord(id);
  return { status: 200, json: { ok: true } };
}

// ---------- 路径越界判定（INTERFACE §3.1）----------
// 校验：id 经 encodeSegment 后必须等于自身；目标目录必须在 sessionsRoot 前缀内。
// cwd 缺省（undefined/null）→ 回落到 sessions 根；cwd 为空串且无法定位 project → session-dir-not-found；
// 显式 projectCwdMap[cwd] 可把某个 cwd 映射到 sessions 根之外（测 path-out-of-bounds）。
function resolveProjectDir(env, cwd) {
  if (cwd === undefined || cwd === null) return { projectDir: env.sessionsRoot };
  if (typeof cwd !== 'string') return { projectDir: null, invalid: true };
  if (cwd === '') return { projectDir: null, notFound: true };
  if (env.projectCwdMap && env.projectCwdMap[cwd] !== undefined) return { projectDir: env.projectCwdMap[cwd] };
  return { projectDir: path.join(env.sessionsRoot, cwd) };
}

// ---------- 后端（backend）抽象：测试真正驱动的对象 ----------
// 每个方法返回 { status, json }，语义完全照抄 INTERFACE。
function makeBackend(env) {
  // ---- 统一信任 fence（403 兜底，优先级最高，任何合法端点都一样）----
  // 复刻 INTERFACE 引用的官方 isTrustedApiRequest 语义：
  //   trust = Host ∈ loopback(localhost/127.0.0.0/8/[::1])  ∧  Sec-Fetch-Site !== cross-site  ∧
  //           (Origin 缺省=同源) ∨ Origin ∈ 本机同源
  // 因为浏览器 fetch 不允许客户端随意设置 Host/Origin/Sec-Fetch-Site 头，测试把这些"请求信任属性"
  // 通过 server.call 的 headers 参数注入，harness 据真头判定（黑盒：看输入头→断言 403/200）。
  function isTrusted(req) {
    const test = req.headersAccess || {};
    const real = req.smRealHeaders || {};
    // host：优先测试注入，否则真实请求 host
    const host = (test.host || real.host || '').toLowerCase();
    const secFetchSite = (test['sec-fetch-site'] || '').toLowerCase();
    const origin = test.origin || '';

    const isLoopbackHost =
      host === 'localhost' || host === '127.0.0.1' || /^127\./.test(host) || host === '[::1]' || host.endsWith('localhost');
    if (!isLoopbackHost) return false;

    if (secFetchSite === 'cross-site') return false;

    if (origin) {
      let originHost = origin;
      try { originHost = new URL(origin).host; } catch { /* keep raw */ }
      originHost = originHost.toLowerCase().replace(/:\d+$/, ''); // strip port
      const loopbackOrigin =
        originHost === 'localhost' || /^127\./.test(originHost) || originHost === '[::1]' || originHost.endsWith('localhost');
      if (!loopbackOrigin) return false;
    }
    return true;
  }

  function handle(method, req, body) {
    if (!isTrusted(req)) {
      return { status: 403, json: { error: 'forbidden' } };
    }

    switch (method) {
      case 'delete': return doDelete(req, body);
      case 'restore': return doRestore(req, body);
      case 'emptyTrash': return doEmptyTrash(req, body);
      case 'unarchive': return doUnarchive(req, body);
      case 'trash': return doTrash(req, body);
      default: return { status: 404, json: { error: 'not found' } };
    }
  }

  // ---------- /sm/delete ----------
  function doDelete(req, body) {
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, json: { ok: false, code: 'bad-request', message: 'body must be an object' } };
    }
    const { id, cwd, title } = body;
    // 输入校验：非法 → 400（400=来源可信但内容非法，403=来源不可信）
    if (!assertValidId(id)) return { status: 400, json: { ok: false, code: 'invalid-id', message: 'invalid id' } };
    if (cwd !== undefined && cwd !== null && typeof cwd !== 'string') {
      return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd' } };
    }
    if (title !== undefined && title !== null) {
      if (typeof title !== 'string' || title.length > 256) {
        return { status: 400, json: { ok: false, code: 'invalid-title', message: 'invalid title' } };
      }
    }

    // 定位 project 目录
    const proj = resolveProjectDir(env, cwd);
    if (proj.invalid) return { status: 400, json: { ok: false, code: 'invalid-cwd', message: 'invalid cwd' } };
    if (proj.notFound) return { status: 200, json: { ok: false, code: 'session-dir-not-found', message: 'project dir not found' } };

    // 越界判定 1：encodeSegment(id) !== id
    if (encodeSegmentId(id) !== id) {
      return { status: 200, json: { ok: false, code: 'path-out-of-bounds', message: 'id escapes segment encoding' } };
    }
    const targetDir = path.join(proj.projectDir, id);
    // 越界判定 2：目标目录必须在 sessionsRoot 前缀内（+ 不做任何移动）
    if (!path.resolve(targetDir).startsWith(path.resolve(env.sessionsRoot) + path.sep)) {
      return { status: 200, json: { ok: false, code: 'path-out-of-bounds', message: 'target outside sessions root' } };
    }

    // 运行中护栏：host 判定 live → 不移动（不只靠 client）
    if (env.ctx.sessions.get(id)) {
      return { status: 200, json: { ok: false, code: 'session-running', message: 'session is running' } };
    }

    // 源目录不存在且非幂等完成态 → session-dir-not-found
    if (!fs.existsSync(targetDir)) {
      // 幂等真值：目录已不在原位（例如上次已移走）→ 视为已完成
      if (fs.existsSync(path.join(env.trash.root, id))) {
        return doArchivedCleanup(id); // 已在回收站 → 幂等完成，补第二步
      }
      return { status: 200, json: { ok: false, code: 'session-dir-not-found', message: 'session dir not found' } };
    }

    // 整目录移入回收站（幂等真值 = 目录不在原位即已完成）
    try {
      moveToTrash(env, { id, originalDir: targetDir, projectKey: path.basename(proj.projectDir), title });
    } catch (err) {
      return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } };
    }

    // 若为归档会话（两步）：文件移动后再从 archivedSessionIds 移除 id
    return doArchivedCleanup(id);
  }

  // 删除归档会话的第二步：从归档集合移除 id；失败 → system-error（文件已移、集合待重试）
  function doArchivedCleanup(id) {
    const archived = env.workspace.archived();
    if (!archived.includes(id)) {
      // 非归档会话 / 早已移除：无需第二步 → 直接 ok（含幂等"早已完成"）
      return { status: 200, json: { ok: true } };
    }
    // 目标是归档会话：需要第二步清理归档集合（经 storageDomain 写，保留其在归档清理时的失败注入）
    const domain = env.ctx.storageDomain.get('workspace');
    if (domain === null) {
      // partial-failure：文件已移走，归档集合清理失败 → system-error（可重试补齐）
      return { status: 200, json: { ok: false, code: 'system-error', message: 'archive cleanup failed; file already moved, retry to complete' } };
    }
    try {
      domain.global.set({ ...env.workspace.read(), archivedSessionIds: archived.filter((x) => x !== id) });
      return { status: 200, json: { ok: true } };
    } catch (err) {
      return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } };
    }
  }

  // ---------- /sm/restore ----------
  function doRestore(req, body) {
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, json: { ok: false, code: 'bad-request', message: 'body must be an object' } };
    }
    const { id } = body;
    if (!assertValidId(id)) return { status: 400, json: { ok: false, code: 'invalid-id', message: 'invalid id' } };
    return restoreFromTrash(env, id);
  }

  // ---------- /sm/emptyTrash ----------
  function doEmptyTrash(req, body) {
    if (body === undefined || body === null || typeof body !== 'object' || body.confirm !== true) {
      return { status: 400, json: { ok: false, code: 'confirmation-required', message: 'confirm:true required' } };
    }
    // 删除回收站根下全部条目（不可撤销）
    try {
      const entries = fs.existsSync(env.trash.root)
        ? fs.readdirSync(env.trash.root).filter((f) => f !== '_metadata')
        : [];
      const failIds = env.cfg.state.emptyFailItems || new Set();
      for (const e of entries) {
        if (failIds.has(e)) throw new Error(`simulated rm failure on ${e}`);
        fs.rmSync(path.join(env.trash.root, e), { recursive: true, force: true });
      }
      // 清空记录
      for (const rec of env.trash.records()) env.trash.deleteRecord(rec.id);
      return { status: 200, json: { ok: true } };
    } catch (err) {
      return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } };
    }
  }

  // ---------- /sm/unarchive ----------
  function doUnarchive(req, body) {
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, json: { ok: false, code: 'bad-request', message: 'body must be an object' } };
    }
    const { id } = body;
    if (!assertValidId(id)) return { status: 400, json: { ok: false, code: 'invalid-id', message: 'invalid id' } };

    const domain = env.ctx.storageDomain.get('workspace');
    if (domain === null) {
      return { status: 200, json: { ok: false, code: 'workspace-domain-unavailable', message: 'workspace storage domain unavailable' } };
    }
    const archived = env.workspace.archived();
    if (!archived.includes(id)) {
      // 幂等 no-op：早已不在集合 → 直接 ok
      return { status: 200, json: { ok: true } };
    }
    try {
      const next = archived.filter((x) => x !== id);
      domain.global.set({ ...env.workspace.read(), archivedSessionIds: next });
      return { status: 200, json: { ok: true } };
    } catch (err) {
      return { status: 200, json: { ok: false, code: 'system-error', message: String(err) } };
    }
  }

  // ---------- /sm/trash ----------
  function doTrash(req) {
    return { status: 200, json: {
      ok: true,
      items: env.trash.records().map((r) => ({ id: r.id, title: r.title ?? undefined, deadline: r.deletedAt })),
    } };
  }

  return { handle };
}

// ---------- HTTP 服务器（真实 loopback，随机端口）----------
// 暴露 call(method, body, headersOverride)，模拟对 /sm/<method> 的 HTTP 请求。
function startServer(backend) {
  const server = http.createServer((req, res) => {
    const send = (r, status, json) => {
      r.writeHead(status, { 'content-type': 'application/json' });
      r.end(JSON.stringify(json));
    };
    // fetch 无法设置 Host/Origin/Sec-Fetch-Site 等受限头；测试用 `x-sm-test-headers` 携带这些
    // "信任属性"（HTTP 层用一个安全枚举头透传，服务器剥出作为 fence 判定依据），避免真的发受限头。
    // req.headers 仍含 node http 真实请求的 Host（loopback）。见 call()。
    let testHeaders = {};
    try {
      const raw = req.headers['x-sm-test-headers'];
      if (raw) testHeaders = JSON.parse(raw);
    } catch { testHeaders = {}; }
    req.headersAccess = testHeaders;
    req.smRealHeaders = req.headers;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let parsed;
      try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = '__BAD_JSON__'; }
      const m = req.url.match(/^\/sm\/([^/?#]+)/);
      const method = m ? m[1] : null;
      // 把原始 head（Host/Sec-Fetch-Site/Origin）透传给 backend 做 fence 判定
      const resp = backend.handle(method, req, parsed);
      // 非法 JSON → 400 统一约定
      if (parsed === '__BAD_JSON__') {
        send(res, 400, { ok: false, code: 'bad-request', message: 'invalid JSON' });
        return;
      }
      send(res, resp.status, resp.json);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port, address } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({
        base,
        close: () => new Promise((r) => server.close(r)),
        async call(method, body, headers = {}) {
          const url = `${base}/sm/${method}`;
          const hh = packRequestHeaders(headers);
          const fetchRes = await fetch(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: hh,
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const text = await fetchRes.text();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = { parseError: true, raw: text }; }
          return { status: fetchRes.status, json };
        },
        // 裸发原始 body（用于测"非法 JSON / 非对象"等无法被 JSON.stringify 表达的情形）
        async rawCall(method, rawBody, headers = {}) {
          const url = `${base}/sm/${method}`;
          const hh = packRequestHeaders(headers);
          const fetchRes = await fetch(url, {
            method: rawBody === undefined ? 'GET' : 'POST',
            headers: hh,
            body: rawBody,
          });
          const text = await fetchRes.text();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = { parseError: true, raw: text }; }
          return { status: fetchRes.status, json };
        },
      });
    });
  });
}

// ---------- 顶层测试上下文 ----------
// 每次 createTestContext() 建全新临时目录 + 全新 harness，互不共享，可任意顺序跑。
async function createTestContext(overrides = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sm-acc-'));
  const sessionsRoot = makeFakeSessionsRoot(tmpRoot);

  const cfg = {
    state: {
      liveIds: new Set(),
      domainUnavailable: false,
      storageWriteFail: false,
      emptyFailItems: new Set(), // 模拟 emptyTrash 时某些条目删除失败（system-error）
    },
  };
  const workspace = makeWorkspaceGlobal(tmpRoot, overrides.archived || []);
  const trash = makeTrashRoot(tmpRoot);
  const env = {
    tmpRoot,
    sessionsRoot,
    workspace,
    trash,
    cfg,
    projectCwdMap: overrides.projectCwdMap || {},
    ctx: null,
  };
  env.ctx = makeCtx(env);
  const backend = makeBackend(env);
  const server = await startServer(backend);

  const cleanup = () => fs.rmSync(tmpRoot, { recursive: true, force: true });

  return {
    ...env,
    server,
    cleanup,
    // 便捷：一条真会话
    newSession(projectKey, id, opts) { return makeFakeSession(sessionsRoot, projectKey, id, opts); },
    live(id, on) {
      if (on === undefined) on = true;
      if (on) cfg.state.liveIds.add(id); else cfg.state.liveIds.delete(id);
    },
    // 依赖不可用注入
    makeDomainUnavailable() { cfg.state.domainUnavailable = true; },
    makeStorageWriteFail() { cfg.state.storageWriteFail = true; },
    // emptyTrash 时让某条目删除失败（system-error 分支）
    makeEmptyFail(id) { cfg.state.emptyFailItems.add(id); },
    // 一个干净目录用 mkdtemp 独立于 sessions 之外（测路径越界）
  };
}

// 断言工具：HTTP 状态 + 对 200 响应的 `code`/`ok` 约定，全包在一个断言里，便于给测试员看失败点。
// 非 200（403/404 等）只断言状态码，不校验 body 的 ok 语义（该类响应本身不是 200 包裹）。
function assertCode(t, res, status, code) {
  t.assert.equal(res.status, status, `HTTP ${status} expected, got ${res.status} body=${JSON.stringify(res.json)}`);
  if (status !== 200) return;
  if (code !== null && code !== undefined) {
    t.assert.equal(res.json && res.json.ok, false, 'response must be ok:false on error');
    t.assert.equal(res.json && res.json.code, code, `code ${code} expected, got ${res.json && res.json.code}`);
  } else {
    t.assert.ok(res.json && res.json.ok === true, 'response must be ok:true');
  }
}

// 打包请求头：把影响信任 fence 判定的头（host/sec-fetch-site/origin）单独抽到 x-sm-test-headers
// （fetch 禁止客户端设置这些受限头），其余头照发。
function packRequestHeaders(headers = {}) {
  const authKeys = ['host', 'sec-fetch-site', 'origin'];
  const auth = {};
  const rest = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(headers)) {
    if (authKeys.includes(k.toLowerCase())) auth[k.toLowerCase()] = v;
    else rest[k] = v;
  }
  if (Object.keys(auth).length) rest['x-sm-test-headers'] = JSON.stringify(auth);
  return rest;
}

// 文件状态断言
export function exists(p) { return fs.existsSync(p); }

export {
  test, before, after,
  SESSION_MARKER, MARKER_CONTENT,
  makeFakeSessionsRoot, makeFakeSession, makeWorkspaceGlobal, makeTrashRoot,
  assertValidId, encodeSegmentId,
  createTestContext, assertCode,
  path, fs,
};
