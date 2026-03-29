import 'reflect-metadata'
import { WIRE_VALIDATE_KEY } from '../types.js'

/**
 * Metadata shape stored under `WIRE_VALIDATE_KEY` on the class prototype.
 *
 * Each decorated property name maps to its rule descriptor:
 * ```ts
 * {
 *   title: { rule: vine.string().minLength(3), onUpdate: true },
 *   email: { rule: vine.string().email(), message: 'Bad email', onUpdate: true },
 * }
 * ```
 */
export type ValidateMetadata = Record<
  string,
  { rule: any; message?: string; as?: string; onUpdate: boolean }
>

/**
 * @Validate(rule, opts?) — Property decorator for declarative VineJS validation.
 *
 * Attaches a VineJS validation rule to a component property. The rule is stored
 * as reflect-metadata on the class prototype under `WIRE_VALIDATE_KEY` and is
 * consumed at runtime by:
 *
 *   - `maybeValidateOnUpdate()` in the request handler — runs validation
 *     automatically whenever the client updates a property (when `onUpdate`
 *     is `true`).
 *   - `WireValidator.validateProperty()` — the low-level engine that compiles
 *     the VineJS schema and executes it.
 *   - `component.validate()` — the component-level entry point.
 *
 * Usage:
 * ```ts
 * import { Validate } from 'adowire/decorators'
 * import vine from '@vinejs/vine'
 *
 * export default class CreatePost extends WireComponent {
 *   @Validate(vine.string().minLength(3))
 *   title: string = ''
 *
 *   @Validate(vine.string().email(), { message: 'Bad email', onUpdate: true })
 *   email: string = ''
 *
 *   @Validate(vine.number().min(0), { as: 'item price', onUpdate: false })
 *   price: number = 0
 * }
 * ```
 *
 * @param rule      A VineJS schema type (e.g. `vine.string()`, `vine.number()`).
 * @param opts.message   Optional override for the default VineJS error message.
 * @param opts.as        Optional display label passed to VineJS as the field name.
 * @param opts.onUpdate  Whether to validate on every client property update.
 *                       Defaults to `true`.
 */
export function Validate(
  rule: any,
  opts?: { message?: string; as?: string; onUpdate?: boolean }
): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    const key = typeof propertyKey === 'symbol' ? propertyKey.toString() : propertyKey

    const existing: ValidateMetadata = Reflect.getMetadata(WIRE_VALIDATE_KEY, target) ?? {}

    Reflect.defineMetadata(
      WIRE_VALIDATE_KEY,
      {
        ...existing,
        [key]: {
          rule,
          message: opts?.message,
          as: opts?.as,
          onUpdate: opts?.onUpdate ?? true,
        },
      },
      target
    )
  }
}
