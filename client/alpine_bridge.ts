/**
 * adowire client — Alpine.js $wire magic bridge
 *
 * Registers an Alpine magic property `$wire` that proxies to the
 * WireClientComponent instance closest to the element that Alpine is
 * initialising. This lets Alpine components read and write wire state
 * naturally:
 *
 *   <div x-data>
 *     <span x-text="$wire.count"></span>
 *     <button @click="$wire.increment()">+</button>
 *   </div>
 *
 * Property reads  → component.snapshot.state[prop]
 * Method calls    → component.commit([{ method, params }], {})
 * Property writes → component.commit([], { [prop]: value })
 * Special methods → forwarded directly to the component instance
 *                   ($set, $refresh, get, commit, …)
 */

import type { WireClientComponent } from './component.js'
import { checkDirty } from './directives/dirty.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up the DOM from `el` to find the nearest `[adowire:id]` ancestor
 * (inclusive of `el` itself), then look it up in the global component map.
 */
function findComponentForEl(el: Element): WireClientComponent | undefined {
  const root = el.closest('[adowire\\:id]') as HTMLElement | null
  if (!root) return undefined
  const id = root.getAttribute('adowire:id')
  if (!id) return undefined
  return window.Adowire?.components.get(id) as WireClientComponent | undefined
}

/**
 * Names of WireClientComponent instance members that should be forwarded
 * directly through the proxy rather than being treated as state properties.
 */
const COMPONENT_METHODS = new Set([
  'commit',
  'get',
  '$set',
  '$refresh',
  'el',
  'id',
  'name',
  'snapshot',
])

/**
 * Special $wire magic helpers that are synthesised by the bridge itself
 * rather than forwarded to WireClientComponent instance members.
 *
 * These are handled before the COMPONENT_METHODS and snapshot-state checks
 * so they can never be shadowed by a component property of the same name.
 */
const BRIDGE_HELPERS = new Set(['$dirty'])

// ─── Bridge registration ──────────────────────────────────────────────────────

/**
 * Register the Alpine `$wire` magic if Alpine is present on the window.
 *
 * Safe to call before Alpine boots — Alpine collects magic registrations
 * and applies them lazily. If Alpine is not detected this is a no-op.
 */
export function initAlpineBridge(): void {
  if (!window.Alpine) return

  window.Alpine.magic('adowire', (el: Element) => {
    const comp = findComponentForEl(el)

    // Return an inert empty object when no component wraps this element so
    // that Alpine templates don't throw on missing properties.
    if (!comp) return {}

    return new Proxy(comp.snapshot.state as Record<string, any>, {
      // ── Reads ──────────────────────────────────────────────────────────
      get(target, prop: string | symbol) {
        // Reflect symbol keys (Symbol.toPrimitive, etc.) directly.
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop)
        }

        // ── Bridge-synthesised helpers ($dirty, etc.) ───────────────────
        if (BRIDGE_HELPERS.has(prop)) {
          if (prop === '$dirty') {
            /**
             * $wire.$dirty(prop?)
             *
             * Returns true when the component (or a specific property) has
             * unsaved changes — i.e. the current input value differs from the
             * last server-confirmed snapshot value.
             *
             * @param target  Optional property name, or array of property names,
             *                to narrow the check. When omitted, returns true if
             *                ANY model property is dirty.
             *
             * @example
             *   <div x-show="$wire.$dirty()">Any unsaved change</div>
             *   <div x-show="$wire.$dirty('email')">Email changed</div>
             *   <button :disabled="!$wire.$dirty(['title','body'])">Save</button>
             */
            return (dirtyTarget?: string | string[]) => checkDirty(comp.el, dirtyTarget)
          }
        }

        // Forward known component members (methods + fields) directly.
        if (COMPONENT_METHODS.has(prop)) {
          const member = (comp as any)[prop]
          // Bind methods so they keep the correct `this` reference.
          return typeof member === 'function' ? member.bind(comp) : member
        }

        // State properties — re-read from the live snapshot so the proxy
        // always reflects the latest round-tripped state.
        const stateValue = comp.snapshot.state[prop]

        // If the state value is a function-like string or undefined but the
        // component class exposes a matching method, expose a callable that
        // commits that method name.
        if (stateValue === undefined) {
          // Expose a dynamic method caller: $wire.increment() or $wire.addAmount(5)
          return (...params: any[]) => comp.commit([{ method: prop, params }], {})
        }

        return stateValue
      },

      // ── Writes ─────────────────────────────────────────────────────────
      set(_target, prop: string | symbol, value: any) {
        if (typeof prop === 'symbol') return false

        // Prevent overwriting component members via Alpine bindings.
        if (COMPONENT_METHODS.has(prop)) {
          console.warn(`[adowire] $wire.${prop} is a reserved component member and cannot be set`)
          return false
        }

        void comp.commit([], { [prop]: value })
        return true
      },

      // ── has() — lets `prop in $wire` work for Alpine's internal checks ─
      has(target, prop: string | symbol) {
        if (typeof prop === 'symbol') return prop in target
        if (BRIDGE_HELPERS.has(prop as string)) return true
        if (COMPONENT_METHODS.has(prop as string)) return true
        return prop in comp.snapshot.state
      },
    })
  })
}
