/**
 * adowire client — WireClientComponent
 *
 * Manages the client-side state for a single mounted [adowire:id] component.
 * Each component instance holds a reference to its root DOM element and the
 * latest snapshot received from the server. The `commit()` method is the
 * primary way to communicate with the server — it sends calls and property
 * updates, then morphs the DOM with the returned HTML.
 */

import { Connection } from './connection.js'
import type { WireStream } from './types.js'
import { morphEl } from './morph.js'
import type { WireSnapshot, WireCall, WireComponentResponse } from './types.js'
import { applyLoading, removeLoading } from './directives/loading.js'
import { applyDirtyState } from './directives/dirty.js'
import { applyShowState } from './directives/show.js'
import { uncloakComponent } from './directives/cloak.js'

export class WireClientComponent {
  /** The root DOM element that carries the `adowire:id` attribute. */
  el: HTMLElement

  /** The component's unique ID (value of the `adowire:id` attribute). */
  id: string

  /** The component's class name (value of the `adowire:name` attribute). */
  name: string

  /** The latest snapshot, parsed from the `adowire:snapshot` attribute. */
  snapshot: WireSnapshot

  /** Whether a commit is currently in-flight — prevents overlapping requests. */
  private _committing = false

  /** Queue of pending commits to flush after the current one resolves. */
  private _queue: Array<{ calls: WireCall[]; updates: Record<string, any> }> = []

  constructor(el: HTMLElement) {
    this.el = el
    this.id = el.getAttribute('adowire:id') ?? ''
    this.name = el.getAttribute('adowire:name') ?? ''

    const raw = el.getAttribute('adowire:snapshot')
    if (!raw) {
      throw new Error(
        `[adowire] Component <${el.tagName.toLowerCase()}> is missing the adowire:snapshot attribute`
      )
    }

    try {
      this.snapshot = JSON.parse(raw) as WireSnapshot
    } catch {
      throw new Error(
        `[adowire] Failed to parse adowire:snapshot for component "${this.name}" (id: ${this.id})`
      )
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Read a property from the current snapshot state.
   *
   * For nested access you can pass a dot-separated path:
   *   `component.get('user.email')`
   */
  get(prop: string): any {
    const parts = prop.split('.')
    let value: any = this.snapshot.state
    for (const part of parts) {
      if (value === null || value === undefined || typeof value !== 'object') return undefined
      value = value[part]
    }
    return value
  }

  /**
   * Magic action shorthand — equivalent to calling `$set` on the server.
   * Commits a property update without any additional method calls.
   *
   * @example
   * component.$set('count', 5)
   */
  $set(prop: string, value: any): Promise<void> {
    return this.commit([], { [prop]: value })
  }

  /**
   * Re-render the component without any calls or updates.
   */
  $refresh(): Promise<void> {
    return this.commit([], {})
  }

  /**
   * Send an action call (with optional property updates) to the server,
   * apply the response HTML via morphdom, and update the local snapshot.
   *
   * Commits are serialised — if one is already in-flight the new one is
   * queued and automatically flushed when the current request resolves.
   *
   * @param calls   Array of server-side method calls to invoke.
   * @param updates Map of property name → new value to apply before calling.
   */
  async commit(calls: WireCall[], updates: Record<string, any>): Promise<void> {
    // Serialise concurrent commits to avoid race conditions on snapshot state.
    if (this._committing) {
      return new Promise((resolve, reject) => {
        this._queue.push({ calls, updates })
        // The flush at the end of the current commit will pick this up.
        void this._drainQueue().then(resolve).catch(reject)
      })
    }

    this._committing = true
    try {
      await this._doCommit(calls, updates)
    } finally {
      this._committing = false
      // Flush any queued commits that arrived while we were busy.
      await this._drainQueue()
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Execute a single round-trip: build the payload, POST it, apply effects.
   *
   * When `calls` are present the request is sent as SSE so that any
   * `$stream()` calls inside the server action are pushed to the browser
   * in real-time (word-by-word).  Non-action commits (pure property
   * updates / `$refresh`) use the faster plain-JSON path.
   */
  private async _doCommit(calls: WireCall[], updates: Record<string, any>): Promise<void> {
    applyLoading()

    try {
      const payload = {
        components: [
          {
            snapshot: this.snapshot,
            calls,
            updates,
          },
        ],
      }

      let response

      // Only use SSE streaming when the component actually contains an
      // [adowire:stream] target element — otherwise use the faster
      // plain-JSON path.  This keeps normal actions (counter clicks,
      // form submits, etc.) on the lightweight request/response cycle.
      const hasStreamTarget = !!this.el.querySelector('[adowire\\:stream]')
      const useStreaming = calls.length > 0 && hasStreamTarget

      try {
        if (useStreaming) {
          response = await Connection.requestStreaming(payload, (chunk: WireStream) => {
            this._applyStreamChunk(chunk)
          })
        } else {
          response = await Connection.request(payload)
        }
      } catch (err) {
        console.error(`[adowire] Commit failed for component "${this.name}" (id: ${this.id})`, err)
        throw err
      }

      const componentResponse = response.components[0] as WireComponentResponse | undefined
      if (!componentResponse) {
        console.warn('[adowire] No component data in server response — skipping update')
        return
      }

      this._applyResponse(componentResponse)
    } finally {
      removeLoading()
    }
  }

  /**
   * Apply a single real-time stream chunk pushed over SSE.
   * Finds the matching `[adowire:stream="name"]` element and appends
   * (or replaces) its content immediately.
   */
  private _applyStreamChunk(chunk: WireStream): void {
    const target = document.querySelector(`[adowire\\:stream="${chunk.name}"]`)
    if (!target) return
    if (chunk.replace) {
      target.innerHTML = chunk.content
    } else {
      target.insertAdjacentHTML('beforeend', chunk.content)
    }
  }

  /**
   * Apply a `WireComponentResponse` from the server:
   * 1. Update the local snapshot so future commits carry fresh state.
   * 2. Morph the DOM if new HTML was returned.
   * 3. Process any side-effects (redirect, dispatches, title, etc.).
   */
  private _applyResponse(response: WireComponentResponse): void {
    // 1. Update snapshot first so get() reflects server-authoritative state.
    this.snapshot = response.snapshot

    const effects = response.effects

    // 2. Morph DOM when the server returned fresh HTML.
    if (effects.html) {
      morphEl(this.el, effects.html)

      // After morphing, the root element reference may still be valid (morphdom
      // updates in-place), but re-read the snapshot attribute in case the server
      // embedded an updated one inside the HTML.
      const embeddedSnapshot = this.el.getAttribute('adowire:snapshot')
      if (embeddedSnapshot) {
        try {
          this.snapshot = JSON.parse(embeddedSnapshot) as WireSnapshot
        } catch {
          // Ignore parse failures — keep the response snapshot we already applied.
        }
      }
    }

    // 3. Side-effects ─────────────────────────────────────────────────────────

    // Redirect
    if (effects.redirect) {
      window.location.href = effects.redirect
      return
    }

    // Browser title
    if (effects.title) {
      document.title = effects.title
    }

    // Custom JS snippets (eval'd in order)
    if (effects.js?.length) {
      for (const snippet of effects.js) {
        try {
          new Function(snippet)()
        } catch (err) {
          console.error('[adowire] Error executing server JS effect:', err)
        }
      }
    }

    // Dispatches — emit as CustomEvents on the component's root element
    // and, when flagged, on the window.
    if (effects.dispatches?.length) {
      for (const dispatch of effects.dispatches) {
        const event = new CustomEvent(`adowire:${dispatch.name}`, {
          detail: dispatch.params,
          bubbles: true,
        })

        if (dispatch.self) {
          window.dispatchEvent(event)
        } else if (dispatch.up) {
          this.el.parentElement?.dispatchEvent(event)
        } else if (dispatch.to) {
          const target = document.querySelector(`[adowire\\:id="${dispatch.to}"]`)
          target?.dispatchEvent(event)
        } else {
          this.el.dispatchEvent(event)
        }
      }
    }

    // Streams — append/replace streamed content into named targets
    if (effects.streams?.length) {
      for (const stream of effects.streams) {
        const target = document.querySelector(`[adowire\\:stream="${stream.name}"]`)
        if (!target) continue
        if (stream.replace) {
          target.innerHTML = stream.content
        } else {
          target.insertAdjacentHTML('beforeend', stream.content)
        }
      }
    }

    // Dirty state — re-evaluate now that the snapshot has been updated.
    // Model inputs that match the new server state will no longer be dirty.
    applyDirtyState()

    // Show/hide state — re-evaluate adowire:show expressions against the
    // updated snapshot so elements reflect the latest server-confirmed values.
    // Must run BEFORE uncloakComponent so that elements are already in the
    // correct display state when the cloak attribute is removed. If we
    // uncloaked first, both adowire:show elements would flash visible for one
    // frame before applyShowState hid the wrong one.
    applyShowState()

    // After morphdom the server HTML always re-introduces adowire:cloak
    // attributes (they are static template attributes). The CSS rule
    // `[adowire:cloak] { display: none !important }` injected at boot would
    // permanently hide those elements again. Remove the attribute now — after
    // show/dirty state has already been applied — so the correct display state
    // is revealed with no intermediate flash.
    uncloakComponent(this.el)

    // File download — trigger via a temporary anchor
    if (effects.download) {
      const a = document.createElement('a')
      a.href = effects.download.url
      a.download = effects.download.name
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  /**
   * Flush queued commits one by one.
   * Batches that arrived while we were draining are merged before sending.
   */
  private async _drainQueue(): Promise<void> {
    if (this._committing || this._queue.length === 0) return

    // Drain all pending entries into a single merged commit.
    const pending = this._queue.splice(0)
    const mergedCalls: WireCall[] = []
    const mergedUpdates: Record<string, any> = {}

    for (const entry of pending) {
      mergedCalls.push(...entry.calls)
      Object.assign(mergedUpdates, entry.updates)
    }

    await this.commit(mergedCalls, mergedUpdates)
  }
}
