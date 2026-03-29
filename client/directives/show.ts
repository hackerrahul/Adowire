/**
 * adowire client — adowire:show directive
 *
 * Shows or hides elements based on a JavaScript expression evaluated against
 * the component's server-confirmed snapshot state.
 *
 * This is the adowire equivalent of Livewire's `wire:show` directive. It is
 * most useful in combination with `adowire:cloak` to prevent a flash of the
 * wrong visible/hidden state before the component boots on the client.
 *
 * Supported usage:
 *
 *   adowire:show="starred"            — visible when `starred` is truthy
 *   adowire:show="!starred"           — visible when `starred` is falsy
 *   adowire:show="count > 0"          — visible when `count > 0`
 *   adowire:show="status === 'active'" — visible when `status` equals 'active'
 *
 * Combined with adowire:cloak (mirrors Livewire's wire:show + wire:cloak):
 *
 *   <div adowire:show="starred"  adowire:cloak>⭐ Starred</div>
 *   <div adowire:show="!starred" adowire:cloak>☆ Not starred</div>
 *
 *   Without adowire:cloak both elements would be visible for a brief moment
 *   on page load before adowire evaluates the expression and hides the wrong
 *   one. Cloaking keeps both hidden until the component has booted and the
 *   correct element has been revealed.
 *
 * Expression evaluation:
 *   Expressions are evaluated using `new Function()` with each snapshot
 *   property injected as a local variable. Expressions are developer-authored
 *   (server-rendered template attributes), so this is safe in the same way
 *   that any server-rendered JS attribute is safe.
 *
 * Public API
 * ──────────
 *   initShow()        — evaluate all adowire:show elements on the page once
 *                       at boot (call before uncloakAll so elements are in the
 *                       right state when the cloak is removed)
 *   applyShowState()  — re-evaluate all adowire:show elements; call after each
 *                       successful server round-trip
 */

// ─── CSS selector ─────────────────────────────────────────────────────────────

/** All elements that declare a show/hide expression. */
const SEL_SHOW = '[adowire\\:show]'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the snapshot state for a component root element.
 *
 * Prefers the live in-memory snapshot from the Adowire component registry so
 * that post-response evaluations always see the freshest data. Falls back to
 * parsing the `adowire:snapshot` DOM attribute for the initial boot evaluation
 * that runs before components have been mounted.
 */
function getSnapshotState(root: HTMLElement): Record<string, any> | null {
  const id = root.getAttribute('adowire:id')

  // Live registry lookup (available after Adowire.init() has run).
  if (id && typeof window !== 'undefined' && (window as any).Adowire) {
    const component = (window as any).Adowire.find(id)
    if (component?.snapshot?.state) {
      return component.snapshot.state
    }
  }

  // Fallback: parse from the server-rendered DOM attribute (available before init).
  const raw = root.getAttribute('adowire:snapshot')
  if (!raw) return null
  try {
    const snapshot = JSON.parse(raw)
    return snapshot.state ?? null
  } catch {
    return null
  }
}

/**
 * Evaluate a simple JS expression string against a snapshot state object.
 *
 * Each top-level key of `state` is injected as a named parameter so that
 * expressions like `starred`, `!starred`, `count > 0`, or
 * `status === 'active'` can reference component properties directly.
 *
 * @returns The boolean result of the expression, or `false` on error.
 */
function evaluateExpression(expr: string, state: Record<string, any>): boolean {
  try {
    const keys = Object.keys(state)
    const values = keys.map((k) => state[k])

    const fn = new Function(...keys, `return !!(${expr})`)
    return fn(...values) as boolean
  } catch {
    console.warn(`[adowire] adowire:show: could not evaluate expression "${expr}"`)
    return false
  }
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Evaluate every `adowire:show` element within a single component root and
 * set its `display` style accordingly.
 */
function applyShowToRoot(root: HTMLElement): void {
  const state = getSnapshotState(root)
  if (!state) return

  const els = root.querySelectorAll<HTMLElement>(SEL_SHOW)
  for (const el of els) {
    const expr = el.getAttribute('adowire:show')
    if (!expr) continue

    const visible = evaluateExpression(expr, state)
    el.style.display = visible ? '' : 'none'
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate all `adowire:show` expressions on the page once at boot time.
 *
 * Must be called BEFORE `uncloakAll()` / `uncloakComponent()` so that elements
 * are already in the correct visible/hidden state when the cloak attribute is
 * removed. This prevents any flash of the wrong state.
 *
 * The snapshot state is read directly from the `adowire:snapshot` DOM attribute
 * so this works even before `Adowire.init()` has mounted the components.
 */
export function initShow(): void {
  const roots = document.querySelectorAll<HTMLElement>('[adowire\\:id]')
  for (const root of roots) {
    applyShowToRoot(root)
  }
}

/**
 * Re-evaluate all `adowire:show` expressions after a server round-trip.
 *
 * Called automatically after each successful commit so that show/hide state
 * stays in sync with the updated snapshot.
 */
export function applyShowState(): void {
  const roots = document.querySelectorAll<HTMLElement>('[adowire\\:id]')
  for (const root of roots) {
    applyShowToRoot(root)
  }
}
