/**
 * adowire client — adowire:loading directive
 *
 * Manages visibility, class, and attribute changes on elements that carry one
 * of the following attribute forms while a server round-trip is in-flight:
 *
 *   adowire:loading                    — hidden by default; shown while loading
 *   adowire:loading.remove             — shown by default; hidden while loading
 *   adowire:loading.class="x"         — class "x" added while loading
 *   adowire:loading.class.remove="x"  — class "x" removed while loading
 *   adowire:loading.attr="disabled"   — attribute set while loading, removed after
 *
 * The modifier is encoded in the attribute *name* itself (same convention as
 * Livewire's wire:loading), so each variant requires its own attribute-presence
 * check and querySelectorAll selector.
 *
 * Public API
 * ──────────
 *   initLoading()    — call once at boot; hides all plain adowire:loading elements
 *   applyLoading()   — call when a request starts
 *   removeLoading()  — call when a request ends (in a finally block)
 */

// ─── CSS attribute selectors ──────────────────────────────────────────────────
//
// In querySelectorAll the colon in an attribute name must be escaped as `\:`,
// and a literal dot must be escaped as `\.`.  In a JS string each backslash is
// itself escaped, so `\\:` → `\:` and `\\.` → `\.` in the final CSS string.

/** Elements shown while loading (hidden at rest). */
const SEL_SHOW = '[adowire\\:loading]'

/** Elements hidden while loading (visible at rest). */
const SEL_HIDE = '[adowire\\:loading\\.remove]'

/** Elements that gain a CSS class while loading. */
const SEL_CLASS_ADD = '[adowire\\:loading\\.class]'

/** Elements that lose a CSS class while loading. */
const SEL_CLASS_REMOVE = '[adowire\\:loading\\.class\\.remove]'

/** Elements that gain an HTML attribute while loading. */
const SEL_ATTR = '[adowire\\:loading\\.attr]'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split a whitespace-separated class string into individual tokens, filtering
 * out any empty strings that arise from multiple consecutive spaces.
 */
function splitClasses(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Apply the default hidden state to every plain `adowire:loading` element.
 *
 * Must be called once during page bootstrap (before the first user interaction)
 * so that loading indicators are invisible at rest.  It is safe to call again
 * after a full-page navigation re-runs the bootstrap sequence.
 */
export function initLoading(): void {
  const els = document.querySelectorAll<HTMLElement>(SEL_SHOW)
  for (const el of els) {
    el.style.display = 'none'
  }
}

// ─── Loading state ────────────────────────────────────────────────────────────

/**
 * Transition every `adowire:loading*` element into the *loading* state.
 *
 * Called at the beginning of each server round-trip.
 *
 * - `adowire:loading`               → reveal (remove `display:none`)
 * - `adowire:loading.remove`        → conceal (add `display:none`)
 * - `adowire:loading.class="x"`     → add class(es) `x`
 * - `adowire:loading.class.remove="x"` → remove class(es) `x`
 * - `adowire:loading.attr="x"`      → set attribute `x` (with empty value)
 */
export function applyLoading(): void {
  // Show: plain loading elements — strip the display:none applied by initLoading.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_SHOW)) {
    el.style.display = ''
  }

  // Hide: .remove elements — conceal them while the request is in-flight.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_HIDE)) {
    el.style.display = 'none'
  }

  // Add class(es).
  for (const el of document.querySelectorAll<HTMLElement>(SEL_CLASS_ADD)) {
    const raw = el.getAttribute('adowire:loading.class')
    if (!raw) continue
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.add(...classes)
  }

  // Remove class(es).
  for (const el of document.querySelectorAll<HTMLElement>(SEL_CLASS_REMOVE)) {
    const raw = el.getAttribute('adowire:loading.class.remove')
    if (!raw) continue
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.remove(...classes)
  }

  // Set attribute (presence-only, empty string value mirrors native `disabled`
  // semantics that only require the attribute to exist).
  for (const el of document.querySelectorAll<HTMLElement>(SEL_ATTR)) {
    const attr = el.getAttribute('adowire:loading.attr')
    if (attr) el.setAttribute(attr, '')
  }
}

/**
 * Transition every `adowire:loading*` element back to the *idle* state.
 *
 * Called in the `finally` block of each server round-trip so it runs whether
 * the request succeeded or failed.  Exactly reverses every change made by
 * {@link applyLoading}.
 *
 * - `adowire:loading`               → re-conceal (restore `display:none`)
 * - `adowire:loading.remove`        → re-reveal (remove `display:none`)
 * - `adowire:loading.class="x"`     → remove class(es) `x`
 * - `adowire:loading.class.remove="x"` → re-add class(es) `x`
 * - `adowire:loading.attr="x"`      → remove attribute `x`
 */
export function removeLoading(): void {
  // Re-conceal: restore the default hidden state on plain loading elements.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_SHOW)) {
    el.style.display = 'none'
  }

  // Re-reveal: remove the display:none we added during loading.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_HIDE)) {
    el.style.display = ''
  }

  // Remove the class(es) that were added during loading.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_CLASS_ADD)) {
    const raw = el.getAttribute('adowire:loading.class')
    if (!raw) continue
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.remove(...classes)
  }

  // Re-add the class(es) that were removed during loading.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_CLASS_REMOVE)) {
    const raw = el.getAttribute('adowire:loading.class.remove')
    if (!raw) continue
    const classes = splitClasses(raw)
    if (classes.length > 0) el.classList.add(...classes)
  }

  // Remove the attribute that was set during loading.
  for (const el of document.querySelectorAll<HTMLElement>(SEL_ATTR)) {
    const attr = el.getAttribute('adowire:loading.attr')
    if (attr) el.removeAttribute(attr)
  }
}
