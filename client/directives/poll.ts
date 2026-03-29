/**
 * adowire client — adowire:poll directive
 *
 * Periodically calls `component.$refresh()` on the owning [adowire:id]
 * component at a configurable interval. Mirrors Livewire's wire:poll behaviour.
 *
 * Attribute value formats:
 *   adowire:poll              → 2000ms (default)
 *   adowire:poll="2s"         → 2000ms
 *   adowire:poll="500ms"      → 500ms
 *   adowire:poll="10s"        → 10000ms
 *
 * Behaviour:
 *   - Polling is paused while the tab is not visible (`document.hidden`).
 *   - Polling stops when the component's root element leaves the DOM.
 *   - A WeakMap prevents double-registration when the MutationObserver fires
 *     on the same element more than once.
 *   - `registerPollDirective()` is idempotent — safe to call multiple times.
 */

import type { WireClientComponent } from '../component.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 2_000

// ─── Interval parser ──────────────────────────────────────────────────────────

/**
 * Parse the string value of an `adowire:poll` attribute into a millisecond
 * duration.
 *
 * Recognised formats:
 *   - `null` / `""` → {@link DEFAULT_INTERVAL_MS}
 *   - `"500ms"`     → 500
 *   - `"2s"`        → 2000
 *   - `"10s"`       → 10000
 *   - bare number   → treated as milliseconds
 *
 * Unrecognised values fall back to the default and emit a console warning.
 */
export function parsePollInterval(value: string | null): number {
  if (!value || value.trim() === '') return DEFAULT_INTERVAL_MS

  const trimmed = value.trim()

  // "Xms" — explicit milliseconds
  const msMatch = trimmed.match(/^(\d+(?:\.\d+)?)ms$/)
  if (msMatch) return Math.max(1, Number.parseFloat(msMatch[1]))

  // "Xs" — seconds → convert to ms
  const sMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/)
  if (sMatch) return Math.max(1, Number.parseFloat(sMatch[1]) * 1_000)

  // Bare integer / float — treat as milliseconds
  const bare = Number.parseFloat(trimmed)
  if (!Number.isNaN(bare) && trimmed.length > 0) return Math.max(1, bare)

  console.warn(
    `[adowire] adowire:poll: unrecognised interval value "${value}", ` +
      `falling back to ${DEFAULT_INTERVAL_MS}ms`
  )
  return DEFAULT_INTERVAL_MS
}

// ─── Interval registry ────────────────────────────────────────────────────────

/**
 * Map from a `[adowire:poll]` element → its active `setInterval` handle.
 *
 * Using a WeakMap means entries are automatically eligible for garbage
 * collection once the element is no longer reachable — no manual cleanup is
 * needed beyond calling `clearInterval`.
 */
const elementIntervals = new WeakMap<Element, ReturnType<typeof setInterval>>()

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Begin polling for a single `[adowire:poll]` element.
 *
 * Idempotent — if the element already has an active interval this is a no-op.
 */
function startPolling(pollEl: Element): void {
  // Guard: already tracked — do not create a second interval.
  if (elementIntervals.has(pollEl)) return

  // Resolve the nearest ancestor component root.
  const componentEl = pollEl.closest('[adowire\\:id]') as HTMLElement | null
  if (!componentEl) {
    console.warn('[adowire] adowire:poll: no parent [adowire:id] found for', pollEl)
    return
  }

  const componentId = componentEl.getAttribute('adowire:id')
  if (!componentId) return

  const intervalMs = parsePollInterval(pollEl.getAttribute('adowire:poll'))

  const handle = setInterval(() => {
    // ── Visibility guard — skip tick when the tab is not visible ──────────
    if (document.hidden) return

    // ── Stale guard — stop if the component root left the DOM ─────────────
    if (!document.contains(componentEl)) {
      clearInterval(handle)
      elementIntervals.delete(pollEl)
      return
    }

    // ── Resolve component instance from the global registry ───────────────
    const component = window.Adowire?.components.get(componentId) as WireClientComponent | undefined

    if (!component) {
      // Component was unmounted from the registry — stop polling.
      clearInterval(handle)
      elementIntervals.delete(pollEl)
      return
    }

    void component.$refresh()
  }, intervalMs)

  elementIntervals.set(pollEl, handle)
}

/**
 * Stop polling for a single `[adowire:poll]` element.
 *
 * No-op if the element was never registered or has already been cleaned up.
 */
function stopPolling(pollEl: Element): void {
  const handle = elementIntervals.get(pollEl)
  if (handle !== undefined) {
    clearInterval(handle)
    elementIntervals.delete(pollEl)
  }
}

/**
 * Scan a subtree root (defaults to `document`) for `[adowire:poll]` elements
 * and start polling for any that are not yet tracked.
 */
function scanAndStart(root: ParentNode = document): void {
  const els = root.querySelectorAll<Element>('[adowire\\:poll]')
  for (const el of els) {
    startPolling(el)
  }
}

// ─── Directive registration ───────────────────────────────────────────────────

/** Guard against double-registration across multiple `registerPollDirective()` calls. */
let registered = false

/**
 * Register the `adowire:poll` directive.
 *
 * 1. Immediately scans the current DOM for `[adowire:poll]` elements and
 *    starts their intervals.
 * 2. Attaches a `MutationObserver` on `document.body` to handle elements
 *    added or removed after initial page load.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function registerPollDirective(): void {
  if (registered) return
  registered = true

  // 1. Bootstrap — pick up elements already present in the DOM.
  scanAndStart()

  // 2. Observe future DOM mutations.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // ── Nodes added ──────────────────────────────────────────────────────
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue

        // The added node itself might carry the directive.
        if (node.hasAttribute('adowire:poll')) {
          startPolling(node)
        }

        // Descendants of the added node may also carry adowire:poll
        // (e.g. a server-streamed partial containing multiple pollers).
        const nested = node.querySelectorAll<Element>('[adowire\\:poll]')
        for (const child of nested) {
          startPolling(child)
        }
      }

      // ── Nodes removed ────────────────────────────────────────────────────
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue

        if (node.hasAttribute('adowire:poll')) {
          stopPolling(node)
        }

        const nested = node.querySelectorAll<Element>('[adowire\\:poll]')
        for (const child of nested) {
          stopPolling(child)
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
}
