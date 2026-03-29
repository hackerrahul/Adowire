/**
 * adowire client — main bootstrap entrypoint
 *
 * Responsibilities:
 *  1. Scan the DOM for [adowire:id] elements and initialise a WireClientComponent
 *     for each one, storing them in the global registry.
 *  2. Set up a MutationObserver so dynamically injected components are
 *     initialised automatically (e.g. after a redirect-less navigation or a
 *     server-streamed partial).
 *  3. Expose `window.Adowire` with the public API surface.
 *  4. Register all wire:* directives (click, submit, …).
 *  5. Call `initAlpineBridge()` to wire up the Alpine `$wire` magic when
 *     Alpine is present on the page.
 *
 * The bundle is intentionally side-effect-free at import time — everything
 * is deferred until `DOMContentLoaded` so that the script can safely be
 * placed in <head> with `defer`.
 */

import { WireClientComponent } from './component.js'
import { initAlpineBridge } from './alpine_bridge.js'
import { registerDirectives, postInitDirectives } from './directives/index.js'
import { uncloakComponent } from './directives/cloak.js'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise all [adowire:id] components currently in the DOM.
 *
 * Called automatically on DOMContentLoaded and may also be called manually
 * after programmatic DOM changes if the MutationObserver hasn't fired yet.
 */
function init(): void {
  const roots = document.querySelectorAll<HTMLElement>('[adowire\\:id]')
  for (const el of roots) {
    mountComponent(el)
  }
}

/**
 * Retrieve a component instance by its adowire:id.
 *
 * @param id  The value of the `adowire:id` attribute on the component root.
 * @returns   The `WireClientComponent` instance, or `undefined` if not found.
 */
function find(id: string): WireClientComponent | undefined {
  return Adowire.components.get(id)
}

export const Adowire = {
  version: '0.1.0',
  components: new Map<string, WireClientComponent>(),
  init,
  find,
} as const

// Expose on window so Alpine expressions, inline scripts, and third-party
// integrations can reach the registry without bundler imports.
window.Adowire = Adowire

// ─── Component lifecycle ──────────────────────────────────────────────────────

/**
 * Mount a single [adowire:id] element as a `WireClientComponent`.
 *
 * Idempotent — if the component is already registered (same id) this is a
 * no-op so the MutationObserver can safely call it on every added node.
 */
function mountComponent(el: HTMLElement): void {
  const id = el.getAttribute('adowire:id')
  if (!id) return

  // Already registered — skip.
  if (Adowire.components.has(id)) return

  let component: WireClientComponent
  try {
    component = new WireClientComponent(el)
  } catch (err) {
    console.error('[adowire] Failed to initialise component', el, err)
    return
  }

  Adowire.components.set(id, component)

  // Reveal any adowire:cloak elements now that the component is live.
  uncloakComponent(el)
}

/**
 * Unmount a component whose root element has been removed from the DOM.
 * Cleans up the registry entry so the garbage collector can reclaim the
 * component and its snapshot state.
 */
function unmountComponent(id: string): void {
  Adowire.components.delete(id)
}

// ─── MutationObserver — dynamic component support ─────────────────────────────

/**
 * Watch the entire document for added/removed [adowire:id] subtrees so that
 * components injected after initial page load (e.g. via @adowire:stream or
 * client-side navigation) are handled without a manual `Adowire.init()` call.
 */
function observeDOM(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // ── Nodes added ──────────────────────────────────────────────────────
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue

        // The node itself may be a wire component root.
        if (node.hasAttribute('adowire:id')) {
          mountComponent(node)
        }

        // Descendants of the added node may also be wire component roots
        // (e.g. a layout shell injected with multiple nested components).
        const nested = node.querySelectorAll<HTMLElement>('[adowire\\:id]')
        for (const child of nested) {
          mountComponent(child)
        }
      }

      // ── Nodes removed ────────────────────────────────────────────────────
      for (const node of mutation.removedNodes) {
        if (!(node instanceof HTMLElement)) continue

        if (node.hasAttribute('adowire:id')) {
          const id = node.getAttribute('adowire:id')
          if (id) unmountComponent(id)
        }

        // Clean up any nested components that were removed together with
        // their parent.
        const nested = node.querySelectorAll<HTMLElement>('[adowire\\:id]')
        for (const child of nested) {
          const id = child.getAttribute('adowire:id')
          if (id) unmountComponent(id)
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // 1. Register delegated event listeners for adowire:click, adowire:submit, etc.
  //    Must happen before init() so any components mounted synchronously
  //    are already covered by the listeners.
  registerDirectives()

  // 2. Mount all components already in the DOM.
  Adowire.init()

  // 3. Post-init directive hooks (e.g. uncloak now that components are live).
  postInitDirectives()

  // 4. Watch for future DOM mutations.
  observeDOM()

  // 5. Bridge Alpine if it is already on the page.
  //    If Alpine loads asynchronously after this point, the host application
  //    should call `window.Adowire.initAlpineBridge()` manually, or use
  //    Alpine's `alpine:init` event.
  initAlpineBridge()

  // Also expose initAlpineBridge on the global so late-loading Alpine setups
  // can trigger it: document.addEventListener('alpine:init', () => window.Adowire.initAlpineBridge())
  ;(window.Adowire as any).initAlpineBridge = initAlpineBridge
})
