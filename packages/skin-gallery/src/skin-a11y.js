/**
 * skin-a11y.js — 可访问性修正层（每皮肤增量 override CSS）。
 *
 * 目的：只修正「对比度不可读」，不改坏皮肤观感、不改布局/尺寸/动画。
 * 策略：在皮肤注入的内置 `<style>` 之后追加一块 `body[data-dsh-<id>]`（含
 * `[data-ds-dark-theme]` 变体）作用域的高优先 override（带 !important 保险，
 * 后定义者胜），逐皮肤按亮/暗两态给定「对比达标」的前景/背景 token。
 *
 * 注入顺序（INTERFACE §4.4）：apply(skin) → 皮肤内置 CSS → injectA11y 追加在后 →
 * 同优先级后定义者胜（!important 兜底）。卸载皮肤时本层 style 一并移除。
 *
 * 降级语义（INTERFACE §3.3）：a11y.css 缺失或解析失败 → 仅日志
 * `[theme-gallery-a11y] <id>: <reason>`，不影响皮肤本体加载。
 *
 * 数据经构建期内联（__SKIN_A11Y__: { [skinId]: cssText }），引擎为无全局可变状态的工厂。
 */

/** 创建 a11y 注入器。 */
export function createA11yInjector({ a11y, log = console }) {
  if (typeof a11y !== 'object' || a11y === null) throw new Error('[theme-gallery-a11y] requires a11y map')

  /** 注入某皮肤的 a11y override；返回对应 `<style>` 元素（供卸载时移除）。 */
  const inject = (skinId) => {
    const cssText = a11y[skinId]
    if (typeof cssText !== 'string' || cssText.length === 0) {
      log.warn?.(`[theme-gallery-a11y] ${skinId}: missing a11y.css — skin body still usable (no contrast fix)`)
      return null
    }
    // 幂等：同一皮肤不重复注入。
    let tag = document.querySelector(`style[data-theme-gallery-a11y="${skinId}"]`)
    if (tag !== null) return tag
    tag = document.createElement('style')
    tag.setAttribute('data-theme-gallery-a11y', skinId)
    tag.setAttribute('data-theme-gallery-skin', '')
    tag.textContent = cssText
    document.head.appendChild(tag)
    return tag
  }

  /** 卸载某皮肤的 a11y style（幂等）。 */
  const remove = (skinId) => {
    if (typeof document === 'undefined') return
    for (const el of Array.from(document.querySelectorAll(`style[data-theme-gallery-a11y="${skinId}"]`))) el.remove()
  }

  return { inject, remove }
}
