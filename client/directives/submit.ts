/**
 * adowire client — adowire:submit directive
 *
 * Uses event delegation on `document` to intercept submit events on forms
 * carrying a `adowire:submit` attribute. It:
 *   1. Calls `preventDefault()` to stop the native browser submission.
 *   2. Serialises form fields that have a `adowire:model` attribute into an
 *      `updates` object (keyed by the model path).
 *   3. Parses the `adowire:submit` attribute value for an optional method name
 *      (defaults to `"submit"` if the value is empty or boolean-like).
 *   4. Commits the action to the owning [adowire:id] component.
 *
 * Attribute value formats (same grammar as adowire:click):
 *   adowire:submit             → method: "submit", params: []
 *   adowire:submit="save"      → method: "save",   params: []
 *   adowire:submit="save(1)"   → method: "save",   params: [1]
 */

import type { WireClientComponent } from '../component.js'
import { parseActionExpression } from './click.js'

// ─── Form serialisation ───────────────────────────────────────────────────────

/**
 * Build an `updates` object from the form's `adowire:model` fields.
 *
 * Only fields that carry a `adowire:model` attribute are included — other fields
 * are ignored so we don't accidentally overwrite server state with data that
 * the server doesn't expect.
 *
 * The `adowire:model` value is used as the property key, supporting dot-notation
 * for nested paths (e.g. `adowire:model="address.city"`).
 *
 * Multi-select and checkbox groups produce arrays; all other inputs produce
 * their scalar value.
 */
function serialiseFormUpdates(form: HTMLFormElement): Record<string, any> {
  const updates: Record<string, any> = {}

  // Collect every form element that has adowire:model.
  const elements = Array.from(form.elements) as HTMLElement[]

  for (const el of elements) {
    const modelPath = el.getAttribute('adowire:model')
    if (!modelPath) continue

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        // Checkbox groups share the same model path → collect into array.
        const existing = updates[modelPath]
        if (el.checked) {
          if (Array.isArray(existing)) {
            existing.push(coerceInputValue(el))
          } else if (existing !== undefined) {
            updates[modelPath] = [existing, coerceInputValue(el)]
          } else {
            // Single checkbox — store boolean when there's only one.
            updates[modelPath] = coerceInputValue(el)
          }
        } else {
          // Unchecked — only set false if no value has been recorded yet
          // (so checked siblings win).
          if (!(modelPath in updates)) {
            updates[modelPath] = false
          }
        }
      } else if (el.type === 'radio') {
        if (el.checked) {
          updates[modelPath] = coerceInputValue(el)
        } else if (!(modelPath in updates)) {
          updates[modelPath] = null
        }
      } else if (el.type === 'file') {
        // File inputs are not serialisable as plain JSON — skip for now.
        // File upload support requires multipart/form-data handling.
        continue
      } else {
        updates[modelPath] = coerceInputValue(el)
      }
    } else if (el instanceof HTMLTextAreaElement) {
      updates[modelPath] = el.value
    } else if (el instanceof HTMLSelectElement) {
      if (el.multiple) {
        updates[modelPath] = Array.from(el.selectedOptions).map((o) => o.value)
      } else {
        updates[modelPath] = el.value
      }
    }
  }

  return updates
}

/**
 * Coerce an input element's `.value` string to the most appropriate JS type.
 *
 * - Checkboxes return `true` / `false` when they have no explicit value attr,
 *   or their `.value` string otherwise (for checkbox groups).
 * - Numeric-looking strings become numbers.
 * - Everything else stays as a string.
 */
function coerceInputValue(el: HTMLInputElement): any {
  if (el.type === 'checkbox') {
    // A checkbox without a custom value attr is a boolean toggle.
    if (!el.hasAttribute('value')) return el.checked
    // In a group the value string identifies which option was checked.
    return el.value
  }

  const raw = el.value

  // Attempt numeric coercion for number/range inputs.
  if (el.type === 'number' || el.type === 'range') {
    const num = Number(raw)
    return Number.isNaN(num) ? raw : num
  }

  return raw
}

// ─── Directive registration ───────────────────────────────────────────────────

/**
 * Guard against double-registration if `registerSubmitDirective()` is called
 * more than once (e.g. during hot-reload scenarios).
 */
let registered = false

/**
 * Attach the delegated `adowire:submit` listener to `document`.
 */
export function registerSubmitDirective(): void {
  if (registered) return
  registered = true

  document.addEventListener(
    'submit',
    (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null
      if (!form) return

      // Only intercept forms that carry the adowire:submit attribute.
      if (!form.hasAttribute('adowire:submit')) return

      // Always prevent the native submission.
      event.preventDefault()

      // ── Resolve the owning component ────────────────────────────────────
      const componentEl = form.closest('[adowire\\:id]') as HTMLElement | null
      if (!componentEl) {
        console.warn('[adowire] adowire:submit: no parent [adowire:id] found for form', form)
        return
      }

      const componentId = componentEl.getAttribute('adowire:id')
      if (!componentId) return

      const component = window.Adowire?.components.get(componentId) as
        | WireClientComponent
        | undefined

      if (!component) {
        console.warn(`[adowire] adowire:submit: component "${componentId}" not found in registry`)
        return
      }

      // ── Parse the method expression ──────────────────────────────────────
      const attrValue = (form.getAttribute('adowire:submit') ?? '').trim()

      // An empty attribute value (e.g. just `adowire:submit`) defaults to "submit".
      const call =
        attrValue.length === 0 ? { method: 'submit', params: [] } : parseActionExpression(attrValue)

      // ── Serialise adowire:model fields as updates ───────────────────────────
      const updates = serialiseFormUpdates(form)

      // ── Commit ───────────────────────────────────────────────────────────
      void component.commit([call], updates)
    },
    // Use capture so we intercept before any other handlers that might
    // call stopPropagation().
    { capture: false }
  )
}
