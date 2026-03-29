import type { WireComponent } from './component.js'

// ─── WireException ────────────────────────────────────────────────────────────

/**
 * Base class for all adowire server-side exceptions.
 *
 * Thrown during the request lifecycle (boot, hydrate, property update,
 * action call, or dehydrate). Caught by `WireRequestHandler` which calls
 * the component's `exception()` hook before deciding whether to re-throw.
 */
export class WireException extends Error {
  /**
   * The component instance that was being processed when the error occurred.
   * May be undefined if the error happened before the component was resolved.
   */
  public readonly component?: WireComponent

  /**
   * The lifecycle phase in which the error occurred.
   */
  public readonly phase?: WireLifecyclePhase

  constructor(
    message: string,
    options?: {
      component?: WireComponent
      phase?: WireLifecyclePhase
      cause?: unknown
    }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'WireException'
    this.component = options?.component
    this.phase = options?.phase
  }

  /**
   * Wrap any unknown thrown value into a `WireException`.
   * If the value is already a `WireException`, it is returned as-is.
   */
  static wrap(
    err: unknown,
    options?: { component?: WireComponent; phase?: WireLifecyclePhase }
  ): WireException {
    if (err instanceof WireException) return err
    const message = err instanceof Error ? err.message : String(err)
    return new WireException(message, { ...options, cause: err })
  }
}

// ─── ChecksumException ────────────────────────────────────────────────────────

/**
 * Thrown when the HMAC checksum on an incoming snapshot does not match.
 * This typically means the snapshot was tampered with on the client, or the
 * `APP_KEY` was rotated between requests.
 *
 * Results in a 403 response — never re-rendered.
 */
export class ChecksumException extends WireException {
  constructor(message = 'Snapshot checksum mismatch — possible tampering detected.') {
    super(message)
    this.name = 'ChecksumException'
  }
}

// ─── ComponentNotFoundException ───────────────────────────────────────────────

/**
 * Thrown when the request handler cannot find a registered component for the
 * name stored in the snapshot memo.
 *
 * Results in a 404 response.
 */
export class ComponentNotFoundException extends WireException {
  public readonly componentName: string

  constructor(componentName: string) {
    super(
      `Adowire: no component registered under the name "${componentName}". ` +
        `Ensure the component file exists in "app/adowire/" and the registry has been initialised.`
    )
    this.name = 'ComponentNotFoundException'
    this.componentName = componentName
  }
}

// ─── LockedPropertyException ──────────────────────────────────────────────────

/**
 * Thrown when the client attempts to update a property decorated with `@Locked`.
 *
 * Results in a 403 response.
 */
export class LockedPropertyException extends WireException {
  public readonly propertyName: string

  constructor(propertyName: string, component?: WireComponent) {
    super(
      `Adowire: attempted to update locked property "${propertyName}". ` +
        `Properties decorated with @Locked cannot be mutated from the client.`,
      { component, phase: 'updating' }
    )
    this.name = 'LockedPropertyException'
    this.propertyName = propertyName
  }
}

// ─── MethodNotCallableException ───────────────────────────────────────────────

/**
 * Thrown when the client attempts to call a method that is not publicly
 * callable (fails the `$isCallable()` guard).
 *
 * Results in a 403 response.
 */
export class MethodNotCallableException extends WireException {
  public readonly methodName: string

  constructor(methodName: string, component?: WireComponent) {
    super(
      `Adowire: method "${methodName}" is not publicly callable. ` +
        `Only public methods that are not lifecycle hooks may be invoked from the client.`,
      { component, phase: 'action' }
    )
    this.name = 'MethodNotCallableException'
    this.methodName = methodName
  }
}

// ─── RenderException ──────────────────────────────────────────────────────────

/**
 * Thrown when an error occurs during Edge.js template rendering.
 */
export class RenderException extends WireException {
  public readonly viewName: string

  constructor(viewName: string, cause: unknown, component?: WireComponent) {
    super(
      `Adowire: failed to render view "${viewName}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { component, phase: 'render', cause }
    )
    this.name = 'RenderException'
    this.viewName = viewName
  }
}

// ─── WireLifecyclePhase ───────────────────────────────────────────────────────

/**
 * The phase of the component lifecycle in which an error occurred.
 */
export type WireLifecyclePhase =
  | 'boot'
  | 'mount'
  | 'hydrate'
  | 'updating'
  | 'action'
  | 'dehydrate'
  | 'render'
  | 'unknown'
