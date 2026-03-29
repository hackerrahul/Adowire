import 'reflect-metadata'
import { WIRE_LAYOUT_KEY } from '../types.js'

/**
 * @Layout(viewName, opts?) — Page component decorator.
 *
 * Marks a WireComponent as a full-page component and specifies the Edge layout
 * template that should wrap its rendered output on the initial page request.
 *
 * The layout template receives two variables:
 *   - `$body`  — the rendered component HTML (unescaped, use {{{ $body }}})
 *   - `$title` — the string from @Title, or null if not set
 *
 * Example layout template (`resources/views/layouts/adowire.edge`):
 * ```html
 * <!DOCTYPE html>
 * <html>
 *   <head>
 *     <title>{{ $title ?? 'My App' }}</title>
 *     @!adowireStyles()
 *   </head>
 *   <body>
 *     {{{ $body }}}
 *     @!adowireScripts()
 *   </body>
 * </html>
 * ```
 *
 * Usage:
 * ```ts
 * @Layout('layouts/adowire')
 * export default class Counter extends WireComponent { ... }
 *
 * @Layout('layouts/adowire', { slot: 'main' })
 * export default class PostIndex extends WireComponent { ... }
 * ```
 *
 * On initial SSR (via the @adowire Edge tag) the component HTML is wrapped inside
 * the layout template automatically. On subsequent AJAX updates the layout is
 * already on the page — only the inner component HTML is returned.
 *
 * @param name  Edge view name of the layout template (e.g. `layouts/adowire`)
 * @param opts  Optional `slot` name (default: `'main'`) — reserved for future
 *              named-slot support; currently the layout uses `{{{ $body }}}`.
 */
export function Layout(name: string, opts?: { slot?: string }) {
  return function (target: Function) {
    const meta = { name, slot: opts?.slot ?? 'main' }
    Reflect.defineMetadata(WIRE_LAYOUT_KEY, meta, target.prototype)
  }
}
