import type { Synthesizer } from './synthesizer.js'
import type { SerializedMeta, SerializedValue } from '../types.js'

/**
 * Synthesizer for JavaScript `Date` objects.
 *
 * Dehydrated format:
 *   ["2024-01-01T00:00:00.000Z", { "s": "date" }]
 *
 * The date is stored as an ISO 8601 string (UTC) so it survives JSON
 * serialisation without any precision loss.
 */
export const DateSynthesizer: Synthesizer = {
  key: 'date',

  match(value: unknown): boolean {
    return value instanceof Date
  },

  dehydrate(value: unknown): [SerializedValue, SerializedMeta] {
    const date = value as Date
    return [date.toISOString(), { s: 'date' }]
  },

  hydrate(value: SerializedValue, _meta: SerializedMeta): unknown {
    if (typeof value !== 'string') {
      throw new TypeError(`DateSynthesizer.hydrate: expected a string, got ${typeof value}`)
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new TypeError(`DateSynthesizer.hydrate: invalid date string "${value}"`)
    }
    return date
  },
}
