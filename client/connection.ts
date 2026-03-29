/**
 * adowire client — HTTP connection layer
 *
 * Handles POSTing component commit payloads to the server and returning
 * the parsed JSON response.
 *
 * Supports two modes:
 *  1. **Standard JSON** — single POST → JSON response (default).
 *  2. **SSE streaming** — POST with `Accept: text/event-stream` so the
 *     server can push `$stream()` chunks in real-time (word-by-word AI
 *     output, progress updates, etc.).  The final component response is
 *     delivered as the last SSE event.
 */

import type { WireRequestPayload, WireResponse, WireStream } from './types.js'

/**
 * Callback invoked for every real-time stream chunk the server pushes
 * over the SSE connection.
 */
export type StreamChunkCallback = (chunk: WireStream) => void

export class Connection {
  // ─── Shared helpers ─────────────────────────────────────────────────────

  /** Resolve the adowire message endpoint at call-time. */
  private static get endpoint(): string {
    return window.Adowire?.endpoint ?? '/adowire/message'
  }

  /** Read the CSRF token from the `<meta name="csrf-token">` tag. */
  private static get csrfToken(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  }

  /** Build the common request headers. */
  private static baseHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': accept,
      'X-Requested-With': 'XMLHttpRequest',
    }

    const token = Connection.csrfToken
    if (token) {
      headers['X-CSRF-TOKEN'] = token
    }

    return headers
  }

  // ─── Standard JSON request ──────────────────────────────────────────────

  /**
   * POST the given payload to the adowire message endpoint and return the
   * parsed response.
   *
   * This is the non-streaming path — all effects (including any buffered
   * `$stream` chunks) arrive together in one JSON body.
   */
  static async request(payload: WireRequestPayload): Promise<WireResponse> {
    const response = await fetch(Connection.endpoint, {
      method: 'POST',
      headers: Connection.baseHeaders('application/json'),
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(
        `[adowire] Server returned ${response.status} ${response.statusText} for ${Connection.endpoint}`
      )
    }

    const json = (await response.json()) as WireResponse

    if (!json || !Array.isArray(json.components)) {
      throw new Error('[adowire] Unexpected response shape — missing `components` array')
    }

    return json
  }

  // ─── SSE streaming request ──────────────────────────────────────────────

  /**
   * POST the payload requesting an SSE (`text/event-stream`) response.
   *
   * The server will push zero or more `event: stream` frames (each carrying
   * a single `WireStream` chunk) followed by exactly one `event: response`
   * frame with the full `WireResponse` JSON.
   *
   * @param payload   The standard adowire request payload.
   * @param onStream  Called **synchronously** for every stream chunk the
   *                  server pushes.  The callback should append/replace the
   *                  content into the matching `[adowire:stream]` element.
   * @returns         The final `WireResponse` (snapshot + effects + HTML).
   */
  static async requestStreaming(
    payload: WireRequestPayload,
    onStream: StreamChunkCallback
  ): Promise<WireResponse> {
    const response = await fetch(Connection.endpoint, {
      method: 'POST',
      headers: Connection.baseHeaders('text/event-stream'),
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`[adowire] SSE: server returned ${response.status} ${response.statusText}`)
    }

    // If the server responded with plain JSON (e.g. no streaming was needed),
    // fall back to the standard path so everything still works.
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const json = (await response.json()) as WireResponse
      if (!json || !Array.isArray(json.components)) {
        throw new Error('[adowire] Unexpected response shape — missing `components` array')
      }
      return json
    }

    // ── Parse the SSE event stream ────────────────────────────────────────
    return Connection.parseSSE(response, onStream)
  }

  /**
   * Read the SSE body from `response`, dispatch stream chunks via
   * `onStream`, and resolve with the final `WireResponse`.
   */
  private static async parseSSE(
    response: Response,
    onStream: StreamChunkCallback
  ): Promise<WireResponse> {
    const body = response.body
    if (!body) {
      throw new Error('[adowire] SSE response has no readable body')
    }

    const reader = body.getReader()
    const decoder = new TextDecoder()

    // SSE parsing state — we accumulate lines and process complete events.
    let buffer = ''
    let currentEvent = ''
    let currentData = ''
    let finalResponse: WireResponse | null = null

    const processEvent = () => {
      const eventName = currentEvent || 'message'
      const data = currentData.trim()

      if (!data) {
        currentEvent = ''
        currentData = ''
        return
      }

      try {
        if (eventName === 'stream') {
          const chunk = JSON.parse(data) as WireStream
          onStream(chunk)
        } else if (eventName === 'response') {
          finalResponse = JSON.parse(data) as WireResponse
        } else if (eventName === 'error') {
          const err = JSON.parse(data) as { error: string }
          console.error('[adowire] SSE server error:', err.error)
        }
        // Ignore unknown event types gracefully.
      } catch (parseErr) {
        console.error('[adowire] SSE: failed to parse event data:', parseErr)
      }

      currentEvent = ''
      currentData = ''
    }

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        // Process any remaining buffered event when the stream ends.
        if (currentData) {
          processEvent()
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })

      // SSE spec: events are separated by blank lines (\n\n).
      // Each line is either "event: <name>", "data: <value>", or a comment.
      const lines = buffer.split('\n')

      // Keep the last (potentially incomplete) line in the buffer.
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line === '') {
          // Blank line = end of current event.
          processEvent()
        } else if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          // Concatenate multiple `data:` lines with newlines (SSE spec).
          if (currentData) {
            currentData += '\n'
          }
          currentData += line.slice(5).trim()
        }
        // Ignore comments (lines starting with ':') and unknown fields.
      }
    }

    if (!finalResponse) {
      throw new Error('[adowire] SSE stream ended without a final response event')
    }

    return finalResponse
  }
}
