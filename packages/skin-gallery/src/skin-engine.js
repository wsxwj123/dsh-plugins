/**
 * skin-engine.js — browser 端皮肤加载/应用/互斥/卸载核心（无 React 依赖）。
 *
 * 皮肤 bundle 上游形态（见 skins/<id>/client.js）：`window.__ModuleLoader__.load({ id, factory })`。
 * 自定义皮肤：受控导入时用 validateCustomBundle（契约 + 高危能力静态校验）通过，随后以
 * registerCustomBundle 插进内部 manifest/bundles，走与内置皮肤完全相同的 activateSkin 链路。
 * 校验是「契约+黑名单第一道门」，运行时为 Blob-URL 经典脚本 + ctx.effect 可逆 + 引擎兜底
 * 快照，不替代浏览器自身安全边界（见 PLAN §5.2 诚实声明）。
 * 真实契约（对齐官方 dsh-client-modules）：
 *   - `__ModuleLoader__.load({ id, factory })` 只把 factory 注册进模块表；重复注册同一 id
 *     会抛错，所以同一 bundle 重新注册前必须 invalidate 该 id。
 *   - `__DSH_MODULES__.import(id)` 才对已注册 factory 做 materialize——此时才执行 factory 体
 *     （注入皮肤内置 `<style data-plugin>`），返回其 exports（含 `apply`）。
 *   - `__DSH_MODULES__.invalidate(id)` 删除 factory 与缓存，让同一 bundle 可再次注册。
 *
 * 本引擎按「构建期嵌入、运行期按需执行」实现：9 款 bundle 文本在 build.mjs 阶段内联进
 * lib/client.js（作为 __SKIN_BUNDLES__ 常量），运行期 activateSkin(id) 才取出目标文本，用
 * 可替换的 executeScript hook 注入为经典脚本执行其 `__ModuleLoader__.load`，随即 import 取
 * apply。不做无源动态 URL、不引入 unsafe-eval（默认走 Blob-URL 经典脚本，与 kernel
 * defaultLoadBundle 的同路径执行形态一致，仅 source 换成内联文本）。
 *
 * miniCtx 符合真实 Cordis effect 语义：effect(fn, label) 立即执行 fn 并把其返回的 disposer
 * 收起，皮肤卸载时按注册顺序逆序执行。皮肤 bundle 只消费 ctx.effect（9 款均已验证；
 * 若未来皮肤需要 theme/slots，须在 miniCtx 扩展注入，见 INTERFACE §4）。
 *
 * 引擎为无模块级可变全局的工厂：manifest/bundles/modules 全部经参数注入（构建期内联），
 * 使单测可零 DOM 或 stub 化执行。
 */

// ---- 受控导入：契约 + 高危能力静态校验（无 DOM，纯字符串分析）----

/** 自定义皮肤契约/高危错误 code（与 custom-skin.js 共享，见 INTERFACE §5）。 */
export const SKIN_VALIDATION_ERRORS = {
  CONTRACT: 'ERR_SKIN_CONTRACT',
  DANGEROUS: 'ERR_SKIN_DANGEROUS',
}

/**
 * 静态校验自定义皮肤 client.js 文本（契约 + 高危能力）。纯函数，不执行包内文字。
 * 校验策略见 PLAN §5.2：a) 契约合规（__ModuleLoader__.load + factory + 括号配平 + apply/ctx 白名单）
 * b) 高危能力黑名单。返回 true 表示通过；否则抛带 code 的错。
 * 顺序：契约结构 → 高危黑名单 → apply/ctx 白名单，以区分 C9（契约）与 C10（高危）。
 * 注：内部常量均为函数局部，避免与 custom-skin.js 内联进同一 scope 时标识符冲突。
 */
export function validateCustomBundle(clientText) {
  const CTX_WHITELIST = new Set(['effect', 'get'])
  const DANGEROUS_PATTERNS = [
    'eval(', 'new Function(', 'import(', 'require(', '<script src=',
    'fetch(', 'XMLHttpRequest(', 'WebSocket(', 'localStorage', 'sessionStorage',
    'document.cookie', 'chrome.runtime',
  ]
  const error = (code, message) => { const e = new Error(message); e.code = code; return e }
  const parenBalanced = (text) => {
    let depth = 0
    for (const ch of text) {
      if (ch === '(') depth++
      else if (ch === ')') { depth--; if (depth < 0) return false }
    }
    return depth === 0
  }

  if (typeof clientText !== 'string' || clientText.length === 0) {
    throw error(SKIN_VALIDATION_ERRORS.CONTRACT, 'client.js 为空或缺失')
  }
  // 1) 契约结构：必须注册 __ModuleLoader__.load({... factory ...}) 且括号配平。
  const hasLoader = clientText.includes('window.__ModuleLoader__.load({') && clientText.includes('factory')
  if (!hasLoader || !parenBalanced(clientText)) {
    throw error(SKIN_VALIDATION_ERRORS.CONTRACT, '缺失 __ModuleLoader__.load 契约或括号不配平')
  }
  // 2) 高危能力黑名单（前置：优先于 apply 结构，以区分 C10 与 C9）。
  for (const pat of DANGEROUS_PATTERNS) {
    if (clientText.includes(pat)) {
      throw error(SKIN_VALIDATION_ERRORS.DANGEROUS, `client.js 含高危能力: ${pat}`)
    }
  }
  // 3) apply 与 ctx 白名单：导出 apply，且只消费 ctx.effect / ctx.get。
  if (!/\bapply\s*(\{|:)/.test(clientText) && !/function\s+apply/.test(clientText)) {
    throw error(SKIN_VALIDATION_ERRORS.CONTRACT, 'client.js 未导出 apply')
  }
  const ctxRe = /ctx\.([A-Za-z_$][\w$]*)/g
  let m
  const badCtx = []
  while ((m = ctxRe.exec(clientText)) !== null) {
    if (!CTX_WHITELIST.has(m[1])) badCtx.push(m[1])
  }
  if (badCtx.length > 0) {
    throw error(SKIN_VALIDATION_ERRORS.CONTRACT, `apply 使用白名单外 ctx.${badCtx[0]}`)
  }
  return true
}

/** 创建皮肤引擎实例。 */
export function createSkinEngine({
  modules,
  manifest,
  bundles,
  executeScript,
  log = console,
}) {
  if (modules === undefined) throw new Error('[theme-gallery-skin] engine requires window.__DSH_MODULES__')
  if (!Array.isArray(manifest)) throw new Error('[theme-gallery-skin] engine requires manifest array')
  if (typeof bundles !== 'object' || bundles === null) throw new Error('[theme-gallery-skin] engine requires bundles map')
  const runScript = executeScript ?? defaultExecuteScript
  // 当前激活皮肤的副作用句柄集：package -> { dispose, bodyAttrs[], chrome[], styles[], original }
  const handles = new Map()
  let activePackage = null // 当前激活皮肤的 package id
  let snapshot = null // 切换前的 body 还原快照（兜底）

  /** 皮肤 apply 收到的 mini ctx；effect 符合真实 Cordis 语义。 */
  function miniCtx() {
    const disposers = []
    return {
      effect(fn, label) {
        // 真实 effect(fn, label)：立即执行 fn(dispose)，disposer 为 fn 返回值。
        let disposer = null
        if (typeof fn === 'function') {
          try { disposer = fn(() => {}) } catch (error) { log.warn?.('[theme-gallery-skin] effect fn threw', error) }
        }
        if (typeof disposer === 'function') disposers.push(disposer)
        // 返回可把该 disposer 从集合移除的函数（等价真实 cordis 的 disposer）。
        return () => {
          const idx = disposers.indexOf(disposer)
          if (idx >= 0) disposers.splice(idx, 1)
        }
      },
      get(name) {
        // 皮肤当前不依赖外部 service；扩展点见 INTERFACE §4。
        void name
        return undefined
      },
      _themeGalleryDisposeAll() {
        for (let i = disposers.length - 1; i >= 0; i--) {
          try { disposers[i]() } catch (error) { log.warn?.('[theme-gallery-skin] disposer threw', error) }
        }
        disposers.length = 0
      },
    }
  }

  /** 对条目做「加载 + 注册 + materialize」，拿到 apply。幂等：已激活同一条目时 no-op。 */
  async function loadSkin(entry) {
    if (activePackage === entry.package && handles.has(entry.package)) return
    const bundle = bundles[entry.id]
    if (typeof bundle !== 'string' || bundle.length === 0) {
      throw new Error(`[theme-gallery-skin] unknown-skin: ${entry.id} (no embedded bundle)`)
    }
    // 同一 bundle 重新注册前必须 invalidate，避免 __ModuleLoader__.load 抛 duplicate。
    try { modules.invalidate(entry.package) } catch { /* 未注册时 invalidate 无害 */ }
    await runScript(bundle)
    const apply = (await modules.import(entry.package)).apply
    if (typeof apply !== 'function') {
      throw new Error(`[theme-gallery-skin] "${entry.package}" client bundle exports no apply`)
    }
    return apply
  }

  return {
    /** 皮肤清单（构建期内联 manifest + 动态注册的自定义项，按 order 排序）。 */
    getSkins() { return manifest.slice().sort((a, b) => a.order - b.order) },

    /**
     * 动态注册一款自定义皮肤 bundle（受控导入通过后调用），走与内置相同的激活链路。
     * skin 形如 CustomSkinItem（含 id/name/author/accent/bodyAttr/order/bundleText/a11yText）；
     * package 用自定义皮肤 id，因为其 client.js 以 `load({ id: <皮肤id>, factory })` 注册。
     * 重新注册同 id 时先移旧项，避免 __ModuleLoader__ duplicate。
     */
    registerCustomBundle(skin) {
      if (!skin || typeof skin.id !== 'string' || typeof skin.bundleText !== 'string') {
        throw new Error('[theme-gallery-skin] registerCustomBundle: invalid custom skin')
      }
      const id = skin.id
      const pkg = skin.package || id
      bundles[id] = skin.bundleText
      const existing = manifest.findIndex((entry) => entry.id === id)
      const entry = {
        id,
        name: skin.name || id,
        nameEn: skin.nameEn || '',
        author: skin.author || '',
        tagline: skin.tagline || '',
        accent: skin.accent || '',
        bodyAttr: skin.bodyAttr || `data-dsh-${id}`,
        order: typeof skin.order === 'number' ? skin.order : 100 + manifest.length,
        package: pkg,
        license: skin.license || 'BSD-3-Clause',
        source: 'custom',
      }
      if (existing >= 0) manifest[existing] = entry
      else manifest.push(entry)
      return entry
    },

    /** 当前皮肤激活状态。 */
    currentSkinState() { return { skinId: currentSkinId(), active: activePackage !== null } },

    /**
     * 激活一款皮肤：加载 → apply → 记录副作用 → 触发 a11y（由调用方在 apply 后注入）。
     * 与 theme 轨道互斥由 client.js 协调；引擎只保证皮肤自身切换前完整卸载。
     */
    async activateSkin(entry, { afterApply } = {}) {
      const state = this.currentSkinState()
      if (state.skinId === entry.id && state.active && handles.has(entry.package)) {
        return this.currentSkinState() // 幂等 no-op
      }
      this.deactivateSkin()
      snapshot = captureSnapshot(entry)

      const ctx = miniCtx()
      try {
        const apply = await loadSkin.call(this, entry)
        apply(ctx)
        if (typeof afterApply === 'function') afterApply(entry, ctx)
      } catch (error) {
        restoreSnapshot(snapshot)
        snapshot = null
        ctx._themeGalleryDisposeAll()
        throw error
      }

      const packageId = entry.package
      // a11y style 由 afterApply 注入后，一并纳入本皮肤句柄以便卸载时移除。
      const a11yStyles = Array.from(document.querySelectorAll(`style[data-theme-gallery-a11y="${entry.id}"]`))
      // 皮肤内置 style（插件 css）：未打 a11y 标记、属于本 package 的注入。
      const skinStyles = []
      for (const el of Array.from(document.querySelectorAll(`style[data-plugin="${packageId}"]`))) {
        if (!el.hasAttribute('data-theme-gallery-a11y')) skinStyles.push(el)
      }
      const bodyAttrs = []
      if (entry.bodyAttr && document.body.hasAttribute(entry.bodyAttr)) bodyAttrs.push(entry.bodyAttr)
      const chrome = []
      for (const el of Array.from(document.body.children)) {
        if (el.id === 'root') continue
        if (el.hasAttribute('data-skin-chrome') || (entry.bodyAttr && el.hasAttribute(entry.bodyAttr))) {
          chrome.push(el)
        }
      }
      handles.set(packageId, {
        dispose: () => ctx._themeGalleryDisposeAll(),
        bodyAttrs,
        chrome,
        styles: skinStyles.concat(a11yStyles),
        entry,
      })
      activePackage = packageId
      return this.currentSkinState()
    },

    /** 同步卸载当前皮肤；可重复调用（第二次 no-op）。 */
    deactivateSkin() {
      if (activePackage === null) return
      // 1) 皮肤自带 disposer（miniCtx.effect 收集的清理函数）。
      const handle = handles.get(activePackage)
      if (handle !== undefined && typeof handle.dispose === 'function') handle.dispose()
      // 2) 兜底：逐项移除 body 属性 / chrome / 注入 style。
      if (snapshot !== null) restoreSnapshot(snapshot)
      for (const [, h] of handles) {
        for (const attr of h.bodyAttrs) document.body.removeAttribute(attr)
        for (const el of h.chrome) el.remove()
        for (const el of h.styles) el.remove()
      }
      // 3) 清掉模块表 factory/cache，使下次 activate 可重新注册。
      try { this.teardownBundles([handle ? handle.entry : null]) } catch {}
      handles.clear()
      activePackage = null
      snapshot = null
    },

    /** 插件停止时全量回收：卸载皮肤 + 清掉全部已注册皮肤 bundle。 */
    teardownSkins() {
      this.deactivateSkin()
      this.teardownBundles(manifest)
      for (const el of Array.from(document.querySelectorAll('style[data-theme-gallery-skin], style[data-theme-gallery-a11y]'))) {
        el.remove()
      }
    },

    /** 按条目集清掉模块表里的 factory/cache。 */
    teardownBundles(entries) {
      for (const entry of entries) {
        if (!entry) continue
        try { modules.invalidate(entry.package) } catch { /* 无害 */ }
      }
    },
  }

  function currentSkinId() {
    if (activePackage === null) return null
    const handle = handles.get(activePackage)
    return handle ? handle.entry.id : null
  }
}

/** 默认脚本注入：Blob-URL 经典脚本（自产、走真实模块系统，非无源 URL）。 */
async function defaultExecuteScript(code) {
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.async = true
      el.src = url
      el.dataset.themeGallerySkinBundle = 'true'
      el.addEventListener('load', () => { el.remove(); resolve() }, { once: true })
      el.addEventListener('error', () => { el.remove(); reject(new Error('[theme-gallery-skin] execute skin bundle failed')) }, { once: true })
      document.head.append(el)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 记录皮肤切换前的 body 还原快照（兜底）。 */
function captureSnapshot(entry) {
  const attrs = {}
  if (entry && entry.bodyAttr && document.body.hasAttribute(entry.bodyAttr)) {
    attrs[entry.bodyAttr] = document.body.getAttribute(entry.bodyAttr)
  }
  return { attrs, style: document.body.getAttribute('style') }
}

/** 还原 body 快照（只还原本皮肤可能改过的属性）。 */
function restoreSnapshot(snapshot) {
  if (!snapshot) return
  const body = document.body
  for (const [attr, value] of Object.entries(snapshot.attrs || {})) {
    if (value === null || value === undefined) body.removeAttribute(attr)
    else body.setAttribute(attr, value)
  }
  if (snapshot.style === null) body.removeAttribute('style')
  else if (typeof snapshot.style === 'string') body.setAttribute('style', snapshot.style)
}
