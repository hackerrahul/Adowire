import type { Synthesizer } from './synthesizer.js'
import type { SerializedMeta, SerializedValue } from '../types.js'

/**
 * Synthesizer for JavaScript `Set` objects.
 *
 * Dehydrated format:
 *   [["a", "b", "c"], { "s": "set" }]
 *
 * The set is stored as a plain JSON array of its values. Values are stored
 * as-is, so only JSON-safe primitives (string, number, boolean, null) are
 * guaranteed to round-trip perfectly. Complex values inside the set are not
 * recursively processed — the SnapshotManager handles top-level synthesis only.
 *
 * If you need a Set of complex types, use a custom synthesizer instead.
 */
export const SetSynthesizer: Synthesizer = {
  key: 'set',

  match(value: unknown): boolean {
    return value instanceof Set
  },

  dehydrate(value: unknown): [SerializedValue, SerializedMeta] {
    const set = value as Set<unknown>
    const items: SerializedValue = [...set.values()] as SerializedValue
    return [items, { s: 'set' }]
  },

  hydrate(value: SerializedValue, _meta: SerializedMeta): unknown {
    if (!Array.isArray(value)) {
      throw new TypeError(
        `SetSynthesizer.hydrate: expected an array of values, got ${typeof value}`
      )
    }
    return new Set(value)
  },
}
