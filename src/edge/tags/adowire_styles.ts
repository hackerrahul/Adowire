/**
 * adowire — @adowireStyles tag
 *
 * Outputs a placeholder comment (and later a <link> tag) for adowire CSS.
 *
 * Usage in Edge templates:
 *   @adowireStyles
 *
 * Edge.js v6 tag contract:
 *   block    = false  → no @end closing tag
 *   seekable = false  → no arguments accepted
 */

/**
 * Minimal inline shape of an Edge.js v6 TagContract.
 * We avoid importing from 'edge.js/types' because edge.js is a peer
 * dependency that may not be installed in the package's own node_modules.
 */
interface TagContract {
  tagName: string
  block: boolean
  seekable: boolean
  noNewLine: boolean
  compile(parser: any, buffer: any, token: any): void
}

export const adowireStylesTag: TagContract = {
  tagName: 'adowireStyles',

  /**
   * Not a block tag — no @end required.
   */
  block: false,

  /**
   * Does not accept arguments.
   */
  seekable: false,

  /**
   * No newline emitted after the tag.
   */
  noNewLine: true,

  /**
   * Compile-time handler: emit a raw HTML comment as a write() call.
   * Currently a placeholder — no CSS assets are bundled yet.
   */
  compile(_parser, buffer, _token) {
    // The adowire:cloak rule must be in the <head> from first paint so that
    // elements with adowire:cloak are hidden immediately — before any JavaScript
    // runs. Without this, there is a visible flash between first paint and the
    // point where initCloak() injects the rule via JS.
    //
    // The style tag carries id="adowire-cloak-style" so that initCloak() (which
    // also injects this rule as a fallback) detects it and skips the injection,
    // avoiding duplicate style tags.
    buffer.outputRaw(
      '<style id="adowire-cloak-style">[adowire\\:cloak]{display:none!important}</style>'
    )
  },
}
