// 被测对象接线点。默认跑参考桩（harness）；04 之后把真实实现映射到同一组函数即可，
// 断言一行都不用改。接线方法：
//   APPEARANCE_SUBJECT=real node --test tests/acceptance/appearance-gallery
// 并在下面 'real' 分支里 import packages/appearance-gallery/src/acceptance-api.mjs，
// 用它的 createThemeAcceptanceApi / createSkinAcceptanceApi / memoryStorage 组出同形状对象。
export const SUBJECT = process.env.APPEARANCE_SUBJECT || 'harness';

export async function createSubject(opts = {}) {
  if (SUBJECT === 'harness') {
    const { createHarness } = await import('./harness.mjs');
    return createHarness(opts);
  }
  throw new Error(
    `未接线的 subject「${SUBJECT}」。请在 tests/acceptance/appearance-gallery/helpers/subject.mjs 里，`
    + '把 packages/appearance-gallery 的真实入口映射为 createHarness 返回的同一组字段'
    + '（storage / dom / slotCalls / themeApi / customSkinApi / skinRuntime / surface / start / entry）。',
  );
}
