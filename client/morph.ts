/**
 * adowire client — DOM morphing wrapper
 *
 * Wraps morphdom to apply incremental DOM updates from server-rendered HTML.
 * Elements with a `adowire:ignore` attribute (or any descendant thereof) are
 * skipped so that client-side-only state (e.g. Alpine data, open dropdowns)
 * is preserved across updates.
 */

// morphdom ships as a CJS package without an exports map, so under
// module: NodeNext we import the namespace and call .default() at runtime.
import * as morphdomModule from 'morphdom'

// The callable is either the default export (ESM interop) or the module itself (CJS).
const morphdom: (
  fromNode: Node,
  toNode: Node | string,
  options?: {
    getNodeKey?: (node: Node) => any
    onBeforeNodeAdded?: (node: Node) => false | Node
    onNodeAdded?: (node: Node) => void
    onBeforeElUpdated?: (fromEl: HTMLElement, toEl: HTMLElement) => boolean
    onElUpdated?: (el: HTMLElement) => void
    onBeforeNodeDiscarded?: (node: Node) => boolean
    onNodeDiscarded?: (node: Node) => void
    onBeforeElChildrenUpdated?: (fromEl: HTMLElement, toEl: HTMLElement) => boolean
    childrenOnly?: boolean
  }
) => Node = (morphdomModule as any).default ?? (morphdomModule as any)

/**
 * Morph `fromEl` in-place to match the structure described by `toHtml`.
 *
 * @param fromEl  The live DOM element to update.
 * @param toHtml  The new HTML string to morph into. Must represent a single
 *                root element whose tag matches `fromEl.tagName`.
 */
export function morphEl(fromEl: Element, toHtml: string): void {
  // Parse toHtml into a real Element so morphdom can diff against it.
  // We wrap in a temporary container to handle any tag type safely.
  const template = document.createElement('template')
  template.innerHTML = toHtml.trim()
  const toEl = template.content.firstElementChild

  if (!toEl) {
    console.warn('[adowire] morphEl: toHtml produced no root element — skipping morph')
    return
  }

  // Capture the currently focused element BEFORE morphing starts so we can
  // preserve its value and cursor position. When the user is actively typing
  // into an input/textarea, morphdom would overwrite its `.value` with the
  // server-rendered `value="…"` attribute, resetting the cursor and
  // discarding any characters typed between the request and the response.
  const activeEl = document.activeElement as HTMLElement | null
  const isActiveInput =
    activeEl instanceof HTMLInputElement ||
    activeEl instanceof HTMLTextAreaElement ||
    activeEl instanceof HTMLSelectElement

  morphdom(fromEl, toEl, {
    // ── Skip elements marked adowire:ignore ────────────────────────────────
    onBeforeElUpdated(fromNode: HTMLElement, toNode: HTMLElement) {
      // If the live node carries adowire:ignore, leave it completely alone.
      if (fromNode.hasAttribute('adowire:ignore')) {
        return false
      }

      // ── Preserve focused input value ───────────────────────────────────
      // When the fromNode is the currently focused input/textarea/select,
      // copy its live `.value` onto the incoming toNode so that morphdom
      // sees no difference and leaves the DOM node's value untouched.
      // This prevents cursor jumps and mid-typing value resets — the same
      // technique Livewire uses.
      if (isActiveInput && fromNode === activeEl) {
        if (fromNode instanceof HTMLInputElement && toNode instanceof HTMLInputElement) {
          toNode.value = fromNode.value
          // Preserve checked state for checkboxes / radios
          if (fromNode.type === 'checkbox' || fromNode.type === 'radio') {
            toNode.checked = fromNode.checked
          }
        } else if (
          fromNode instanceof HTMLTextAreaElement &&
          toNode instanceof HTMLTextAreaElement
        ) {
          toNode.value = fromNode.value
          // Also set textContent so morphdom doesn't diff the child text node
          toNode.textContent = fromNode.value
        } else if (fromNode instanceof HTMLSelectElement && toNode instanceof HTMLSelectElement) {
          toNode.value = fromNode.value
        }
      }

      return true
    },

    // ── Preserve elements that should not be removed ─────────────────────
    onBeforeNodeDiscarded(node: Node) {
      // If a node being considered for removal has adowire:ignore, keep it.
      if (node instanceof Element && node.hasAttribute('adowire:ignore')) {
        return false
      }
      return true
    },

    // ── Keep child list additions even inside ignored subtrees ───────────
    // morphdom's default childrenOnly = false means the root is also morphed.
    // We never skip the root itself (fromEl) — only descendants.
    getNodeKey(node: Node) {
      if (node instanceof Element) {
        // Prefer adowire:key, fall back to id so morphdom can match nodes
        // across reorders without re-creating them.
        return node.getAttribute('adowire:key') ?? node.id ?? undefined
      }
      return undefined
    },
  })
}
