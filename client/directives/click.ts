/**
 * adowire client — adowire:click directive
 *
 * Uses event delegation on `document` to intercept clicks on any element
 * carrying a `adowire:click` attribute, resolves the nearest [adowire:id] ancestor
 * component, parses the attribute value into a method name + params, and
 * commits the action to the server.
 *
 * Supported attribute value formats:
 *   "increment"           → { method: 'increment', params: [] }
 *   "addAmount(5)"        → { method: 'addAmount', params: [5] }
 *   "$set('count', 0)"   → { method: '$set', params: ['count', 0] }
 *   "save(true, 'foo')"  → { method: 'save', params: [true, 'foo'] }
 */

import type { WireClientComponent } from '../component.js'
import type { WireCall } from '../types.js'

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse the string value of a `adowire:click` (or similar) attribute into a
 * `WireCall` descriptor.
 *
 * Grammar handled (intentionally simple — not a full JS parser):
 *   expr      = ident | ident "(" arglist ")"
 *   ident     = [A-Za-z_$][A-Za-z0-9_$]*
 *   arglist   = arg ("," arg)*
 *   arg       = string | number | boolean | null | undefined
 *   string    = "'" … "'" | '"' … '"'
 */
export function parseActionExpression(expr: string): WireCall {
  const trimmed = expr.trim()

  // Fast-path: plain identifier with no parens → zero-arg method call.
  if (/^[\w$]+$/.test(trimmed)) {
    return { method: trimmed, params: [] }
  }

  // Match: methodName( ...args )
  const parenMatch = trimmed.match(/^([\w$]+)\s*\(([\s\S]*)\)\s*$/)
  if (!parenMatch) {
    // Fallback — treat the whole expression as a method name with no params.
    console.warn(
      `[adowire] adowire:click: could not parse expression "${expr}", treating as bare method name`
    )
    return { method: trimmed, params: [] }
  }

  const method = parenMatch[1]
  const rawArgs = parenMatch[2].trim()
  const params = rawArgs.length === 0 ? [] : parseArgList(rawArgs)

  return { method, params }
}

/**
 * Split a raw argument string (e.g. `'count', 0, true`) into individual
 * typed JS values. Handles quoted strings, numbers, booleans, null, and
 * undefined. Nested brackets / parentheses are NOT supported — the design
 * intentionally mirrors Livewire's adowire:click DSL which only accepts simple
 * literal arguments.
 */
function parseArgList(raw: string): any[] {
  const args: any[] = []

  // Tokenise respecting single- and double-quoted strings so commas inside
  // quotes don't split the argument.
  const tokens = tokeniseArgs(raw)

  for (const token of tokens) {
    args.push(coerceArg(token.trim()))
  }

  return args
}

/**
 * Split `raw` on top-level commas (i.e. commas not inside quotes).
 */
function tokeniseArgs(raw: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (const ch of raw) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
    } else if (ch === ',' && !inSingle && !inDouble) {
      tokens.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim().length > 0) {
    tokens.push(current)
  }

  return tokens
}

/**
 * Convert a raw token string to its JS primitive equivalent.
 */
function coerceArg(token: string): any {
  // Quoted string — strip quotes and unescape simple sequences.
  if (
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith('"') && token.endsWith('"'))
  ) {
    return token.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"')
  }

  if (token === 'true') return true
  if (token === 'false') return false
  if (token === 'null') return null
  if (token === 'undefined') return undefined

  // Numeric
  const num = Number(token)
  if (!Number.isNaN(num) && token.length > 0) return num

  // Fallback — return as-is string (e.g. unquoted identifiers)
  return token
}

// ─── Directive registration ───────────────────────────────────────────────────

/**
 * Attach the delegated `adowire:click` listener to `document`.
 * Safe to call multiple times — a guard flag prevents double-registration.
 */
let registered = false

export function registerClickDirective(): void {
  if (registered) return
  registered = true

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as Element | null
    if (!target) return

    // Walk up from the clicked element to find the closest adowire:click carrier.
    const actionEl = target.closest('[adowire\\:click]') as HTMLElement | null
    if (!actionEl) return

    const attrValue = actionEl.getAttribute('adowire:click')
    if (!attrValue) return

    // Resolve the owning component by walking up to the nearest [adowire:id].
    const componentEl = actionEl.closest('[adowire\\:id]') as HTMLElement | null
    if (!componentEl) {
      console.warn('[adowire] adowire:click: no parent [adowire:id] found for', actionEl)
      return
    }

    const componentId = componentEl.getAttribute('adowire:id')
    if (!componentId) return

    const component = window.Adowire?.components.get(componentId) as WireClientComponent | undefined

    if (!component) {
      console.warn(`[adowire] adowire:click: component "${componentId}" not found in registry`)
      return
    }

    // Parse and dispatch.
    const call = parseActionExpression(attrValue)

    void component.commit([call], {})
  })
}
