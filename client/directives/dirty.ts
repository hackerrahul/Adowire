/**
 * adowire client — adowire:dirty directive
 *
 * Manages visibility and class changes on elements when the local (client-side)
 * state of a component has been modified but not yet confirmed by the server.
 *
 * A component is considered "dirty" when any `adowire:model` input's current
 * value differs from the value stored in the component's last server-confirmed
 * snapshot. Once a successful server round-trip completes and the snapshot is
 * updated, the dirty state is cleared.
 *
 * Supported attribute forms:
 *
 *   adowire:dirty                            — hidden by default; shown when dirty
 *   adowire:dirty.remove                     — shown by default; hidden when dirty
 *   adowire:dirty.class="x"                 — class "x" added when dirty
 *   adowire:dirty.class.remove="x"          — class "x" removed when dirty
 *
 * All of the above can be combined with adowire:target to scope dirty detection
 * to a single model property instead of the entire component:
 *
 *   adowire:dirty adowire:target="title"     — shown only when "title" is dirty
 *   adowire:dirty.class="x" adowire:target="email"
 *
 * Additionally, when adowire:dirty.class (or .class.remove) is placed directly
 * on the same element as adowire:model, that model property is used as the
 * implicit target automatically — no adowire:target needed:
 *
 *   <input adowire:model="email" adowire:dirty.class="border-yellow-500">
 *
 * Public API
 * ──────────
 *   initDirty()         — call once at boot; hides all plain adowire:dirty elements
 *                          and registers the delegated input listener
 *   applyDirtyState()   — manually trigger a dirty-state re-evaluation for all components
 *   clearDirtyState()   — reset all dirty indicators to their idle state
 *   checkDirty(root, prop?) — returns true if the component (or a specific property)
 *                             is dirty; used by the Alpine $wire.$dirty() bridge
 */

// ─── CSS attribute selectors ──────────────────────────────────────────────────

/** Elements shown when dirty (hidden at rest). */
const SEL_SHOW = '[adowire\\:dirty]'

/** Elements hidden when dirty (visible at rest). */
const SEL_HIDE = '[adowire\\:dirty\\.remove]'

/** Elements that gain a CSS class when dirty. */
const SEL_CLASS_ADD = '[adowire\\:dirty\\.class]'

/** Elements that lose a CSS class when dirty. */
const SEL_CLASS_REMOVE = '[adowire\\:dirty\\.class\\.remove]'

/** All adowire:model elements whose values we track. */
const SEL_MODEL = '[adowire\\:model]'

/**
 * Combined selector that matches every element carrying any adowire:dirty
 * variant. Used to iterate all indicators in a single querySelectorAll call.
 * querySelectorAll guarantees each element appears at most once even if it
 * matches multiple parts of the selector.
 */
const SEL_ALL_INDICATORS = [SEL_SHOW, SEL_HIDE, SEL_CLASS_ADD, SEL_CLASS_REMOVE].join(',')

// ─── State ────────────────────────────────────────────────────────────────────

let registered = false

/**
 * Per-component map of which model property names are currently dirty.
 *
 * key   — adowire:id value of the component root
 * value — Set of model property paths whose current input value differs from
 *         the server-confirmed snapshot value
 *
 * Replaces the old `dirtyComponents: Set<string>` (boolean per component) so
 * that adowire:target="prop" can be evaluated per-property rather than per-component.
 */
const dirtyProps = new Map<string, Set<string>>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split a whitespace-separated class string into individual tokens, filtering
 * out any empty strings that arise from multiple consecutive spaces.
 */
function splitClasses(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

/**
 * Walk up the DOM from `el` to find the nearest ancestor (or self) with an
 * `adowire:id` attribute — i.e. the component root.
 */
function findComponentRoot(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el
  while (current) {
    if (current.hasAttribute('adowire:id')) return current
    current = current.parentElement
  }
  return null
}

/**
 * Read the snapshot state for a component root element.
 * Returns the parsed `state` object, or `null` if unavailable.
 */
function getSnapshotState(root: HTMLElement): Record<string, any> | null {
  // Prefer the live WireClientComponent snapshot if Adowire is available.
  const id = root.getAttribute('adowire:id')
  if (id && typeof window !== 'undefined' && (window as any).Adowire) {
    const component = (window as any).Adowire.find(id)
    if (component?.snapshot?.state) {
      return component.snapshot.state
    }
  }

  // Fallback: parse from the DOM attribute.
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
 * Get the current value of an input/select/textarea element in a way that
 * matches the serialisation used by `adowire:model`.
 */
function getInputValue(el: HTMLElement): any {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked
    if (el.type === 'number' || el.type === 'range') {
      const num = Number.parseFloat(el.value)
      return Number.isNaN(num) ? el.value : num
    }
    return el.value
  }
  if (el instanceof HTMLTextAreaElement) return el.value
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) {
      return Array.from(el.selectedOptions).map((o) => o.value)
    }
    return el.value
  }
  return (el as any).value ?? ''
}

/**
 * Resolve a dot-separated property path against a state object.
 *
 * @example
 *   resolvePath({ user: { name: 'Ada' } }, 'user.name') // => 'Ada'
 */
function resolvePath(state: Record<string, any>, path: string): any {
  const parts = path.split('.')
  let value: any = state
  for (const part of parts) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined
    value = value[part]
  }
  return value
}

/**
 * Loose equality check that handles the common type coercions between form
 * values (strings) and snapshot values (numbers, booleans, etc.).
 */
function looseEqual(a: any, b: any): boolean {
  if (a === b) return true
  // null / undefined treated as equivalent
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  // Compare stringified representations for number ↔ string, boolean ↔ string
  if (String(a) === String(b)) return true
  // Array comparison (e.g. multi-select)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => looseEqual(v, b[i]))
  }
  return false
}

/**
 * Resolve the "target" property for a dirty indicator element.
 *
 * Priority order:
 *   1. `adowire:target="prop"` — explicit target attribute
 *   2. `adowire:model="prop"` — the element itself is a model input, so use its
 *      own model path as the implicit target (e.g. an input with both
 *      adowire:model and adowire:dirty.class only reacts to its own value)
 *   3. `undefined` — no target; the indicator reacts to the whole component
 *
 * @returns the property path string, or `undefined` for component-level scope.
 */
function resolveTarget(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute('adowire:target')
  if (explicit) return explicit

  const model = el.getAttribute('adowire:model')
  if (model) return model

  return undefined
}

// ─── Per-component dirty property computation ─────────────────────────────────

/**
 * Compute the full set of dirty property paths for a component by comparing
 * every `adowire:model` input's current value to the server snapshot.
 *
 * @returns A `Set<string>` of model property paths that are currently dirty.
 *          An empty set means the component is clean (all inputs match the snapshot).
 */
function getDirtyProperties(root: HTMLElement): Set<string> {
  const dirty = new Set<string>()
  const state = getSnapshotState(root)
  if (!state) return dirty

  const models = root.querySelectorAll<HTMLElement>(SEL_MODEL)
  for (const el of models) {
    const prop = el.getAttribute('adowire:model')
    if (!prop) continue

    const snapshotValue = resolvePath(state, prop)
    const currentValue = getInputValue(el)

    if (!looseEqual(snapshotValue, currentValue)) {
      dirty.add(prop)
    }
  }

  return dirty
}

// ─── Single-element dirty indicator management ────────────────────────────────

/**
 * Apply the "dirty" visual state to a single indicator element.
 * Which behaviour is applied depends on which adowire:dirty* attribute the
 * element carries.
 */
function applyDirtyToElement(el: HTMLElement): void {
  // Plain adowire:dirty — show the element.
  // Only applies if no modifier attributes are also present (modifiers take priority).
  if (
    el.hasAttribute('adowire:dirty') &&
    !el.hasAttribute('adowire:dirty.remove') &&
    !el.hasAttribute('adowire:dirty.class') &&
    !el.hasAttribute('adowire:dirty.class.remove')
  ) {
    el.style.display = ''
    return
  }

  // adowire:dirty.remove — hide the element when dirty.
  if (el.hasAttribute('adowire:dirty.remove')) {
    el.style.display = 'none'
  }

  // adowire:dirty.class — add class(es) when dirty.
  // Guard against .class.remove elements which also contain the substring ".class"
  // in their attribute name; only process if the element has the non-remove variant.
  if (el.hasAttribute('adowire:dirty.class') && !el.hasAttribute('adowire:dirty.class.remove')) {
    const raw = el.getAttribute('adowire:dirty.class') ?? ''
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.add(...classes)
  }

  // adowire:dirty.class.remove — remove class(es) when dirty.
  if (el.hasAttribute('adowire:dirty.class.remove')) {
    const raw = el.getAttribute('adowire:dirty.class.remove') ?? ''
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.remove(...classes)
  }
}

/**
 * Clear the "dirty" visual state from a single indicator element, restoring
 * it to its idle (clean) appearance.
 */
function clearDirtyFromElement(el: HTMLElement): void {
  // Plain adowire:dirty — re-hide the element.
  if (
    el.hasAttribute('adowire:dirty') &&
    !el.hasAttribute('adowire:dirty.remove') &&
    !el.hasAttribute('adowire:dirty.class') &&
    !el.hasAttribute('adowire:dirty.class.remove')
  ) {
    el.style.display = 'none'
    return
  }

  // adowire:dirty.remove — re-show the element.
  if (el.hasAttribute('adowire:dirty.remove')) {
    el.style.display = ''
  }

  // adowire:dirty.class — remove the class(es) that were added.
  if (el.hasAttribute('adowire:dirty.class') && !el.hasAttribute('adowire:dirty.class.remove')) {
    const raw = el.getAttribute('adowire:dirty.class') ?? ''
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.remove(...classes)
  }

  // adowire:dirty.class.remove — re-add the class(es) that were removed.
  if (el.hasAttribute('adowire:dirty.class.remove')) {
    const raw = el.getAttribute('adowire:dirty.class.remove') ?? ''
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.add(...classes)
  }
}

// ─── Component-level evaluation ───────────────────────────────────────────────

/**
 * Re-evaluate the dirty state for a single component and update every dirty
 * indicator element within it accordingly.
 *
 * Each indicator is evaluated independently:
 *   - Elements with `adowire:target="prop"` (or an implicit target from
 *     `adowire:model`) only react when that specific property is dirty.
 *   - Elements without a target react when any property in the component is dirty.
 *
 * State transitions (was dirty → now clean, or vice versa) are applied by
 * calling `applyDirtyToElement` / `clearDirtyFromElement` on the affected
 * elements only — unchanged elements are skipped to avoid unnecessary DOM writes.
 */
function evaluateComponent(root: HTMLElement): void {
  const id = root.getAttribute('adowire:id') ?? ''

  const newDirty = getDirtyProperties(root)
  const oldDirty = dirtyProps.get(id) ?? new Set<string>()

  // Persist the fresh dirty-property set so the next evaluation can diff against it.
  dirtyProps.set(id, newDirty)

  const componentWasDirty = oldDirty.size > 0
  const componentIsDirty = newDirty.size > 0

  // Walk every indicator element in this component subtree.
  const indicators = root.querySelectorAll<HTMLElement>(SEL_ALL_INDICATORS)

  for (const el of indicators) {
    const target = resolveTarget(el)

    // Determine whether this specific indicator was / is dirty.
    // Elements with a target only care about their specific property;
    // untargeted elements react to the whole-component dirty state.
    const wasElementDirty = target !== undefined ? oldDirty.has(target) : componentWasDirty
    const isElementDirty = target !== undefined ? newDirty.has(target) : componentIsDirty

    // Only touch the DOM when the state has actually changed.
    if (wasElementDirty === isElementDirty) continue

    if (isElementDirty) {
      applyDirtyToElement(el)
    } else {
      clearDirtyFromElement(el)
    }
  }
}

// ─── Event handler ────────────────────────────────────────────────────────────

/**
 * Event handler for `input` and `change` events — finds the enclosing wire
 * component and re-evaluates its dirty state.
 */
function onInputChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  // Only care about elements inside an adowire:model binding
  if (!target.closest(SEL_MODEL)) return

  const root = findComponentRoot(target)
  if (!root) return

  evaluateComponent(root)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the dirty directive.
 *
 * 1. Hides all plain `adowire:dirty` elements (they should only appear when
 *    state has diverged from the server snapshot).
 * 2. Registers delegated `input` and `change` listeners on the document so
 *    that dirty state is re-evaluated on every user interaction with a model
 *    input.
 *
 * Safe to call multiple times — event listeners are only registered once.
 */
export function initDirty(): void {
  // Apply default hidden state to all plain adowire:dirty elements.
  // Elements that also carry modifier attributes are excluded because their
  // initial visibility is controlled by their modifier semantics, not this rule.
  const els = document.querySelectorAll<HTMLElement>(SEL_SHOW)
  for (const el of els) {
    if (
      el.hasAttribute('adowire:dirty.remove') ||
      el.hasAttribute('adowire:dirty.class') ||
      el.hasAttribute('adowire:dirty.class.remove')
    ) {
      continue
    }
    el.style.display = 'none'
  }

  if (registered) return
  registered = true

  // Delegated input/change listeners on document — covers all current and
  // future model inputs without per-element binding.
  document.addEventListener('input', onInputChange, { passive: true })
  document.addEventListener('change', onInputChange, { passive: true })
}

/**
 * Manually trigger a dirty-state re-evaluation for every mounted component
 * on the page.
 *
 * Called automatically after each successful server round-trip so that
 * indicators update to reflect the newly confirmed snapshot state.
 */
export function applyDirtyState(): void {
  const roots = document.querySelectorAll<HTMLElement>('[adowire\\:id]')
  for (const root of roots) {
    evaluateComponent(root)
  }
}

/**
 * Force-reset dirty state for all components — clear every dirty indicator
 * back to its idle (clean) appearance without re-evaluating input values.
 *
 * Useful for programmatic resets (e.g. after a navigation or when you know
 * all changes have been discarded on the server side).
 */
export function clearDirtyState(): void {
  const roots = document.querySelectorAll<HTMLElement>('[adowire\\:id]')

  for (const root of roots) {
    const id = root.getAttribute('adowire:id') ?? ''
    const oldDirty = dirtyProps.get(id)

    // Nothing to clear for this component.
    if (!oldDirty || oldDirty.size === 0) continue

    const componentWasDirty = oldDirty.size > 0
    const indicators = root.querySelectorAll<HTMLElement>(SEL_ALL_INDICATORS)

    for (const el of indicators) {
      const target = resolveTarget(el)
      const wasElementDirty = target !== undefined ? oldDirty.has(target) : componentWasDirty
      if (wasElementDirty) clearDirtyFromElement(el)
    }
  }

  dirtyProps.clear()
}

/**
 * Imperatively check whether a component (or a specific model property within
 * it) currently has unsaved changes.
 *
 * This computes the result fresh from the current DOM values and the live
 * component snapshot — it does not rely on the internally cached `dirtyProps`
 * map so it is always accurate even before the first input event fires.
 *
 * Used by the Alpine `$wire.$dirty()` bridge so that Alpine expressions can
 * react to dirty state without requiring adowire:dirty attributes in the HTML.
 *
 * @param root  The component's root `[adowire:id]` element.
 * @param prop  Optional property scope:
 *              - `undefined`        — returns true if ANY property is dirty
 *              - `string`           — returns true if that specific property is dirty
 *              - `string[]`         — returns true if ANY of the listed properties is dirty
 *
 * @example
 *   // In Alpine:
 *   <div x-show="$wire.$dirty()">Any unsaved change</div>
 *   <div x-show="$wire.$dirty('email')">Email changed</div>
 *   <div x-show="$wire.$dirty(['title', 'body'])">Title or body changed</div>
 */
export function checkDirty(root: HTMLElement, prop?: string | string[]): boolean {
  const state = getSnapshotState(root)
  if (!state) return false

  const targets = prop === undefined ? null : Array.isArray(prop) ? prop : [prop]

  const models = root.querySelectorAll<HTMLElement>(SEL_MODEL)
  for (const el of models) {
    const modelProp = el.getAttribute('adowire:model')
    if (!modelProp) continue

    // When a prop filter is active, skip inputs that are not in the target list.
    if (targets !== null && !targets.includes(modelProp)) continue

    const snapshotValue = resolvePath(state, modelProp)
    const currentValue = getInputValue(el)

    if (!looseEqual(snapshotValue, currentValue)) return true
  }

  return false
}
