/**
 * adowire client — adowire:cloak directive
 *
 * Hides elements decorated with `adowire:cloak` until the component has fully
 * booted on the client side, then reveals them by removing the attribute.
 *
 * This prevents a flash-of-unstyled/uninitialized content (FOUC) for elements
 * that rely on client-side interactivity (Alpine expressions, dynamic bindings,
 * etc.) and should not be visible until JavaScript has taken over.
 *
 * How it works:
 *
 * 1. A tiny inline `<style>` rule is injected (once) at boot time:
 *      `[adowire\:cloak] { display: none !important; }`
 *    This ensures cloaked elements are hidden immediately — even before this
 *    script executes — as long as the style tag is in the `<head>` or the
 *    host app includes the equivalent rule in its own stylesheet.
 *
 * 2. When `uncloakAll()` is called (after `Adowire.init()` mounts every
 *    component), all `[adowire:cloak]` attributes are removed, causing the
 *    CSS rule to no longer match and the elements to become visible.
 *
 * 3. A scoped `uncloakComponent(root)` helper is also exported so that
 *    dynamically mounted components (via MutationObserver) can be uncloaked
 *    individually without touching the rest of the page.
 *
 * Public API
 * ──────────
 *   initCloak()              — inject the hiding CSS rule (call once at boot)
 *   uncloakAll()             — remove adowire:cloak from every element on the page
 *   uncloakComponent(root)   — remove adowire:cloak from a single component subtree
 */

// ─── CSS selector ─────────────────────────────────────────────────────────────

/** Elements hidden until the component boots. */
const SEL_CLOAK = '[adowire\\:cloak]'

/** ID for the injected <style> element so we can avoid duplicates. */
const STYLE_ID = 'adowire-cloak-style'

// ─── State ────────────────────────────────────────────────────────────────────

let initialized = false

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Inject a `<style>` rule that hides all `[adowire:cloak]` elements.
 *
 * The rule uses `!important` so it wins over any inline `display` value the
 * server may have rendered. Once the attribute is removed the rule no longer
 * matches and the element's original display value takes effect.
 *
 * Safe to call multiple times — the style tag is only injected once.
 */
export function initCloak(): void {
  if (initialized) return
  initialized = true

  // Don't inject if the page already contains the rule (e.g. from a
  // server-rendered <style> tag or the host app's stylesheet).
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = '[adowire\\:cloak] { display: none !important; }'
  document.head.appendChild(style)
}

// ─── Uncloak ──────────────────────────────────────────────────────────────────

/**
 * Remove the `adowire:cloak` attribute from every element on the page,
 * revealing all previously hidden content.
 *
 * Intended to be called once after all components have been initialised
 * during the initial page bootstrap.
 */
export function uncloakAll(): void {
  const els = document.querySelectorAll<HTMLElement>(SEL_CLOAK)
  for (const el of els) {
    el.removeAttribute('adowire:cloak')
  }
}

/**
 * Remove the `adowire:cloak` attribute from a single component root and
 * any cloaked descendants within it.
 *
 * Useful for dynamically mounted components that appear after the initial
 * bootstrap (e.g. components injected via streaming or client-side navigation).
 *
 * @param root  The component's root `[adowire:id]` element.
 */
export function uncloakComponent(root: HTMLElement): void {
  // The root itself may carry the attribute.
  if (root.hasAttribute('adowire:cloak')) {
    root.removeAttribute('adowire:cloak')
  }

  // Any cloaked descendants within this component subtree.
  const nested = root.querySelectorAll<HTMLElement>(SEL_CLOAK)
  for (const el of nested) {
    el.removeAttribute('adowire:cloak')
  }
}
