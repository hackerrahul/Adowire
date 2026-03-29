/**
 * adowire — Development-mode template state proxy
 *
 * Wraps the data object passed to Edge.js `render()` in a `Proxy` that logs
 * warnings whenever the template reads a property that does not exist in the
 * component's public state — **including nested objects**.
 *
 * **Why?**
 * Edge.js templates are untyped — `{{ submittedData.naem }}` (a typo for
 * `name`) silently evaluates to `undefined` and renders an empty string.
 * The dev proxy turns those silent failures into visible console warnings
 * so you catch them immediately during development.
 *
 * **Deep proxying**
 * When a property access returns a plain object, that object is itself
 * wrapped in a proxy so that `{{ submittedData.naem }}` warns with the
 * full path `submittedData.naem`.  Proxies are cached per-object in a
 * `WeakMap` so repeated access never creates duplicates.
 *
 * The proxy is **only** meant for development; in production the raw data
 * object is passed through unchanged (zero overhead).
 *
 * @module
 */

// ─── Properties the proxy should never warn about ─────────────────────────────
//
// These are accessed by JavaScript internals, Edge.js, or Node's `util.inspect`
// and are not user-defined template variables.

const SILENT_PROPS = new Set<string | symbol>([
  // JS engine / object protocol
  'constructor',
  'prototype',
  '__proto__',
  'toString',
  'valueOf',
  'toLocaleString',
  'toJSON',
  'inspect',
  'nodeType',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'length',

  // Promise-like duck-type check (Edge / async helpers call `.then`)
  'then',
  'catch',
  'finally',

  // Node util.inspect / custom inspect
  Symbol.toPrimitive,
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
  Symbol.for('nodejs.util.inspect.custom'),

  // Edge.js internal state keys
  '$filename',
  '$caller',
  '$slots',
  '$props',
  'safe',
  'escape',
  'e',
  'stringify',
  'newError',
  'reThrow',
  'resolve',
  'callSpread',
  'loop',
  'size',
  'excerptFor',
  'toAnchor',
  'el',
  'setOnComponent',

  // Adowire framework keys injected into every template
  '$adowire',
  '$errors',
  '$component',
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns `true` when `value` is a plain object literal (`{}`) that should
 * be deep-proxied.  Arrays, Dates, RegExps, Maps, Sets, class instances,
 * Buffers, and other exotic objects are intentionally excluded — warning on
 * numeric index access or internal method lookups would produce too many
 * false positives.
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// ─── Warning collection ───────────────────────────────────────────────────────

/**
 * Collected warnings from the most recent render pass.
 *
 * Exposed so tests can assert on the warnings without needing to spy on
 * `console.warn`.  Call `flushDevWarnings()` after each render/test to
 * retrieve and clear the list.
 */
let pendingWarnings: string[] = []

/**
 * Retrieve and clear all accumulated dev-proxy warnings.
 */
export function flushDevWarnings(): string[] {
  const out = pendingWarnings
  pendingWarnings = []
  return out
}

// ─── Deep proxy cache ─────────────────────────────────────────────────────────

/**
 * WeakMap from original plain object → its Proxy wrapper.
 * Ensures that `state.foo.bar` and a second `state.foo.bar` return the
 * exact same Proxy instance (referential equality, no duplicate warnings).
 */
const proxyCache = new WeakMap<object, Record<string, any>>()

// ─── Core: recursive proxy factory ───────────────────────────────────────────

/**
 * Create a dev-mode Proxy around `obj` that:
 *
 * 1. Warns when the template reads a property that doesn't exist on the
 *    object (top-level **and** nested).
 * 2. Recursively wraps any plain-object child so the warning includes
 *    the full dotted path (`submittedData.naem`).
 * 3. Caches proxies in a `WeakMap` so repeated access is free.
 *
 * @param obj            The object to proxy.
 * @param path           Dotted path used in the warning message (e.g. `""` for
 *                       the root, `"submittedData"` for a nested object).
 * @param componentName  Component name for the warning message.
 */
function createDeepProxy(
  obj: Record<string, any>,
  path: string,
  componentName: string
): Record<string, any> {
  // Return a previously created proxy if available
  const cached = proxyCache.get(obj)
  if (cached) return cached

  const validKeys = new Set(Object.keys(obj))

  const proxy: Record<string, any> = new Proxy(obj, {
    get(target, prop, receiver) {
      // Only warn for string keys that are clearly user-defined
      if (
        typeof prop === 'string' &&
        !validKeys.has(prop) &&
        !SILENT_PROPS.has(prop) &&
        !prop.startsWith('__') &&
        !prop.startsWith('$')
      ) {
        const fullPath = path ? `${path}.${prop}` : prop
        const available = [...validKeys]
          .filter((k) => !k.startsWith('$'))
          .sort()
          .join(', ')

        const msg =
          `[adowire] Component "${componentName}" — template accessed undefined ` +
          `property "${fullPath}".  Available keys: ${available || '(none)'}`

        pendingWarnings.push(msg)
        console.warn(msg)
      }

      const value = Reflect.get(target, prop, receiver)

      // Deep proxy: recursively wrap plain-object children.
      // Skip $-prefixed framework objects ($errors, $component, etc.) —
      // their internal keys are dynamic by design and would cause
      // false-positive warnings (e.g. @error('name') checks $errors.name
      // which legitimately doesn't exist when there are no errors).
      if (isPlainObject(value) && typeof prop === 'string' && !prop.startsWith('$')) {
        const childPath = path ? `${path}.${String(prop)}` : String(prop)
        return createDeepProxy(value, childPath, componentName)
      }

      return value
    },

    // `in` operator — delegate truthfully so @if guards work correctly.
    has(target, prop) {
      return Reflect.has(target, prop)
    },

    // Object.keys / for…in — delegate truthfully.
    ownKeys(target) {
      return Reflect.ownKeys(target)
    },

    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  })

  proxyCache.set(obj, proxy)
  return proxy
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap `data` in a development Proxy that warns about accessing properties
 * not present in the object — at any nesting depth.
 *
 * @param data           The template data object (component public state + framework injections).
 * @param componentName  Human-readable component name for the warning message.
 * @returns              A `Proxy` around `data` (or `data` itself when proxying is not possible).
 */
export function createDevStateProxy(
  data: Record<string, any>,
  componentName: string
): Record<string, any> {
  // Bail out if Proxy is not available (very old runtimes, should never
  // happen in Node 18+ but keeps the code defensive).
  if (typeof Proxy === 'undefined') return data

  return createDeepProxy(data, '', componentName)
}

/**
 * Conditionally wrap template data in a dev proxy.
 *
 * Returns the raw `data` unchanged when `enabled` is false (production mode)
 * or when the data is not a plain object.
 *
 * @param data           Template data object.
 * @param componentName  Component name for warnings.
 * @param enabled        Whether dev-mode proxying is active.
 */
export function maybeDevProxy(
  data: Record<string, any>,
  componentName: string,
  enabled: boolean
): Record<string, any> {
  if (!enabled) return data
  if (data === null || typeof data !== 'object') return data
  return createDevStateProxy(data, componentName)
}

/**
 * Determine whether the dev proxy should be active based on the adowire
 * config and the current environment.
 *
 * Resolution order:
 *  1. Explicit `config.devProxy` boolean (if provided)
 *  2. `NODE_ENV !== 'production'`
 *
 * @param config  The adowire config object (may be partial or undefined).
 */
export function isDevProxyEnabled(config?: { devProxy?: boolean }): boolean {
  if (config && typeof config.devProxy === 'boolean') {
    return config.devProxy
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
}
