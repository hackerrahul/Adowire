import type { SerializedMeta, SerializedValue } from '../types.js'

/**
 * A Synthesizer is responsible for converting a complex JavaScript value
 * (Date, Map, Set, or a user-defined type) to and from a JSON-safe tuple
 * that can be stored in the wire snapshot.
 *
 * Tuple format:
 *   [serializedData, { s: 'type-key', ...extraMeta }]
 *
 * Built-in type keys:
 *   'date' — JavaScript Date / Luxon DateTime
 *   'map'  — JavaScript Map
 *   'set'  — JavaScript Set
 *
 * To register a custom synthesizer:
 *   Adowire.synthesizer(mySynthesizer)
 *
 * @example
 * ```ts
 * import type { Synthesizer, SerializedMeta, SerializedValue } from 'adowire/types'
 *
 * export const BigIntSynthesizer: Synthesizer = {
 *   key: 'bigint',
 *   match(value) { return typeof value === 'bigint' },
 *   dehydrate(value) {
 *     return [(value as bigint).toString(), { s: 'bigint' }]
 *   },
 *   hydrate(value) {
 *     return BigInt(value as string)
 *   },
 * }
 * ```
 */
export interface Synthesizer {
  /**
   * Unique string key that identifies this synthesizer in the snapshot tuple
   * metadata (`{ s: 'key' }`).
   */
  key: string

  /**
   * Return `true` if this synthesizer can handle the given value during
   * dehydration (serialisation).
   *
   * Synthesizers are checked in registration order; the first match wins.
   */
  match(value: unknown): boolean

  /**
   * Convert a complex value into a JSON-safe tuple:
   *   [serialisedData, meta]
   *
   * The `meta.s` field MUST equal `this.key`.
   *
   * @param value The original value to serialise
   */
  dehydrate(value: unknown): [SerializedValue, SerializedMeta]

  /**
   * Reconstruct the original value from a previously dehydrated tuple.
   *
   * @param value The serialised data portion of the tuple
   * @param meta  The metadata portion of the tuple (includes `s`, may have extras)
   */
  hydrate(value: SerializedValue, meta: SerializedMeta): unknown
}
