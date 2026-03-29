/**
 * adowire client — adowire:model.live directive
 *
 * Implements real-time two-way binding for form inputs. While the base
 * `adowire:model="prop"` attribute is "deferred" (values are collected at
 * form-submit time by submit.ts), the `.live` modifier family commits
 * property updates to the server immediately as the user types or interacts.
 *
 * Supported attribute forms:
 *
 *   adowire:model.live="prop"
 *     → commit on every `input` event (real-time)
 *
 *   adowire:model.live.blur="prop"  (or adowire:model.blur="prop")
 *     → commit only on the `blur` event (when the field loses focus)
 *
 *   adowire:model.live.debounce="prop"
 *     → debounced: wait 250 ms after the last keystroke before committing
 *
 *   adowire:model.live.debounce.500ms="prop"
 *     → custom debounce interval (parse Xms from modifiers)
 *
 *   adowire:model.live.throttle="prop"
 *     → throttled: commit at most once every 250 ms
 *
 *   adowire:model.live.throttle.500ms="prop"
 *     → custom throttle interval
 *
 * Architecture:
 *   - Uses event delegation on `document` (same pattern as click.ts / submit.ts).
 *   - Registers `input`, `change`, and `blur` listeners once.
 *   - Finds the parent [adowire:id] component and calls `component.$set(prop, value)`.
 */

import type { WireClientComponent } from '../component.js'

// ─── Modifier parsing ─────────────────────────────────────────────────────────

/**
 * Parsed representation of an `adowire:model.*` attribute's modifier chain.
 */
interface ModelModifiers {
  /** The property name (attribute value). */
  prop: string
  /** Whether the `.live` modifier is present (enables real-time binding). */
  live: boolean
  /** Whether the `.blur` modifier is present (commit on blur only). */
  blur: boolean
  /** Whether the `.debounce` modifier is present. */
  debounce: boolean
  /** Debounce interval in milliseconds (default 250). */
  debounceMs: number
  /** Whether the `.throttle` modifier is present. */
  throttle: boolean
  /** Throttle interval in milliseconds (default 250). */
  throttleMs: number
}

const DEFAULT_INTERVAL_MS = 250

/**
 * Scan an element's attributes for one that starts with `adowire:model.` and
 * parse its modifier chain. Returns `null` when no live-model attribute is found.
 *
 * The attribute name format is:
 *   `adowire:model[.modifier[.modifier[.Xms]]]`
 *
 * Examples:
 *   adowire:model.live                → live
 *   adowire:model.live.blur           → live + blur
 *   adowire:model.blur                → blur (implies live)
 *   adowire:model.live.debounce       → live + debounce 250ms
 *   adowire:model.live.debounce.500ms → live + debounce 500ms
 *   adowire:model.live.throttle.1000ms → live + throttle 1000ms
 */
function parseModelAttribute(el: Element): ModelModifiers | null {
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]
    const name = attr.name

    // Only consider attributes that have modifiers after `adowire:model`.
    // The bare `adowire:model` (without dots) is the deferred variant
    // handled by submit.ts — we deliberately skip it here.
    if (!name.startsWith('adowire:model.')) continue

    const prop = attr.value.trim()
    if (!prop) continue

    // Extract the dot-separated modifiers after `adowire:model.`.
    const modifierStr = name.slice('adowire:model.'.length)
    const parts = modifierStr.split('.')

    const mods: ModelModifiers = {
      prop,
      live: false,
      blur: false,
      debounce: false,
      debounceMs: DEFAULT_INTERVAL_MS,
      throttle: false,
      throttleMs: DEFAULT_INTERVAL_MS,
    }

    for (let j = 0; j < parts.length; j++) {
      const part = parts[j]

      if (part === 'live') {
        mods.live = true
      } else if (part === 'blur') {
        mods.blur = true
        // `.blur` implies live behaviour even without an explicit `.live`.
        mods.live = true
      } else if (part === 'debounce') {
        mods.debounce = true
        mods.live = true
        // Check if the next part is a duration like "500ms".
        const next = parts[j + 1]
        if (next && /^\d+ms$/.test(next)) {
          mods.debounceMs = Number.parseInt(next, 10)
          j++ // skip the duration token
        }
      } else if (part === 'throttle') {
        mods.throttle = true
        mods.live = true
        // Check if the next part is a duration like "500ms".
        const next = parts[j + 1]
        if (next && /^\d+ms$/.test(next)) {
          mods.throttleMs = Number.parseInt(next, 10)
          j++ // skip the duration token
        }
      }
      // Unknown modifiers are silently ignored — forward compatibility.
    }

    // Only return if at least `.live` (explicitly or implied) was found.
    if (mods.live) return mods
  }

  return null
}

// ─── Input value extraction ───────────────────────────────────────────────────

/**
 * Read the current value from a form element, coercing to the most appropriate
 * JS type. Handles text inputs, number/range, checkboxes, radios, textareas,
 * and select elements (including multi-select).
 */
function getInputValue(el: Element): any {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') {
      // A checkbox without an explicit `value` attribute acts as a boolean toggle.
      if (!el.hasAttribute('value')) return el.checked
      // With an explicit value it's part of a group — return the value or null.
      return el.checked ? el.value : null
    }

    if (el.type === 'radio') {
      return el.checked ? el.value : null
    }

    if (el.type === 'number' || el.type === 'range') {
      const num = Number(el.value)
      return Number.isNaN(num) ? el.value : num
    }

    return el.value
  }

  if (el instanceof HTMLTextAreaElement) {
    return el.value
  }

  if (el instanceof HTMLSelectElement) {
    if (el.multiple) {
      return Array.from(el.selectedOptions).map((o) => o.value)
    }
    return el.value
  }

  // Fallback — try the generic `.value` property via duck-typing.
  return (el as any).value ?? ''
}

// ─── Component resolution ─────────────────────────────────────────────────────

/**
 * Walk up from `el` to the nearest `[adowire:id]` ancestor, resolve the
 * component from the global registry, and return it. Returns `null` when no
 * component can be found.
 */
function resolveComponent(el: Element): WireClientComponent | null {
  const componentEl = el.closest('[adowire\\:id]') as HTMLElement | null
  if (!componentEl) {
    console.warn('[adowire] adowire:model: no parent [adowire:id] found for', el)
    return null
  }

  const componentId = componentEl.getAttribute('adowire:id')
  if (!componentId) return null

  const component = window.Adowire?.components.get(componentId) as WireClientComponent | undefined

  if (!component) {
    console.warn(`[adowire] adowire:model: component "${componentId}" not found in registry`)
    return null
  }

  return component
}

// ─── Debounce / Throttle helpers ──────────────────────────────────────────────

/** Map from element → pending debounce timeout handle. */
const debounceTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/** Map from element → last throttle fire timestamp. */
const throttleTimestamps = new WeakMap<Element, number>()

/** Map from element → pending throttle trailing-edge timeout. */
const throttleTrailingTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/**
 * Schedule a debounced commit. Clears any existing timer for the element and
 * sets a new one. Fires `fn` after `ms` milliseconds of inactivity.
 */
function debounce(el: Element, ms: number, fn: () => void): void {
  const existing = debounceTimers.get(el)
  if (existing !== undefined) clearTimeout(existing)
  debounceTimers.set(
    el,
    setTimeout(() => {
      debounceTimers.delete(el)
      fn()
    }, ms)
  )
}

/**
 * Throttle commits from `el` to at most one per `ms` milliseconds.
 * Uses a leading-edge + trailing-edge strategy: the first call fires
 * immediately, subsequent calls within the window are deferred to the
 * trailing edge so the final value is always committed.
 */
function throttle(el: Element, ms: number, fn: () => void): void {
  const now = Date.now()
  const lastFired = throttleTimestamps.get(el) ?? 0

  if (now - lastFired >= ms) {
    // Leading edge — fire immediately.
    throttleTimestamps.set(el, now)
    // Clear any trailing timer since we're firing now.
    const trailing = throttleTrailingTimers.get(el)
    if (trailing !== undefined) {
      clearTimeout(trailing)
      throttleTrailingTimers.delete(el)
    }
    fn()
  } else {
    // Inside the throttle window — schedule a trailing-edge call so the
    // final value is always committed.
    const existing = throttleTrailingTimers.get(el)
    if (existing !== undefined) clearTimeout(existing)

    const remaining = ms - (now - lastFired)
    throttleTrailingTimers.set(
      el,
      setTimeout(() => {
        throttleTimestamps.set(el, Date.now())
        throttleTrailingTimers.delete(el)
        fn()
      }, remaining)
    )
  }
}

// ─── Core commit logic ────────────────────────────────────────────────────────

/**
 * Loosely compare two values for equality, treating `null`, `undefined`, and
 * `""` as equivalent (since AdonisJS bodyparser's `convertEmptyStringsToNull`
 * makes them indistinguishable after a round-trip).
 */
function looseEqual(a: any, b: any): boolean {
  // Normalise null / undefined / "" to a common sentinel for comparison.
  const norm = (v: any) => (v === null || v === undefined || v === '' ? '' : v)
  const na = norm(a)
  const nb = norm(b)
  // eslint-disable-next-line eqeqeq
  return na == nb
}

/**
 * Resolve a dot-path value from a nested object.
 *   resolvePath({ a: { b: 1 } }, 'a.b') → 1
 */
function resolvePath(obj: Record<string, any>, path: string): any {
  const parts = path.split('.')
  let current: any = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

/**
 * Commit the current value of `el` to its owning component under the property
 * name specified by the model attribute.
 *
 * Skips the commit when the input value is the same as the snapshot value —
 * this avoids no-op round-trips that would send empty strings through the
 * AdonisJS bodyparser (which converts `""` → `null`).
 */
function commitValue(el: Element, mods: ModelModifiers): void {
  const component = resolveComponent(el)
  if (!component) return

  const value = getInputValue(el)

  // Compare against the current snapshot state. If nothing changed, skip
  // the commit entirely to avoid a wasted round-trip (and to prevent the
  // bodyparser's "" → null conversion from corrupting the server state).
  const snapshotValue = resolvePath(component.snapshot.state, mods.prop)
  if (looseEqual(value, snapshotValue)) return

  void component.$set(mods.prop, value)
}

/**
 * Handle an event that may trigger a live model commit. Applies the correct
 * timing strategy based on the parsed modifiers.
 */
function handleModelEvent(el: Element, mods: ModelModifiers): void {
  if (mods.debounce) {
    debounce(el, mods.debounceMs, () => commitValue(el, mods))
  } else if (mods.throttle) {
    throttle(el, mods.throttleMs, () => commitValue(el, mods))
  } else {
    commitValue(el, mods)
  }
}

// ─── Element matching ─────────────────────────────────────────────────────────

/**
 * Walk up from `target` to find the closest element that carries an
 * `adowire:model.*` attribute with a live modifier. Returns both the element
 * and its parsed modifiers, or `null` if none is found.
 */
function findModelElement(target: Element): { el: Element; mods: ModelModifiers } | null {
  let current: Element | null = target

  while (current) {
    const mods = parseModelAttribute(current)
    if (mods) return { el: current, mods }
    current = current.parentElement
  }

  return null
}

// ─── Directive registration ───────────────────────────────────────────────────

/**
 * Guard flag to prevent double-registration (e.g. during HMR / hot-reload).
 */
let registered = false

/**
 * Attach delegated `input`, `change`, and `blur` event listeners to `document`
 * for the `adowire:model.live` directive family.
 *
 * Safe to call multiple times — a guard flag prevents double-registration.
 *
 * @example
 * ```
 * import { registerModelDirective } from './directives/model.js'
 * registerModelDirective()
 * ```
 */
export function registerModelDirective(): void {
  if (registered) return
  registered = true

  // ── `input` event — fires on every keystroke / value change ───────────
  document.addEventListener('input', (event: Event) => {
    const target = event.target as Element | null
    if (!target) return

    const match = findModelElement(target)
    if (!match) return

    // Blur-only models should not react to `input` events.
    if (match.mods.blur) return

    handleModelEvent(match.el, match.mods)
  })

  // ── `change` event — fires on select, checkbox, and radio changes ─────
  // Some elements (e.g. <select>, <input type="checkbox">) emit `change`
  // but not always `input`. We listen to both to cover all form controls.
  document.addEventListener('change', (event: Event) => {
    const target = event.target as Element | null
    if (!target) return

    const match = findModelElement(target)
    if (!match) return

    // Blur-only models should not react to `change` events either,
    // UNLESS it's a select/checkbox/radio where `change` is the natural
    // commit point (a user picks an option → that's the final value).
    if (match.mods.blur) {
      const isImmediateControl =
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement &&
          (target.type === 'checkbox' || target.type === 'radio'))

      if (!isImmediateControl) return
    }

    handleModelEvent(match.el, match.mods)
  })

  // ── `blur` event — fires when the element loses focus ─────────────────
  // Uses capture phase because `blur` does not bubble.
  document.addEventListener(
    'blur',
    (event: FocusEvent) => {
      const target = event.target as Element | null
      if (!target) return

      const match = findModelElement(target)
      if (!match) return

      // Only commit on blur if the `.blur` modifier is present.
      if (!match.mods.blur) return

      // For blur mode, commit immediately — no debounce/throttle.
      commitValue(match.el, match.mods)
    },
    // `blur` does not bubble, so we must use the capture phase.
    { capture: true }
  )
}
