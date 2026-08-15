/**
 * Ambient type for the platform-external `dsh-client-ui-primitives` module.
 *
 * `writeClipboard` is a platform external (CLIENT_EXTERNALS in
 * tsdown.config.mjs): at bundle time the import specifier is left as-is and
 * resolves through the web shell's frozen module table at runtime — it never
 * lands inside this client bundle, so the purity gate stays happy. The types
 * themselves are not installed under this package's node_modules, so we
 * declare just the one member we touch (the real signature, from
 * ui-primitives `lib/index.js`).
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** Copies `text` to the clipboard; resolves true only when the host accepted. */
  export function writeClipboard(text: string): Promise<boolean>
}
