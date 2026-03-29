import type { Synthesizer } from './synthesizer.js'
import type { SerializedMeta, SerializedValue } from '../types.js'

/**
 * Synthesizer for JavaScript `Map` objects.
 *
 * Dehydrated format:
 *   [[[key1, val1], [key2, val2]], { "s": "map" }]
 *
 * Both keys and values are recursively serialised, so a Map whose values
 * are themselves complex types will be handled correctly as long as the
 * outer SnapshotManager processes the entries through its own
 * dehydrate/hydrate pipeline.
 *
 * Note: Map keys are stored as-is in the tuple array. Only JSON-safe
 * primitive keys (string, number, boolean, null) are guaranteed to
 * round-trip perfectly. Object keys are not supported.
 */
export const MapSynthesizer: Synthesizer = {
  key: 'map',

  match(value: unknown): boolean {
    return value instanceof Map
  },

  dehydrate(value: unknown): [SerializedValue, SerializedMeta] {
    const map = value as Map<unknown, unknown>
    // Store as an array of [key, value] pairs — JSON-safe
    const entries: SerializedValue = [...map.entries()].map(([k, v]) => [
      k as SerializedValue,
      v as SerializedValue,
    ]) as SerializedValue
    return [entries, { s: 'map' }]
  },

  hydrate(value: SerializedValue, _meta: SerializedMeta): unknown {
    if (!Array.isArray(value)) {
      throw new TypeError(
        `MapSynthesizer.hydrate: expected an array of entries, got ${typeof value}`
      )
    }
    const map = new Map<unknown, unknown>()
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError(
          `MapSynthesizer.hydrate: each entry must be a [key, value] tuple, got ${JSON.stringify(entry)}`
        )
      }
      const [k, v] = entry
      map.set(k, v)
    }
    return map
  },
}
