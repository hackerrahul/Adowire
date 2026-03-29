import 'reflect-metadata'
import { WIRE_COMPUTED_KEY } from '../types.js'

/**
 * @Computed() — Method decorator for memoized computed properties.
 *
 * Marks a method as a computed property whose return value is cached for the
 * lifetime of a single request cycle. The cached result is included in the
 * component's public state (via `$getPublicState()`) and can be accessed in
 * Edge templates like any other property.
 *
 * The cache is automatically cleared between request cycles by the framework.
 * You can also manually clear it by calling `$clearComputedCache()`.
 *
 * Usage:
 * ```ts
 * import { Computed } from 'adowire/decorators'
 *
 * export default class Cart extends WireComponent {
 *   items: Array<{ price: number; qty: number }> = []
 *
 *   @Computed()
 *   total() {
 *     return this.items.reduce((sum, i) => sum + i.price * i.qty, 0)
 *   }
 *
 *   @Computed()
 *   itemCount() {
 *     return this.items.length
 *   }
 * }
 * ```
 *
 * In the Edge template:
 * ```html
 * <p>Total: ${{ total }}</p>
 * <p>Items: {{ itemCount }}</p>
 * ```
 *
 * Internally this appends the method name to an array stored under the
 * `WIRE_COMPUTED_KEY` metadata key on the class prototype. The runtime
 * consumers are:
 *   - `WireComponent.$getPublicState()` — includes cached computed values in state
 *   - `WireComponent.$resolveComputed(key)` — invokes and caches the method result
 */
export function Computed(): MethodDecorator {
  return function (
    target: Object,
    propertyKey: string | symbol,
    _descriptor: TypedPropertyDescriptor<any>
  ) {
    const key = typeof propertyKey === 'symbol' ? propertyKey.toString() : propertyKey
    const existing: string[] = Reflect.getMetadata(WIRE_COMPUTED_KEY, target) ?? []
    if (!existing.includes(key)) {
      Reflect.defineMetadata(WIRE_COMPUTED_KEY, [...existing, key], target)
    }
  }
}
