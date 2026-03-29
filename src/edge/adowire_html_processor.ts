/**
 * adowire — HTML-style component tag preprocessor
 *
 * Transforms <adowire:*> HTML-style tags into their @adowire() / @end Edge
 * tag equivalents before Edge.js compiles the template.
 *
 * Registered as an edge.processor 'raw' handler so it runs on every
 * template string — both file-based templates and renderRaw() calls.
 *
 * Supported syntaxes:
 *
 *   Self-closing (most common):
 *     <adowire:counter />
 *     <adowire:post.create />
 *     <adowire:pages::dashboard />
 *     <adowire:counter title="Hello" :count="$count" />
 *     <adowire:dynamic-component :is="$tabName" />
 *
 *   Block form (for slots — future use):
 *     <adowire:counter title="Hello">
 *       ... slot content ...
 *     </adowire:counter>
 *
 * Props mapping:
 *   Static:   title="Hello"           → title: 'Hello'
 *   Dynamic:  :count="$count"         → count: $count
 *   Boolean:  disabled                → disabled: true
 *   kebab:    initial-count="5"       → initialCount: '5'
 *   Dynamic:  :initial-count="$n"     → initialCount: $n
 *   Special:  :is="$expr" (on dynamic-component) → uses $expr as component name
 *
 * @module
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single parsed HTML attribute produced by the character-by-character parser.
 */
interface ParsedAttr {
  /** The attribute name, stripped of the leading `:` for dynamic attrs. */
  name: string
  /** The attribute value, or `null` for boolean attributes (no `=`). */
  value: string | null
  /** True when the original attribute had a `:` prefix (dynamic binding). */
  isDynamic: boolean
}

// ─── toCamelCase ─────────────────────────────────────────────────────────────

/**
 * Converts a kebab-case attribute name to camelCase.
 *
 * @example
 *   toCamelCase('initial-count') // → 'initialCount'
 *   toCamelCase('my-prop-name')  // → 'myPropName'
 *   toCamelCase('count')         // → 'count'  (no change)
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_: string, char: string) => char.toUpperCase())
}

// ─── parseAttrsList — internal character-by-character state machine ───────────

/**
 * Parses an HTML attribute string character-by-character and returns a list of
 * `ParsedAttr` objects. Using a state machine (rather than a regex) correctly
 * handles attribute values that contain spaces, single quotes inside
 * double-quoted values, and other edge cases.
 *
 * Recognised attribute forms:
 *   - Static:       `title="Hello"`
 *   - Dynamic:      `:count="$count"`
 *   - Single-quoted: `title='Hello'`
 *   - Boolean:      `disabled`
 *   - Unquoted:     `count=5`
 *
 * @internal
 */
function parseAttrsList(attrString: string): ParsedAttr[] {
  const attrs: ParsedAttr[] = []
  const len = attrString.length
  let i = 0

  // ── Parser states ──────────────────────────────────────────────────────────
  type State =
    | 'IDLE' //         between attributes, consuming whitespace
    | 'IN_NAME' //      reading the attribute name
    | 'AFTER_NAME' //   name complete, waiting for '=' or next attribute
    | 'AFTER_EQ' //     saw '=', waiting for opening quote / value
    | 'IN_VAL_DOUBLE' // inside "..."
    | 'IN_VAL_SINGLE' // inside '...'
    | 'IN_VAL_UNQUOTED' // unquoted value (read until whitespace)

  let state: State = 'IDLE'

  /** Accumulated attribute name characters. */
  let curName = ''
  /** Accumulated attribute value characters. */
  let curValue = ''
  /** Whether the current attribute was prefixed with `:` (dynamic binding). */
  let isDynamic = false

  /** Returns true for ASCII whitespace characters. */
  const isWS = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r'

  /**
   * Finalise the current attribute and push it onto the list, then reset
   * the accumulator variables for the next attribute.
   */
  function flushAttr(value: string | null): void {
    if (curName) {
      attrs.push({ name: curName, value, isDynamic })
    }
    curName = ''
    curValue = ''
    isDynamic = false
  }

  while (i < len) {
    const ch = attrString[i]

    switch (state) {
      // ── IDLE: skip whitespace, then start a new attribute name ─────────────
      case 'IDLE':
        if (isWS(ch)) {
          i++
        } else if (ch === ':') {
          // Leading ':' means this is a dynamic (bound) attribute
          isDynamic = true
          state = 'IN_NAME'
          i++
        } else {
          curName += ch
          state = 'IN_NAME'
          i++
        }
        break

      // ── IN_NAME: accumulate name until '=', whitespace, or end ─────────────
      case 'IN_NAME':
        if (ch === '=') {
          state = 'AFTER_EQ'
          i++
        } else if (isWS(ch)) {
          // Name is complete but we haven't seen '=' yet; may be boolean
          state = 'AFTER_NAME'
          i++
        } else {
          curName += ch
          i++
        }
        break

      // ── AFTER_NAME: name done, check for '=' or next attribute ─────────────
      case 'AFTER_NAME':
        if (ch === '=') {
          state = 'AFTER_EQ'
          i++
        } else if (isWS(ch)) {
          // Keep consuming whitespace
          i++
        } else {
          // No '=' found → flush as a boolean attribute, then start next
          flushAttr(null)
          state = 'IN_NAME'
          if (ch === ':') {
            isDynamic = true
          } else {
            curName += ch
          }
          i++
        }
        break

      // ── AFTER_EQ: saw '=', determine value style ───────────────────────────
      case 'AFTER_EQ':
        if (ch === '"') {
          state = 'IN_VAL_DOUBLE'
          i++
        } else if (ch === "'") {
          state = 'IN_VAL_SINGLE'
          i++
        } else if (isWS(ch)) {
          // Unusual but tolerate whitespace between '=' and value
          i++
        } else {
          // Unquoted value
          curValue += ch
          state = 'IN_VAL_UNQUOTED'
          i++
        }
        break

      // ── IN_VAL_DOUBLE: accumulate until closing '"' ─────────────────────────
      case 'IN_VAL_DOUBLE':
        if (ch === '"') {
          flushAttr(curValue)
          state = 'IDLE'
          i++
        } else {
          curValue += ch
          i++
        }
        break

      // ── IN_VAL_SINGLE: accumulate until closing "'" ─────────────────────────
      case 'IN_VAL_SINGLE':
        if (ch === "'") {
          flushAttr(curValue)
          state = 'IDLE'
          i++
        } else {
          curValue += ch
          i++
        }
        break

      // ── IN_VAL_UNQUOTED: accumulate until whitespace ────────────────────────
      case 'IN_VAL_UNQUOTED':
        if (isWS(ch)) {
          flushAttr(curValue)
          state = 'IDLE'
          i++
        } else {
          curValue += ch
          i++
        }
        break
    }
  }

  // ── Flush any attribute that was still being assembled at end-of-input ─────
  if (state === 'IN_NAME' || state === 'AFTER_NAME') {
    // Boolean attribute — no value
    flushAttr(null)
  } else if (state === 'IN_VAL_UNQUOTED') {
    // Unquoted value that ran to end of string
    flushAttr(curValue)
  } else if ((state === 'IN_VAL_DOUBLE' || state === 'IN_VAL_SINGLE') && curName) {
    // Unterminated quoted value — flush what we have
    flushAttr(curValue)
  }

  return attrs
}

// ─── parseAttrsToProps ────────────────────────────────────────────────────────

/**
 * Parses an HTML attribute string and converts it into two pieces of
 * information needed by `buildAdowireCall`:
 *
 *  - `props`  — A JavaScript object-literal string suitable for use as the
 *               second argument to `@adowire(name, props)`.
 *  - `isExpr` — When the attribute `:is="<expr>"` is present (on a
 *               `<adowire:dynamic-component>` tag), this holds the raw
 *               JS expression string so the component name can be dynamic.
 *               `null` when no `:is` attribute was found.
 *
 * Attribute-to-prop mapping rules:
 *   - Static   `title="Hello"`    → `title: 'Hello'`
 *   - Dynamic  `:count="$count"`  → `count: $count`
 *   - Boolean  `disabled`         → `disabled: true`
 *   - Kebab    `initial-count="5"` → `initialCount: '5'`
 *   - Kebab+Dyn `:initial-count="$n"` → `initialCount: $n`
 *   - Special  `:is="$expr"`      → consumed as `isExpr`, not added to props
 *
 * Uses a character-by-character state machine internally — not a regex — so
 * attribute values containing spaces, `>`, or mismatched quotes are handled
 * reliably.
 *
 * @param attrString  Raw attribute section from the HTML tag (everything
 *                    between the component name and the closing `>` / `/>`).
 */
export function parseAttrsToProps(attrString: string): { props: string; isExpr: string | null } {
  const attrs = parseAttrsList(attrString.trim())

  let isExpr: string | null = null
  const propParts: string[] = []

  for (const attr of attrs) {
    const camelName = toCamelCase(attr.name)

    // `:is="$expr"` on <adowire:dynamic-component> sets the component name
    if (attr.isDynamic && attr.name === 'is') {
      isExpr = attr.value ?? 'undefined'
      continue
    }

    if (attr.value === null) {
      // Boolean attribute: `disabled` → `disabled: true`
      propParts.push(`${camelName}: true`)
    } else if (attr.isDynamic) {
      // Dynamic attribute: `:count="$count"` → `count: $count`
      // The value is a raw JS expression — emit it verbatim.
      propParts.push(`${camelName}: ${attr.value}`)
    } else {
      // Static attribute: `title="Hello"` → `title: 'Hello'`
      // Escape backslashes then single quotes so the output is valid JS.
      const escaped = attr.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      propParts.push(`${camelName}: '${escaped}'`)
    }
  }

  const props = propParts.length > 0 ? `{ ${propParts.join(', ')} }` : '{}'
  return { props, isExpr }
}

// ─── buildAdowireCall ─────────────────────────────────────────────────────────

/**
 * Builds the `@adowire(...)` / `@end` call string that replaces an
 * `<adowire:*>` HTML tag in the template source.
 *
 * @param tagName     The component name extracted from the HTML tag,
 *                    e.g. `'counter'`, `'post.create'`, `'dynamic-component'`.
 * @param attrString  The raw attribute string from the HTML tag.
 * @param content     Optional inner content for block-form tags. When present
 *                    (even if an empty string), the content is emitted between
 *                    the opening `@adowire(...)` call and `@end`.
 *
 * @example
 *   // Self-closing — no content
 *   buildAdowireCall('counter', 'title="Hello" :count="$n"')
 *   // → "@adowire('counter', { title: 'Hello', count: $n })\n@end"
 *
 *   // Dynamic component — :is overrides the name
 *   buildAdowireCall('dynamic-component', ':is="$tab"')
 *   // → "@adowire($tab)\n@end"
 *
 *   // Block form — content between tags
 *   buildAdowireCall('modal', 'title="Hi"', '  <p>slot</p>')
 *   // → "@adowire('modal', { title: 'Hi' })\n  <p>slot</p>\n@end"
 */
export function buildAdowireCall(tagName: string, attrString: string, content?: string): string {
  const { props, isExpr } = parseAttrsToProps(attrString)

  // When `:is="$expr"` is present the component name is dynamic.
  const nameExpr = isExpr !== null ? isExpr : `'${tagName}'`

  // Omit the props argument entirely when no attributes were provided so the
  // generated call is as clean as possible: @adowire('counter') not
  // @adowire('counter', {})
  const propsStr = props !== '{}' ? `, ${props}` : ''

  const tagCall = `@adowire(${nameExpr}${propsStr})`

  if (content !== undefined) {
    return `${tagCall}\n${content}\n@end`
  }

  return `${tagCall}\n@end`
}

// ─── Regex constants ──────────────────────────────────────────────────────────

/**
 * Attribute segment pattern.
 *
 * Matches the body of HTML attributes, including quoted values that may
 * contain `>` characters. Uses three alternatives:
 *   - `[^>"'/]`  — any character that is NOT `>`, `"`, `'`, or `/`
 *   - `"[^"]*"`  — a complete double-quoted string (values may contain `>`)
 *   - `'[^']*'`  — a complete single-quoted string
 *
 * Deliberately excludes `/` from the first alternative so the pattern stops
 * before the `/>` that terminates a self-closing tag.
 */
const ATTR_SEGMENT = `(?:[^>"'/]|"[^"]*"|'[^']*')*`

/**
 * Component name pattern.
 *
 * Allows word characters (`\w`), dots (`.`), colons (`:`), and hyphens (`-`).
 * Anchored to start with a word character or dot to avoid matching tags that
 * begin with a punctuation character.
 *
 * Valid examples: `counter`, `post.create`, `pages::dashboard`,
 *                 `admin::users.table`, `dynamic-component`
 */
const COMPONENT_NAME = `[\\w.][\\w.:-]*`

/**
 * Regex for self-closing adowire tags:
 *   `<adowire:counter title="Hi" />`
 *
 * Capture groups:
 *   1 — component name
 *   2 — attribute string (may be empty)
 */
const SELF_CLOSING_RE = new RegExp(`<adowire:(${COMPONENT_NAME})\\s*(${ATTR_SEGMENT})\\s*\\/>`, 'g')

/**
 * Regex for block-form adowire tags:
 *   `<adowire:counter title="Hi">CONTENT</adowire:counter>`
 *
 * Capture groups:
 *   1 — component name (also back-referenced in the closing tag via `\1`)
 *   2 — attribute string (may be empty)
 *   3 — inner content (non-greedy, may span multiple lines)
 *
 * The `\1` back-reference in the closing-tag pattern ensures the closing tag
 * matches the exact name captured in group 1, so `<adowire:a>` cannot be
 * accidentally closed by `</adowire:b>`.
 *
 * Note: for deeply nested block tags of the same name, the processor iterates
 * until no further replacements can be made so that inner blocks are expanded
 * first. See `adowireHtmlProcessor`.
 */
const BLOCK_RE = new RegExp(
  `<adowire:(${COMPONENT_NAME})\\s*(${ATTR_SEGMENT})>([\\s\\S]*?)<\\/adowire:\\1>`,
  'g'
)

// ─── adowireHtmlProcessor ─────────────────────────────────────────────────────

/**
 * Edge.js `raw` processor that transforms `<adowire:*>` HTML-style tags into
 * `@adowire(...)` / `@end` Edge tag calls **before** Edge.js compiles the
 * template.
 *
 * This function is exported as a **named** function so that Edge.js's internal
 * `Set`-based deduplication works correctly: two calls to
 * `edge.processor.process('raw', adowireHtmlProcessor)` pass the same function
 * reference, and the `Set` silently discards the duplicate registration.
 *
 * The function mutates `value.raw` **in place** and intentionally returns
 * `void` — Edge.js v6 raw processors MUST NOT return a value.
 *
 * Processing order:
 *   1. **Self-closing pass** — `<adowire:NAME ATTRS />` → `@adowire(NAME, PROPS)\n@end`
 *   2. **Block pass** (iterative) — `<adowire:NAME ATTRS>CONTENT</adowire:NAME>`
 *      → `@adowire(NAME, PROPS)\nCONTENT\n@end`
 *      Runs in a loop so that nested block tags are expanded from innermost
 *      outward; each iteration reduces the nesting depth by one.
 *
 * @param value  The mutable processor value object supplied by Edge.js.
 *               `value.path` is the template file path (may be empty for
 *               inline strings). `value.raw` is the raw template source.
 */
export function adowireHtmlProcessor(value: { path: string; raw: string }): void {
  // Fast-path: skip templates that contain no adowire HTML tags at all.
  if (!value.raw.includes('<adowire:')) return

  let html = value.raw

  // ── Pass 1: Self-closing tags ─────────────────────────────────────────────
  //
  //   <adowire:counter title="Hello" :count="$n" />
  //   → @adowire('counter', { title: 'Hello', count: $n })
  //     @end
  //
  // Self-closing tags are processed first so their `/>`-terminated form is
  // not accidentally matched by the block-tag pattern in the next pass.
  html = html.replace(SELF_CLOSING_RE, (_match: string, tagName: string, attrs: string): string =>
    buildAdowireCall(tagName, attrs)
  )

  // ── Pass 2: Block tags (iterative for nested structures) ──────────────────
  //
  //   <adowire:modal title="Hi">CONTENT</adowire:modal>
  //   → @adowire('modal', { title: 'Hi' })
  //     CONTENT
  //     @end
  //
  // We iterate until the template stabilises so that nested block tags of the
  // same or different component names are fully expanded. On each iteration
  // the regex (which uses a non-greedy `[\s\S]*?` for content) finds the
  // innermost remaining match first, so nesting depth decreases by one per
  // iteration — typically this loop runs only once or twice.
  let prev: string
  do {
    prev = html
    html = html.replace(
      BLOCK_RE,
      (_match: string, tagName: string, attrs: string, content: string): string =>
        buildAdowireCall(tagName, attrs, content)
    )
  } while (html !== prev)

  value.raw = html
}
