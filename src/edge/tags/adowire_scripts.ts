/**
 * adowire — @adowireScripts tag
 *
 * Outputs the Alpine.js CDN script and the adowire wire.js client script.
 *
 * Usage in Edge templates:
 *   @adowireScripts
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

export const adowireScriptsTag: TagContract = {
  tagName: 'adowireScripts',

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
   * Compile-time handler: emit raw HTML script tags.
   */
  compile(_parser, buffer, token) {
    // Emit a <meta> tag whose content is filled at render-time from the
    // `csrfToken` global that @adonisjs/shield injects into every Edge
    // template.  The client reads this meta tag to attach the token as an
    // X-CSRF-TOKEN header on every commit POST request.
    buffer.outputRaw('<meta name="csrf-token" content="')
    buffer.outputExpression('state.csrfToken || ""', token.filename, token.loc.start.line, false)
    buffer.outputRaw('">\n')

    const html = [
      '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>',
      '<script src="/adowire/adowire.js" defer></script>',
    ].join('\n')

    buffer.outputRaw(html)
  },
}
