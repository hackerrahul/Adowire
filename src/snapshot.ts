import 'reflect-metadata'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { ulid } from 'ulid'
import type { WireComponent } from './component.js'
import type { WireSnapshot, WireMemo, SerializedValue, SerializedMeta } from './types.js'
import { WIRE_COMPUTED_KEY } from './types.js'
import type { Synthesizer } from './synthesizers/synthesizer.js'
import { DateSynthesizer } from './synthesizers/date_synthesizer.js'
import { MapSynthesizer } from './synthesizers/map_synthesizer.js'
import { SetSynthesizer } from './synthesizers/set_synthesizer.js'

// ─── Primitive guard ──────────────────────────────────────────────────────────

/**
 * Returns `true` for values that can be stored in the snapshot without any
 * synthesizer — i.e. every type that JSON natively round-trips without loss.
 */
function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * Returns `true` for plain objects (created via `{}` or `Object.create(null)`).
 * Arrays and class instances return `false`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// ─── SnapshotManager ─────────────────────────────────────────────────────────

/**
 * Manages serialisation (dehydration) and deserialisation (hydration) of
 * `WireComponent` state to and from a `WireSnapshot`.
 *
 * The snapshot is a JSON-safe object that is signed with an HMAC-SHA256
 * checksum using the application's `APP_KEY`. Any tampering with the
 * snapshot on the client will cause the checksum to fail on the next request,
 * throwing a `ChecksumException`.
 *
 * Complex types (Date, Map, Set, user-defined) are serialised using
 * _synthesizers_ — small objects that each handle one type. Built-in
 * synthesizers for Date, Map, and Set are registered automatically.
 * Custom synthesizers can be registered via `SnapshotManager.register()`.
 *
 * @example
 * ```ts
 * const manager = new SnapshotManager(appKey)
 * const snapshot = manager.dehydrate(component)
 * // ... round-trip through the client ...
 * manager.hydrate(component, snapshot)
 * ```
 */
export class SnapshotManager {
  /**
   * Ordered list of registered synthesizers.
   * Checked in order during dehydration — first match wins.
   */
  private synthesizers: Synthesizer[] = [DateSynthesizer, MapSynthesizer, SetSynthesizer]

  constructor(private readonly secret: string) {
    if (!secret || secret.trim() === '') {
      throw new Error('SnapshotManager: a non-empty secret (APP_KEY) is required for HMAC signing.')
    }
  }

  // ─── Synthesizer Registry ─────────────────────────────────────────────────

  /**
   * Register a custom synthesizer.
   *
   * Synthesizers are checked in the order they were registered, **before**
   * the built-in ones. This means a custom synthesizer for `'date'` would
   * shadow the built-in DateSynthesizer.
   *
   * @param synthesizer The synthesizer implementation to register
   */
  register(synthesizer: Synthesizer): void {
    // Prepend so custom synthesizers take priority over built-ins
    this.synthesizers = [synthesizer, ...this.synthesizers]
  }

  // ─── Dehydration (Component → Snapshot) ───────────────────────────────────

  /**
   * Serialise the component's current public state into a `WireSnapshot`.
   *
   * Steps:
   * 1. Collect all public state (excluding computed properties — like Livewire 4,
   *    computed values are derived fresh each request and never persisted)
   * 2. Serialise each value through the synthesizer pipeline
   * 3. Build the `memo` metadata block
   * 4. Sign the snapshot with an HMAC-SHA256 checksum
   *
   * @param component The component instance to serialise
   * @param ctx       Optional request context for path/method/locale info
   */
  async dehydrate(
    component: WireComponent,
    ctx?: { path?: string; method?: string; locale?: string }
  ): Promise<WireSnapshot> {
    // 1. Collect public state — computed properties are intentionally excluded.
    //    Like Livewire 4, computed values are recalculated on each request
    //    and only injected into the template data at render time.
    const rawState = component.$getPublicState()
    const state: Record<string, SerializedValue> = {}
    for (const [key, value] of Object.entries(rawState)) {
      state[key] = this.dehydrateValue(value)
    }

    // 3. Build memo
    const memo: WireMemo = {
      name: component.$name,
      id: component.$id || ulid(),
      children: {},
      errors: component.$serializeErrors(),
      locale: ctx?.locale ?? 'en',
      path: ctx?.path,
      method: ctx?.method,
    }

    // 4. Sign
    const checksum = this.sign({ state, memo })

    return { state, memo, checksum }
  }

  /**
   * Restore a component's public state from a previously dehydrated snapshot.
   *
   * Steps:
   * 1. Verify the HMAC checksum — throws `ChecksumException` if invalid
   * 2. Hydrate each serialised value back to its original type
   * 3. Set properties on the component instance (skipping computed keys
   *    to avoid shadowing prototype methods with primitive values)
   * 4. Restore `$id`, `$name`, and `$errors` from the memo
   *
   * @param component The component instance to restore into
   * @param snapshot  The snapshot received from the client
   */
  hydrate(component: WireComponent, snapshot: WireSnapshot): void {
    // 1. Verify checksum before doing anything with the data
    this.verify(snapshot)

    // 2. Restore framework fields from memo
    component.$id = snapshot.memo.id
    component.$name = snapshot.memo.name
    component.$restoreErrors(snapshot.memo.errors ?? {})

    // 3. Build a set of computed keys so we can skip them during hydration.
    //    This is a safety net: computed keys should not be in the snapshot
    //    (dehydrate excludes them), but older snapshots or edge cases might
    //    still contain them. Skipping prevents shadowing prototype methods.
    const proto = Object.getPrototypeOf(component)
    const computedKeys: Set<string> = new Set(Reflect.getMetadata(WIRE_COMPUTED_KEY, proto) ?? [])

    // 4. Hydrate and assign each property (skip computed keys).
    //
    //    AdonisJS bodyparser's `convertEmptyStringsToNull: true` (the default)
    //    converts every `""` in the parsed JSON body to `null`. Because the
    //    snapshot state travels through the POST body, empty-string properties
    //    arrive as `null` on the server. The HMAC checksum still passes (the
    //    `sign()` method normalises `""` → `null` before hashing), but if we
    //    blindly assign the `null` we corrupt string properties that were
    //    originally `""`.
    //
    //    Fix: when the hydrated value is `null` but the component's current
    //    own-property (set by the class-field initialiser in the constructor)
    //    is a string, restore the value to `""` instead. This preserves
    //    intentional `null` values (the class field would also be `null`) while
    //    undoing the bodyparser's conversion for string fields.
    for (const [key, serialized] of Object.entries(snapshot.state)) {
      if (computedKeys.has(key)) continue
      const hydrated = this.hydrateValue(serialized)

      if (hydrated === null && typeof (component as any)[key] === 'string') {
        // Bodyparser converted "" → null; restore the empty string.
        ;(component as any)[key] = ''
      } else {
        ;(component as any)[key] = hydrated
      }
    }
  }

  // ─── HMAC Signing & Verification ──────────────────────────────────────────

  /**
   * Produce an HMAC-SHA256 hex digest for the given `state` + `memo` payload.
   * The payload is deterministically serialised to JSON before signing.
   *
   * @internal
   */
  sign(payload: { state: Record<string, SerializedValue>; memo: WireMemo }): string {
    // Normalize empty strings → null before signing so the HMAC is identical
    // regardless of whether AdonisJS bodyparser's `convertEmptyStringsToNull`
    // converts "" → null in the parsed POST body.
    const json = JSON.stringify(payload, (_key, value) => (value === '' ? null : value))
    return createHmac('sha256', this.secret).update(json).digest('hex')
  }

  /**
   * Verify the checksum on a snapshot.
   * Throws `ChecksumException` if the snapshot has been tampered with.
   *
   * Uses a timing-safe comparison to prevent timing attacks.
   *
   * @internal
   */
  verify(snapshot: WireSnapshot): void {
    const expected = this.sign({ state: snapshot.state, memo: snapshot.memo })
    const received = snapshot.checksum ?? ''

    // Both must have the same byte length for timingSafeEqual
    const expectedBuf = Buffer.from(expected, 'utf8')
    const receivedBuf = Buffer.from(received.padEnd(expected.length, '\0'), 'utf8')

    const safeLen = expectedBuf.length === receivedBuf.length
    const match = safeLen && timingSafeEqual(expectedBuf, receivedBuf)

    if (!match) {
      throw new ChecksumException(
        'Adowire snapshot checksum mismatch — the snapshot may have been tampered with.'
      )
    }
  }

  // ─── Value Serialisation Pipeline ─────────────────────────────────────────

  /**
   * Recursively serialise a single value.
   *
   * - Primitives (string, number, boolean, null, undefined) → pass through
   * - Arrays → each element is recursively serialised
   * - Plain objects → each value is recursively serialised
   * - Complex types → first matching synthesizer produces a tuple `[data, meta]`
   * - Unrecognised types → `null` (logged in dev, silently dropped in prod)
   *
   * @internal
   */
  dehydrateValue(value: unknown): SerializedValue {
    // Primitives pass through untouched
    if (isPrimitive(value)) return value as SerializedValue

    // Check synthesizers first (before array/object checks so a custom
    // synthesizer can intercept e.g. a special Array subclass)
    for (const synth of this.synthesizers) {
      if (synth.match(value)) {
        const [data, meta] = synth.dehydrate(value)
        // Recursively serialise the data portion in case it contains complex types
        return [this.dehydrateValue(data), meta]
      }
    }

    // Plain arrays — recurse into elements
    if (Array.isArray(value)) {
      return (value as unknown[]).map((item) => this.dehydrateValue(item))
    }

    // Plain objects — recurse into values
    if (isPlainObject(value)) {
      const result: Record<string, SerializedValue> = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.dehydrateValue(v)
      }
      return result
    }

    // Unrecognised — drop with null
    return null
  }

  /**
   * Recursively hydrate a single serialised value back to its original type.
   *
   * - Primitives → pass through
   * - Arrays that look like a `[data, { s: 'type' }]` tuple → find synthesizer
   * - Plain arrays → each element is recursively hydrated
   * - Plain objects → each value is recursively hydrated
   *
   * @internal
   */
  hydrateValue(value: SerializedValue): unknown {
    // Primitives
    if (isPrimitive(value)) return value

    // Synthesizer tuple detection:
    // A tuple is a 2-element array where the second element is an object
    // with a string `s` property.
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      isPlainObject(value[1]) &&
      typeof (value[1] as SerializedMeta).s === 'string'
    ) {
      const [data, meta] = value as [SerializedValue, SerializedMeta]
      const synth = this.synthesizers.find((s) => s.key === meta.s)
      if (synth) {
        // Recursively hydrate the inner data before passing to the synthesizer
        return synth.hydrate(this.hydrateValue(data) as SerializedValue, meta)
      }
      // Unknown synthesizer key — return the raw data portion
      return this.hydrateValue(data)
    }

    // Plain array
    if (Array.isArray(value)) {
      return (value as SerializedValue[]).map((item) => this.hydrateValue(item))
    }

    // Plain object
    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, SerializedValue>)) {
        result[k] = this.hydrateValue(v)
      }
      return result
    }

    return value
  }
}

// ─── ChecksumException ────────────────────────────────────────────────────────

/**
 * Thrown by `SnapshotManager.verify()` when the HMAC checksum on an incoming
 * snapshot does not match the expected value.
 *
 * This typically means the snapshot was tampered with on the client, or the
 * `APP_KEY` was rotated between the initial render and this request.
 */
export class ChecksumException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecksumException'
  }
}
