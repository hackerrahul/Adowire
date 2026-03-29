import 'reflect-metadata'
import { WIRE_TITLE_KEY } from '../types.js'

/**
 * @Title(text) — Page component browser title decorator.
 *
 * Sets the browser `<title>` for a page component. Works in two ways:
 *
 * 1. **Initial SSR** — The `$title` variable is passed to the layout template
 *    (from `@Layout`) so the `<title>` tag is populated in the server-rendered
 *    HTML before any JavaScript runs.
 *
 * 2. **AJAX updates** — The title string is included in `effects.title` of the
 *    server response so the client can update `document.title` after morphing.
 *
 * Usage:
 * ```ts
 * @Title('My Counter')
 * @Layout('layouts/adowire')
 * export default class Counter extends WireComponent { ... }
 * ```
 *
 * @param text  The browser tab title text.
 */
export function Title(text: string) {
  return function (target: Function) {
    Reflect.defineMetadata(WIRE_TITLE_KEY, text, target.prototype)
  }
}
