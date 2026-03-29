/**
 * adowire — WireValidator
 *
 * Validation engine that executes VineJS rules against component property
 * values. Used by the request handler's `maybeValidateOnUpdate()` flow and
 * by `WireComponent.validate()` to run per-property or batch validation.
 *
 * Like Livewire, `validate()` returns the **validated data** — the
 * cleaned/coerced values produced by the validator (e.g. trimmed strings,
 * coerced booleans, transformed values). Callers should use the returned
 * data rather than reading properties directly, so that VineJS
 * transformations are honoured.
 *
 * VineJS is a **peer dependency** — it is imported dynamically from the
 * consuming application's `node_modules` (resolved via `process.cwd()`)
 * so the adowire package itself does not hard-depend on it.
 *
 * @module
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ─── Lazy VineJS import ──────────────────────────────────────────────────────

let vineModule: any = null

/**
 * Lazily import `@vinejs/vine` from the **consuming application's**
 * `node_modules` directory. We use `createRequire()` anchored at
 * `process.cwd()` to resolve the package path, then dynamic-import it.
 *
 * This is necessary because a bare `import('@vinejs/vine')` would resolve
 * relative to the adowire package's own directory — where VineJS is only
 * listed as a peer dependency and is typically not installed.
 */
async function getVine() {
  if (!vineModule) {
    try {
      // Resolve the entry point of @vinejs/vine from the app's node_modules.
      const appRequire = createRequire(join(process.cwd(), 'package.json'))
      const vinePath = appRequire.resolve('@vinejs/vine')
      vineModule = await import(pathToFileURL(vinePath).href)
    } catch {
      // Fallback: try a direct import in case the package is hoisted or
      // the consuming app symlinks adowire into its own node_modules.
      // @ts-ignore — dynamic peer dependency
      vineModule = await import('@vinejs/vine')
    }
  }
  return vineModule.default || vineModule
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidatePropertyOpts {
  /** Override the default VineJS error message with a custom one. */
  message?: string
  /** Display label passed to VineJS as the human-readable field name. */
  as?: string
}

/**
 * Result of validating a single property.
 *
 * - `errors`  — array of error messages (empty when valid).
 * - `value`   — the validated/coerced value produced by VineJS. When
 *               validation fails this is `undefined`.
 */
export interface PropertyValidationResult {
  errors: string[]
  value: any
}

/**
 * Result of validating multiple properties in one pass.
 *
 * - `errors`    — `Record<string, string[]>` matching the `$errors` shape.
 *                 Only properties that failed are included.
 * - `validated` — `Record<string, any>` of cleaned/coerced values for
 *                 properties that **passed** validation.
 */
export interface BatchValidationResult {
  errors: Record<string, string[]>
  validated: Record<string, any>
}

// ─── WireValidator ───────────────────────────────────────────────────────────

export class WireValidator {
  /**
   * Validate a single property value against its VineJS rule.
   *
   * Returns a `PropertyValidationResult` containing both the error messages
   * (empty array when valid) and the validated/coerced value produced by
   * VineJS. This allows callers to use the cleaned value — e.g. trimmed
   * strings, coerced booleans, transformed values — rather than the raw
   * input, matching Livewire's `$validated = $this->validate()` semantics.
   *
   * This method never throws; validation failures are captured and returned.
   *
   * @param property  The property name (used as the schema field key).
   * @param value     The current value to validate.
   * @param rule      A VineJS rule (e.g. `vine.string().minLength(3)`).
   * @param opts      Optional overrides for message / display label.
   */
  static async validateProperty(
    property: string,
    value: any,
    rule: any,
    opts?: ValidatePropertyOpts
  ): Promise<PropertyValidationResult> {
    const vine = await getVine()

    const schema = vine.object({ [property]: rule })
    const validator = vine.compile(schema)

    try {
      const result = await validator.validate({ [property]: value })
      // VineJS returns the validated object — extract the property value
      // which may have been coerced/trimmed/transformed by the rule chain.
      return { errors: [], value: result[property] }
    } catch (err: any) {
      return {
        errors: WireValidator.extractMessages(err, property, opts),
        value: undefined,
      }
    }
  }

  /**
   * Validate multiple properties in one pass.
   *
   * Accepts a record keyed by property name, each entry containing the
   * current `value`, the VineJS `rule`, and optional `opts`.
   *
   * Returns a `BatchValidationResult` with:
   * - `errors`    — `Record<string, string[]>` for failed properties only.
   * - `validated` — `Record<string, any>` of cleaned/coerced values for
   *                 properties that passed.
   *
   * @param properties  Map of property → { value, rule, opts? }
   */
  static async validateProperties(
    properties: Record<string, { value: any; rule: any; opts?: ValidatePropertyOpts }>
  ): Promise<BatchValidationResult> {
    const errors: Record<string, string[]> = {}
    const validated: Record<string, any> = {}

    // Validate each property independently so that a failure in one field
    // does not prevent the others from being checked.
    const entries = Object.entries(properties)
    const results = await Promise.all(
      entries.map(([property, { value, rule, opts }]) =>
        WireValidator.validateProperty(property, value, rule, opts)
      )
    )

    for (const [idx, [prop]] of entries.entries()) {
      const result = results[idx]
      if (result.errors.length > 0) {
        errors[prop] = result.errors
      } else {
        validated[prop] = result.value
      }
    }

    return { errors, validated }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  /**
   * Extract human-readable error messages from a VineJS validation error.
   *
   * VineJS throws an error whose `.messages` property is an array of
   * `{ field: string; message: string; rule: string; … }` objects. We
   * collect the `message` strings for the given property.
   *
   * When the caller provides a `message` override in `opts`, **all**
   * VineJS messages for that field are replaced with the single override.
   *
   * @internal
   */
  private static extractMessages(
    err: any,
    property: string,
    opts?: ValidatePropertyOpts
  ): string[] {
    const rawMessages: Array<{ field?: string; message?: string }> = err?.messages ?? []

    // Filter to messages that belong to this property.
    const fieldMessages = rawMessages
      .filter((m) => m.field === property)
      .map((m) => m.message ?? 'Validation failed')

    // If VineJS produced no structured messages, fall back to a generic one.
    if (fieldMessages.length === 0) {
      return [opts?.message ?? 'Validation failed']
    }

    // Honour the per-field message override.
    if (opts?.message) {
      return [opts.message]
    }

    return fieldMessages
  }
}
