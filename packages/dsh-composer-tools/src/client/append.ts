/**
 * 提示词追加（INTERFACE §2.5，纯函数）。
 *
 * 从提示词库选中的 prompt 追加到当前草稿：空输入直接放；已以 \n\n 结尾不重复补；
 * 以单个 \n 结尾补一个 \n；其余先补一个空行（\n\n）再追加。永不覆盖、永不自动发送。
 */
export function appendPromptToDraft(current: string, prompt: string): string {
  if (current === '') return prompt
  if (current.endsWith('\n\n')) return current + prompt
  if (current.endsWith('\n')) return current + '\n' + prompt
  return current + '\n\n' + prompt
}
