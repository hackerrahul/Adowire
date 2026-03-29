import 'reflect-metadata'
import type { HttpContext } from '@adonisjs/core/http'
import type { ServerResponse } from 'node:http'
import type { WireComponent } from './component.js'
import type {
  WireRequestPayload,
  WireResponse,
  WireComponentResponse,
  WireEffect,
  WireStream,
  AdowireConfig,
} from './types.js'
import { WIRE_LOCKED_KEY, WIRE_RENDERLESS_KEY, WIRE_VALIDATE_KEY } from './types.js'
import { SnapshotManager, ChecksumException as SnapChecksumException } from './snapshot.js'
import type { ComponentRegistry } from './component_registry.js'
import { ValidationException } from './component.js'
import {
  WireException,
  ChecksumException,
  LockedPropertyException,
  MethodNotCallableException,
  RenderException,
} from './wire_exception.js'

// ─── WireRequestHandler ───────────────────────────────────────────────────────

/**
 * Handles the `POST /adowire/message` endpoint.
 *
 * For each component in the batched request payload it runs the full lifecycle:
 *
 *   1. Verify HMAC checksum
 *   2. Hydrate component from snapshot
 *   3. boot()  — every request
 *   4. hydrate() — subsequent requests only
 *   5. Apply property updates (with @Locked guard + updating/updated hooks)
 *   6. Call action methods (with IoC DI + @Renderless support)
 *   7. dehydrate()
 *   8. Render Edge template (unless skipRender is set)
 *   9. Dehydrate new snapshot
 *  10. Return JSON response with effects
 *
 * Errors are routed through the component's `exception()` hook first.
 * Validation errors from VineJS / `component.validate()` are caught and
 * converted to `$errors` on the component, then re-rendered normally.
 */
export class WireRequestHandler {
  private snapshot: SnapshotManager

  constructor(
    private readonly registry: ComponentRegistry,
    private readonly config: AdowireConfig,
    secretOrSnapshot: string | SnapshotManager,
    private readonly edge?: any
  ) {
    this.snapshot =
      secretOrSnapshot instanceof SnapshotManager
        ? secretOrSnapshot
        : new SnapshotManager(secretOrSnapshot)
  }

  // ─── Main entry point ────────────────────────────────────────────────────

  /**
   * Handle a parsed `POST /adowire/message` request.
   *
   * @param payload  The parsed request body
   * @param ctx      The AdonisJS HTTP context for this request
   */
  async handle(payload: WireRequestPayload, ctx: HttpContext): Promise<WireResponse> {
    const results = await Promise.all(
      payload.components.map((componentPayload) => this.handleComponent(componentPayload, ctx))
    )

    return { components: results }
  }

  /**
   * Convenience method — parse the request body from `ctx`, run the handler,
   * and write the JSON response.
   *
   * When the client sends `Accept: text/event-stream` the handler switches
   * to **SSE streaming mode**: each `$stream()` call inside an action is
   * flushed to the browser immediately as an SSE `stream` event, giving the
   * user a real-time word-by-word experience (e.g. AI/LLM output).  The
   * final component response (snapshot + effects + HTML) is sent as the
   * last `response` event before the connection is closed.
   *
   * Non-streaming requests (the default) still receive a plain JSON body.
   */
  async handleRequest(ctx: HttpContext): Promise<void> {
    const payload = ctx.request.body() as WireRequestPayload

    if (!payload || !Array.isArray(payload.components)) {
      ctx.response.status(400).json({ error: 'Invalid adowire request payload.' })
      return
    }

    // ── Detect whether the client requested SSE streaming ────────────────
    const wantsStream = (ctx.request.header('accept') ?? '').includes('text/event-stream')

    if (wantsStream) {
      await this.handleStreamingRequest(payload, ctx)
      return
    }

    // ── Standard JSON response (non-streaming) ──────────────────────────
    try {
      const response = await this.handle(payload, ctx)
      ctx.response.status(200).json(response)
    } catch (err) {
      if (err instanceof ChecksumException) {
        ctx.response.status(403).json({ error: err.message })
        return
      }
      throw err
    }
  }

  // ─── SSE streaming handler ──────────────────────────────────────────────

  /**
   * Handle a request in SSE streaming mode.
   *
   * 1. Open the response as `text/event-stream`.
   * 2. Wire up each component's `$streamWriter` so that `$stream()` calls
   *    flush an SSE `event: stream` immediately.
   * 3. After all actions complete, send the final component response as
   *    `event: response` and close the connection.
   */
  private async handleStreamingRequest(
    payload: WireRequestPayload,
    ctx: HttpContext
  ): Promise<void> {
    // Grab the raw Node.js ServerResponse so we can write SSE frames
    // without AdonisJS buffering / finalising the response.
    const raw: ServerResponse = (ctx.response as any).response ?? ctx.response

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    })

    const writeSSE = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      // For SSE we process components sequentially so stream chunks
      // arrive in the correct order on the client.
      const results: WireComponentResponse[] = []

      for (const componentPayload of payload.components) {
        const result = await this.handleComponentStreaming(componentPayload, ctx, (chunk) => {
          writeSSE('stream', chunk)
        })
        results.push(result)
      }

      // Send the final full response as the last event.
      const response: WireResponse = { components: results }
      writeSSE('response', response)
    } catch (err) {
      if (err instanceof ChecksumException) {
        writeSSE('error', { error: err.message })
      } else {
        writeSSE('error', { error: 'Internal server error' })
        console.error('[adowire] SSE streaming error:', err)
      }
    } finally {
      raw.end()
    }
  }

  /**
   * Run a single component's lifecycle with a real-time stream writer
   * attached so `$stream()` flushes immediately over SSE.
   */
  private async handleComponentStreaming(
    payload: {
      snapshot: any
      calls: Array<{ method: string; params: any[] }>
      updates: Record<string, any>
    },
    ctx: HttpContext,
    onStream: (chunk: WireStream) => void
  ): Promise<WireComponentResponse> {
    // Re-use the standard handleComponent() but inject the stream writer
    // onto the component before actions run.  We do this by temporarily
    // monkey-patching the component after hydration.
    //
    // To hook into handleComponent we override the component's
    // $streamWriter inside the lifecycle.  The cleanest way without
    // duplicating handleComponent is to wrap the registry's make() so the
    // freshly-created component gets the writer attached.
    //
    // However, to keep things simple and avoid touching the registry, we
    // call handleComponent and inject the writer via a pre-action hook.

    // Verify + hydrate (same as handleComponent start)
    try {
      this.snapshot.verify(payload.snapshot)
    } catch (err) {
      if (err instanceof SnapChecksumException) {
        throw new ChecksumException(err.message)
      }
      throw err
    }

    const name = payload.snapshot.memo?.name
    if (!name) {
      throw new WireException('Adowire: snapshot memo is missing component name.', {
        phase: 'hydrate',
      })
    }

    const component = this.registry.make(name)
    component.$name = name
    component.$ctx = ctx
    component.$config = this.config

    if (this.edge) {
      component.$edge = this.edge
    }

    this.snapshot.hydrate(component, payload.snapshot)

    // ─ Attach the real-time stream writer ─
    component.$streamWriter = onStream

    const isInitialMount = !payload.snapshot.memo?.id
    await this.runLifecycle(component, payload, isInitialMount, ctx)

    // Detach writer so buffered effects are clean
    component.$streamWriter = null

    // Dehydrate
    const newSnapshot = await this.snapshot.dehydrate(component, {
      path: ctx.request.url(),
      method: ctx.request.method(),
      locale: 'en',
    })

    const effects: WireEffect = { ...component.$effects }

    if (!component.$skipRender) {
      try {
        const html = await component.render()
        const snapshotJson = JSON.stringify(newSnapshot).replace(/'/g, '&#39;')
        effects.html =
          `<div adowire:id="${newSnapshot.memo.id}"` +
          ` adowire:name="${name}"` +
          ` adowire:snapshot='${snapshotJson}'` +
          `>${html}</div>`
      } catch (err) {
        throw new RenderException(
          `${this.config.viewPrefix ?? 'adowire'}/${name.replace(/\./g, '/')}`,
          err,
          component
        )
      }
    }

    const pageTitle = component.$getTitle()
    if (pageTitle) {
      effects.title = pageTitle
    }

    return { snapshot: newSnapshot, effects }
  }

  // ─── Single component lifecycle ──────────────────────────────────────────

  private async handleComponent(
    payload: {
      snapshot: any
      calls: Array<{ method: string; params: any[] }>
      updates: Record<string, any>
    },
    ctx: HttpContext
  ): Promise<WireComponentResponse> {
    // 1. Verify checksum — throws ChecksumException on tamper
    let component: WireComponent
    try {
      this.snapshot.verify(payload.snapshot)
    } catch (err) {
      if (err instanceof SnapChecksumException) {
        throw new ChecksumException(err.message)
      }
      throw err
    }

    // 2. Resolve and hydrate component
    const name = payload.snapshot.memo?.name
    if (!name) {
      throw new WireException('Adowire: snapshot memo is missing component name.', {
        phase: 'hydrate',
      })
    }

    component = this.registry.make(name)
    component.$name = name
    component.$ctx = ctx
    component.$config = this.config

    // Inject the Edge.js singleton so component.render() can use it
    // without depending on IoC container resolution.
    if (this.edge) {
      component.$edge = this.edge
    }

    // Restore state from snapshot (sets $id, $name, $errors, all public props)
    this.snapshot.hydrate(component, payload.snapshot)

    const isInitialMount = !payload.snapshot.memo?.id

    // Run lifecycle — wrapped so component.exception() can intercept
    await this.runLifecycle(component, payload, isInitialMount, ctx)

    // 9. Dehydrate new snapshot
    const newSnapshot = await this.snapshot.dehydrate(component, {
      path: ctx.request.url(),
      method: ctx.request.method(),
      locale: 'en',
    })

    // Build effects
    const effects: WireEffect = { ...component.$effects }

    // 8. Render (unless skipRender)
    if (!component.$skipRender) {
      try {
        const html = await component.render()
        // Wrap the rendered template in the wire component div so that
        // morphdom preserves the adowire:id, adowire:name and adowire:snapshot
        // attributes on subsequent commits.  Without this wrapper the
        // root element returned by the template (a bare <div>) would
        // replace the [adowire:id] element, stripping the attributes and
        // breaking further interactions.
        const snapshotJson = JSON.stringify(newSnapshot).replace(/'/g, '&#39;')
        effects.html =
          `<div adowire:id="${newSnapshot.memo.id}"` +
          ` adowire:name="${name}"` +
          ` adowire:snapshot='${snapshotJson}'` +
          `>${html}</div>`
      } catch (err) {
        throw new RenderException(
          `${this.config.viewPrefix ?? 'adowire'}/${name.replace(/\./g, '/')}`,
          err,
          component
        )
      }
    }

    // Propagate @Title to the browser via effects so document.title updates
    // after each AJAX round-trip without a full page reload.
    const pageTitle = component.$getTitle()
    if (pageTitle) {
      effects.title = pageTitle
    }

    return { snapshot: newSnapshot, effects }
  }

  // ─── Lifecycle orchestration ─────────────────────────────────────────────

  private async runLifecycle(
    component: WireComponent,
    payload: {
      calls: Array<{ method: string; params: any[] }>
      updates: Record<string, any>
    },
    isInitialMount: boolean,
    _ctx: HttpContext
  ): Promise<void> {
    try {
      // 3. boot() — every request
      await this.runHook(component, 'boot')
      await component.$callTraitHooks('boot')

      if (isInitialMount) {
        // 4a. mount() — first request only
        await this.runHook(component, 'mount', payload.updates ?? {})
        await component.$callTraitHooks('mount', payload.updates ?? {})
      } else {
        // 4b. hydrate() — subsequent requests
        await this.runHook(component, 'hydrate')
        await component.$callTraitHooks('hydrate')
      }

      // 5. Apply property updates
      await this.applyUpdates(component, payload.updates ?? {})

      // 6. Call actions
      for (const call of payload.calls ?? []) {
        await this.callAction(component, call.method, call.params ?? [])
      }

      // 7. dehydrate()
      await this.runHook(component, 'dehydrate')
      await component.$callTraitHooks('dehydrate')
    } catch (err) {
      await this.handleComponentError(component, err)
    }
  }

  // ─── Property updates ────────────────────────────────────────────────────

  /**
   * Apply all incoming property updates from the client.
   *
   * For each property:
   * 1. Guard against @Locked properties
   * 2. Call `updating(name, value)` and `updatingPropertyName(value)`
   * 3. Set the value
   * 4. Call `updated(name, value)` and `updatedPropertyName(value)`
   *    (with key variant for array/object updates: `updatedPropertyName(value, key)`)
   */
  private async applyUpdates(
    component: WireComponent,
    updates: Record<string, any>
  ): Promise<void> {
    const lockedProps: string[] = this.getLockedProperties(component)

    for (const [rawPath, value] of Object.entries(updates)) {
      // Support dot-path updates like "items.0" or "nested.key"
      const [rootProp, ...subPath] = rawPath.split('.')
      const subKey = subPath.length > 0 ? subPath.join('.') : undefined

      // Guard: reject locked properties
      if (lockedProps.includes(rootProp)) {
        throw new LockedPropertyException(rootProp, component)
      }

      // updating(name, value) generic hook
      await component.updating(rawPath, value)

      // updatingPropertyName(value) shorthand
      const updatingShorthand = `updating${toPascalCase(rootProp)}`
      if (typeof (component as any)[updatingShorthand] === 'function') {
        await (component as any)[updatingShorthand](value)
      }

      // Apply value — support nested dot-paths
      if (subKey !== undefined) {
        setNestedValue(component, rootProp, subKey, value)
      } else {
        ;(component as any)[rootProp] = value
      }

      // updated(name, value) generic hook
      await component.updated(rawPath, value)

      // updatedPropertyName(value) shorthand
      const updatedShorthand = `updated${toPascalCase(rootProp)}`
      if (typeof (component as any)[updatedShorthand] === 'function') {
        if (subKey !== undefined) {
          // updatedPropertyName(value, key) for array/object sub-updates
          await (component as any)[updatedShorthand](value, subKey)
        } else {
          await (component as any)[updatedShorthand](value)
        }
      }

      // If @Validate(onUpdate: true) is set for this property, run validation
      await this.maybeValidateOnUpdate(component, rootProp)
    }
  }

  // ─── Action dispatch ─────────────────────────────────────────────────────

  /**
   * Call a single action method on the component.
   *
   * 1. Guard: `$isCallable()` must return true
   * 2. Resolve method parameters via AdonisJS IoC container
   * 3. Call the method
   * 4. If @Renderless, set skipRender
   * 5. Catch ValidationException → populate $errors, continue (no re-throw)
   */
  private async callAction(component: WireComponent, method: string, params: any[]): Promise<void> {
    // Magic client-side actions ($set, $toggle, $refresh, $dispatch, $redirect)
    if (method.startsWith('$')) {
      await this.callMagicAction(component, method, params)
      return
    }

    if (!component.$isCallable(method)) {
      throw new MethodNotCallableException(method, component)
    }

    const fn = (component as any)[method]

    // Check @Renderless
    const renderlessKeys: string[] =
      Reflect.getMetadata(WIRE_RENDERLESS_KEY, Object.getPrototypeOf(component)) ?? []
    if (renderlessKeys.includes(method)) {
      component.$skipRender = true
    }

    // Resolve DI args from IoC container, then merge with client params
    const resolvedArgs = await this.resolveMethodArgs(component, method, params)

    try {
      await fn.apply(component, resolvedArgs)
    } catch (err) {
      if (err instanceof ValidationException) {
        // Validation failure — populate errors and continue (no re-throw)
        component.$errors = err.errors
        return
      }
      throw err
    }
  }

  /**
   * Handle magic `$` actions sent from the client.
   * These mirror the `$set`, `$toggle`, `$refresh`, `$dispatch`, `$redirect`
   * methods on WireComponent but are invoked by name from the client.
   */
  private async callMagicAction(
    component: WireComponent,
    method: string,
    params: any[]
  ): Promise<void> {
    switch (method) {
      case '$set':
        component.$set(params[0], params[1])
        break
      case '$toggle':
        component.$toggle(params[0])
        break
      case '$refresh':
        component.$refresh()
        break
      case '$dispatch':
        component.$dispatch(params[0], params.slice(1))
        break
      case '$dispatchSelf':
        component.$dispatchSelf(params[0], params.slice(1))
        break
      case '$dispatchTo':
        component.$dispatchTo(params[0], params[1], params.slice(2))
        break
      case '$redirect':
        component.$redirect(params[0], params[1])
        break
      default:
        // Unknown magic action — silently ignore
        break
    }
  }

  // ─── IoC DI resolution ───────────────────────────────────────────────────

  /**
   * Resolve method arguments by merging:
   * 1. Client-supplied `params` (positional, from the left)
   * 2. IoC container injections for remaining parameters (via type metadata)
   *
   * If `emitDecoratorMetadata` is enabled and the method has a `design:paramtypes`
   * metadata entry, we attempt to resolve remaining args from the IoC container.
   * Otherwise we fall back to client params only.
   */
  private async resolveMethodArgs(
    component: WireComponent,
    method: string,
    clientParams: any[]
  ): Promise<any[]> {
    const proto = Object.getPrototypeOf(component)
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', proto, method) ?? []

    if (paramTypes.length === 0) {
      // No type metadata — just pass client params as-is
      return clientParams
    }

    const args: any[] = []
    // eslint-disable-next-line
    for (let i = 0; i < paramTypes.length; i++) {
      if (i < clientParams.length) {
        // Client supplied this arg
        args.push(clientParams[i])
      } else {
        // Try to resolve from IoC container
        const ParamType = paramTypes[i]
        if (ParamType && component.$ctx?.containerResolver) {
          try {
            args.push(await component.$ctx.containerResolver.make(ParamType))
          } catch {
            args.push(undefined)
          }
        } else {
          args.push(undefined)
        }
      }
    }

    return args
  }

  // ─── Validation on update ────────────────────────────────────────────────

  /**
   * If a property has `@Validate` with `onUpdate: true`, run validation
   * for that property immediately after the value is set.
   *
   * Validation errors are stored in `component.$errors` but do NOT throw —
   * we accumulate them and let the render pass display them.
   */
  private async maybeValidateOnUpdate(
    component: WireComponent,
    propertyName: string
  ): Promise<void> {
    const allRules: Record<string, { rule: any; onUpdate?: boolean }> =
      Reflect.getMetadata(WIRE_VALIDATE_KEY, Object.getPrototypeOf(component)) ?? {}

    const ruleMeta = allRules[propertyName]
    if (!ruleMeta?.onUpdate) return

    // Run single-field validation via WireValidator (through component.validate()).
    // The validate() method manages $errors internally: it clears errors for
    // properties that pass and sets errors for properties that fail, then
    // throws ValidationException. We swallow the exception here — the errors
    // are already on the component and will be included in the next render.
    try {
      await component.validate({ [propertyName]: ruleMeta.rule })
    } catch (err) {
      if (err instanceof ValidationException) {
        // Errors already written to component.$errors by validate() — nothing
        // more to do. The component will re-render with the updated $errors.
        return
      }
      // Re-throw unexpected errors so they surface properly.
      throw err
    }
  }

  // ─── Error handling ──────────────────────────────────────────────────────

  /**
   * Route an error through the component's `exception()` hook.
   * If `stopPropagation()` is called inside the hook, the error is swallowed.
   * Otherwise it is re-thrown.
   */
  private async handleComponentError(component: WireComponent, err: unknown): Promise<void> {
    let stopped = false
    const stopPropagation = () => {
      stopped = true
    }

    try {
      await component.exception(err, stopPropagation)
    } catch {
      // If exception() itself throws, re-throw the original error
      throw WireException.wrap(err, { component, phase: 'unknown' })
    }

    if (!stopped) {
      throw WireException.wrap(err, { component, phase: 'unknown' })
    }
  }

  // ─── Lifecycle hook runner ───────────────────────────────────────────────

  /**
   * Call a lifecycle hook method on the component, catching and re-wrapping
   * errors with phase information.
   */
  private async runHook(component: WireComponent, hook: string, ...args: any[]): Promise<void> {
    const fn = (component as any)[hook]
    if (typeof fn !== 'function') return
    try {
      await fn.apply(component, args)
    } catch (err) {
      throw WireException.wrap(err, {
        component,
        phase: hook as any,
      })
    }
  }

  // ─── Locked property helper ──────────────────────────────────────────────

  private getLockedProperties(component: WireComponent): string[] {
    return Reflect.getMetadata(WIRE_LOCKED_KEY, Object.getPrototypeOf(component)) ?? []
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a camelCase or snake_case property name to PascalCase
 * for shorthand hook lookup (e.g. `count` → `Count`, `my_prop` → `MyProp`).
 */
function toPascalCase(name: string): string {
  return name
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase())
}

/**
 * Set a value at a dot-path inside a component property.
 *
 * E.g. setNestedValue(component, 'items', '0', 'new') sets component.items[0] = 'new'
 *      setNestedValue(component, 'nested', 'foo.bar', 42) sets component.nested.foo.bar = 42
 */
function setNestedValue(
  component: WireComponent,
  rootProp: string,
  dotPath: string,
  value: unknown
): void {
  const root = (component as any)[rootProp]
  if (root === null || root === undefined || typeof root !== 'object') return

  const keys = dotPath.split('.')
  let target: any = root

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (target[key] === null || target[key] === undefined) return
    target = target[key]
  }

  const lastKey = keys[keys.length - 1]
  target[lastKey] = value
}
