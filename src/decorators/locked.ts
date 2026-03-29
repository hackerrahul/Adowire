import 'reflect-metadata'
import { WIRE_LOCKED_KEY } from '../types.js'

/**
 * @Locked() — Property decorator that prevents client-side mutation.
 *
 * When a property is decorated with `@Locked()`, any attempt by the client to
 * update it via a snapshot property update will be rejected with a
 * `LockedPropertyException` thrown by the request handler's `applyUpdates()`.
 *
 * The property can still be changed server-side (in `mount()`, actions, hooks,
 * etc.) — the lock only applies to *incoming* client updates.
 *
 * Usage:
 * ```ts
 * import { Locked } from 'adowire/decorators'
 *
 * export default class Invoice extends WireComponent {
 *   @Locked()
 *   invoiceId: string = ''
 *
 *   @Locked()
 *   userId: number = 0
 *
 *   total: number = 0 // ← this one CAN be updated from client
 * }
 * ```
 *
 * Internally this appends the property name to an array stored under the
 * `WIRE_LOCKED_KEY` metadata key on the class prototype. The runtime consumer
 * is `WireComponent.$getLockedProperties()` which returns `string[]`.
 */
export function Locked(): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    const key = typeof propertyKey === 'symbol' ? propertyKey.toString() : propertyKey
    const existing: string[] = Reflect.getMetadata(WIRE_LOCKED_KEY, target) ?? []
    if (!existing.includes(key)) {
      Reflect.defineMetadata(WIRE_LOCKED_KEY, [...existing, key], target)
    }
  }
}
