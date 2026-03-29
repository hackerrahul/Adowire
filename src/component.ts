import 'reflect-metadata'
import type { HttpContext } from '@adonisjs/core/http'
import type { WireDispatch, WireStream, WireDownload, WireEffect, AdowireConfig } from './types.js'
import {
  WIRE_COMPUTED_KEY,
  WIRE_LOCKED_KEY,
  WIRE_ON_KEY,
  WIRE_RENDERLESS_KEY,
  WIRE_ASYNC_KEY,
  WIRE_JSON_KEY,
  WIRE_LAYOUT_KEY,
  WIRE_TITLE_KEY,
  WIRE_VALIDATE_KEY,
} from './types.js'
import { maybeDevProxy, isDevProxyEnabled } from './dev_proxy.js'
import { WireValidator } from './validator.js'

// ─── ViewData utility type ────────────────────────────────────────────────────
//
// Extracts the public state shape from a WireComponent subclass so you can
// reference the exact set of variables available inside the Edge template.
//
// Usage:
//   import type { ViewData } from 'adowire'
//   type ModelSubmitView = ViewData<ModelSubmit>
//   //=> { name: string; email: string; message: string; submitted: boolean; … }
//
// The type is purely compile-time — it has zero runtime cost.

/**
 * Extract the **template data** type for a given `WireComponent` subclass.
 *
 * This is the set of variables available inside the component's `.edge`
 * template: every public instance property (excluding framework-internal
 * `$`-prefixed fields and methods) plus the injected `$errors` and
 * `$component` helpers.
 *
 * @example
 * ```ts
 * import type { ViewData } from 'adowire'
 * import type ModelSubmit from '#adowire/examples/model_submit'
 *
 * // Hover over this in your editor to see every available template variable:
 * type View = ViewData<ModelSubmit>
 * ```
 */
export type ViewData<T extends WireComponent> = {
  [K in keyof T as K extends `$${string}`
    ? never
    : K extends `_${string}`
      ? never
      : T[K] extends (...args: any[]) => any
        ? never
        : K]: T[K]
} & {
  /** Validation errors keyed by field name */
  $errors: Record<string, string[]>
  /** The component instance (access `$component.$ctx`, etc.) */
  $component: T
}

/**
 * Base class for all adowire components.
 *
 * Extend this class to create a reactive server-driven component:
 *
 * ```ts
 * import { WireComponent } from 'adowire'
 *
 * export default class Counter extends WireComponent {
 *   count = 0
 *   increment() { this.count++ }
 * }
 * ```
 */
// ─── Reserved method names ────────────────────────────────────────────────────
//
// These method names are blocked from client-side invocation by $isCallable().
// TypeScript does not support `final` methods, so the enforcement is at runtime
// — if a client tries `adowire:click="reset"` the request handler throws a
// clear MethodNotCallableException.
//
// The type is exported so tooling / lint rules can reference it.

/**
 * Method names that are reserved by the framework and cannot be called
 * from the client via `adowire:click` or similar directives.
 *
 * If you need an action called "reset", name it something else
 * (e.g. `clearAll`, `resetForm`, `resetCount`).
 */
export type ReservedMethodNames =
  | 'mount'
  | 'boot'
  | 'hydrate'
  | 'dehydrate'
  | 'updating'
  | 'updated'
  | 'rendering'
  | 'rendered'
  | 'exception'
  | 'render'
  | 'validate'
  | 'resetValidation'
  | 'addError'
  | 'skipRender'
  | 'fill'
  | 'reset'
  | 'pull'
  | 'only'
  | 'all'

export abstract class WireComponent {
  // ─── Internal framework fields (prefixed with $ to avoid collisions) ───────

  /** Unique component instance ID (ulid) */
  $id!: string

  /** Registered component name, e.g. "counter" or "posts.index" */
  $name!: string

  /** The AdonisJS HTTP context for the current request */
  $ctx!: HttpContext

  /** adowire config resolved from the provider */
  $config!: AdowireConfig

  /** The Edge.js template engine instance, injected by the request handler */
  $edge: any

  /** Validation errors keyed by property name */
  $errors: Record<string, string[]> = {}

  /** Queued effects to be sent back to the client */
  $effects: WireEffect = {}

  /** Whether to skip re-rendering after this action */
  $skipRender = false

  /**
   * Real-time stream writer callback, injected by the request handler when
   * the response is in SSE streaming mode.
   *
   * When set, `$stream()` calls this function **immediately** so the chunk
   * is flushed to the client over the open SSE connection.  When `null`,
   * `$stream()` falls back to buffering in `$effects.streams[]` (sent in
   * the final JSON response — no real-time push).
   *
   * @internal — set by `WireRequestHandler`, not by user code.
   */
  $streamWriter: ((stream: WireStream) => void) | null = null

  /**
   * Dynamic page title. Set this in mount() or any action to override
   * the static @Title decorator. Equivalent to Livewire's ->title() method.
   *
   * @example
   * async mount() {
   *   this.$title = `Edit: ${this.post.title}`
   * }
   */
  $title: string | null = null

  /** Cache for computed properties within a single request */
  private $computedCache: Map<string, any> = new Map()

  // ─── Lifecycle Hooks (override in subclass) ────────────────────────────────

  /**
   * Called once when the component is first initialised (initial GET render).
   * Use this to set up state from props or the database.
   * NOT called on subsequent AJAX updates.
   */
  async mount(_props: Record<string, any>): Promise<void> {}

  /**
   * Called on every single request — both the initial render and all
   * subsequent AJAX updates. Runs before `hydrate()` and before actions.
   * Use this for setup that must happen on every request (e.g. auth guards).
   */
  async boot(): Promise<void> {}

  /**
   * Called every time the component is re-hydrated from a snapshot
   * (i.e. on every subsequent AJAX request after the initial render).
   * NOT called on the first render.
   */
  async hydrate(): Promise<void> {}

  /**
   * Called right before the component state is serialised to a snapshot
   * and sent back to the client. Called on every request.
   */
  async dehydrate(): Promise<void> {}

  /**
   * Called before a public property is updated from the client.
   * @param _name  Property name
   * @param _value Incoming value from the client
   */
  async updating(_name: string, _value: any): Promise<void> {}

  /**
   * Called after a public property has been updated from the client.
   * @param _name  Property name
   * @param _value The new value that was set
   */
  async updated(_name: string, _value: any): Promise<void> {}

  /**
   * Called before the component template is rendered.
   * Return a (possibly mutated) `data` object to inject extra variables into
   * the view, or override variables produced by `$getPublicState()`.
   *
   * @param _view The Edge.js view name that will be rendered
   * @param data  The data object that will be passed to the view
   */
  async rendering(_view: string, data: Record<string, any>): Promise<Record<string, any>> {
    return data
  }

  /**
   * Called after the component template has been rendered to HTML.
   * You may inspect or mutate the HTML string before it is sent to the client.
   *
   * @param _view The Edge.js view name that was rendered
   * @param html  The rendered HTML string
   */
  async rendered(_view: string, html: string): Promise<string> {
    return html
  }

  /**
   * Called when an unhandled exception is thrown during the request lifecycle
   * (boot, hydrate, property update, action call, or dehydrate).
   *
   * Call `stopPropagation()` inside this hook to swallow the error and prevent
   * it from bubbling further. If you do not call it, the exception is re-thrown.
   *
   * @param _error           The caught exception
   * @param stopPropagation  Call this to prevent further propagation
   */
  async exception(_error: unknown, stopPropagation: () => void): Promise<void> {
    // default: do nothing — let the error propagate
    void stopPropagation
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Renders the component's Edge.js template and returns the resulting HTML.
   *
   * Calls `rendering()` and `rendered()` hooks around the Edge render call.
   * Override this method in your app component to customise the view path,
   * pass extra data, or use a completely different rendering strategy.
   *
   * Template data includes:
   *  - All public component state (from `$getPublicState()`)
   *  - `$errors`     — validation errors keyed by field name
   *  - `$component`  — the component instance itself (access `$component.$ctx.auth`, etc.)
   *
   * When `this.$ctx.view` is available (i.e. during a commit request handled
   * by the AdonisJS middleware stack) we use `ctx.view.render()` so that
   * templates automatically receive the full HttpContext: `auth`, `session`,
   * `csrfToken`, `route()`, `signedRoute()`, `vite()`, and any other
   * shared state from AdonisJS middleware.  Falls back to direct
   * `edge.render()` when `ctx.view` is not available (e.g. initial SSR
   * from the `@wire` tag).
   */
  async render(): Promise<string> {
    const viewName = `${this.$config.viewPrefix ?? 'adowire'}/${this.$name.replace(/\./g, '/')}`

    // Resolve all @Computed properties fresh for this render cycle.
    // Computed values are NOT stored in the snapshot — they are derived
    // values recalculated on each request, just like Livewire 4.
    this.$clearComputedCache()
    const proto = Object.getPrototypeOf(this)
    const computedKeys: string[] = Reflect.getMetadata(WIRE_COMPUTED_KEY, proto) ?? []
    const computedData: Record<string, any> = {}
    for (const key of computedKeys) {
      computedData[key] = await this.$resolveComputed(key)
    }

    // Build template data: public state + computed values + framework injections
    const baseData: Record<string, any> = {
      ...this.$getPublicState(),
      ...computedData,
      // Inject $errors so @error('field') / @enderror tags can read them
      $errors: this.$errors,
      // Inject the component instance so templates can access the full
      // HttpContext: {{ $component.$ctx.auth.user }}, {{ $component.$ctx.request.url() }}, etc.
      $component: this,
    }

    // Allow subclass / traits to inject extra data into the view
    const rawData = await this.rendering(viewName, baseData)

    // In development, wrap the data in a Proxy that warns when the template
    // accesses a variable that doesn't exist in the component's public state.
    // This catches typos like {{ naem }} instead of {{ name }} immediately.
    const data = maybeDevProxy(rawData, this.$name, isDevProxyEnabled(this.$config))

    let html: string

    // Prefer ctx.view.render() — it carries the full AdonisJS request
    // context (auth, session, csrfToken, flash messages, route helpers,
    // vite helper, and anything else shared by middleware).
    if ((this.$ctx as any)?.view?.render) {
      html = await (this.$ctx as any).view.render(viewName, data)
    } else if (this.$edge) {
      // Fallback: direct Edge singleton render (no request-scoped state)
      html = await this.$edge.render(viewName, data)
    } else {
      throw new Error(
        '[adowire] No Edge instance available for rendering. ' +
          'Ensure the request handler sets $edge or that ctx.view is available.'
      )
    }

    // ── Server-side adowire:show processing ─────────────────────────
    // Evaluate adowire:show="expr" attributes against the component's
    // public state and inject style="display:none" on elements where the
    // expression is falsy.  This mirrors Livewire's wire:show behaviour:
    // the server renders the correct initial visibility so there is no
    // flash and no need for the developer to write manual inline styles.
    html = this.$processShowDirectives(html, baseData)

    // Allow subclass / traits to post-process the rendered HTML
    html = await this.rendered(viewName, html)

    return html
  }

  // ─── Server-side adowire:show ──────────────────────────────────────────────

  /**
   * Process all `adowire:show="expr"` attributes in the rendered HTML.
   *
   * For each match the expression is evaluated against the component's public
   * state (the same data object passed to the Edge template).  When the
   * expression is falsy the element receives `style="display:none"` (or the
   * rule is appended to an existing `style` attribute).  When truthy the
   * element is left as-is (visible by default).
   *
   * This runs on the server so the initial HTML already contains the correct
   * visibility — no client-side JavaScript is required for the first paint.
   * The client-side `adowire:show` directive then maintains the state for
   * subsequent interactions.
   */
  protected $processShowDirectives(html: string, state: Record<string, any>): string {
    // Match opening tags that contain adowire:show="…"
    // Captures: (1) everything before adowire:show, (2) the expression,
    // (3) everything after the expression up to the closing >
    const regex = /(<[^>]*?)\badowire:show=(["'])(.*?)\2([^>]*>)/g

    return html.replace(
      regex,
      (_match, before: string, _quote: string, expr: string, after: string) => {
        const visible = this.$evaluateShowExpression(expr, state)

        if (visible) {
          // Truthy — leave the element as-is (visible)
          return `${before}adowire:show="${expr}"${after}`
        }

        // Falsy — inject display:none
        const tag = `${before}adowire:show="${expr}"${after}`

        // Check if a style attribute already exists on this tag
        if (/\bstyle\s*=\s*["']/i.test(tag)) {
          // Append display:none to the existing style value
          return tag.replace(/(\bstyle\s*=\s*["'])/i, '$1display:none;')
        }

        // No existing style — insert one before the closing >
        return tag.replace(/>$/, ' style="display:none">')
      }
    )
  }

  /**
   * Safely evaluate a simple JS expression against component state.
   *
   * State properties are injected as named local variables so expressions
   * like `starred`, `!starred`, `count > 0` work naturally.
   *
   * @returns The boolean result, or `false` on any evaluation error.
   */
  private $evaluateShowExpression(expr: string, state: Record<string, any>): boolean {
    try {
      const keys = Object.keys(state)
      const values = keys.map((k) => state[k])
      const fn = new Function(...keys, `return !!(${expr})`)
      return fn(...values) as boolean
    } catch {
      return false
    }
  }

  // ─── Bulk State Helpers ────────────────────────────────────────────────────

  /**
   * Bulk-assign public properties from a plain object.
   * Only properties that already exist on the component are set —
   * unknown keys are silently ignored for safety.
   *
   * @param data Key/value pairs to assign
   */
  fill(data: Record<string, any>): void {
    const publicState = this.$getPublicState()
    for (const [key, value] of Object.entries(data)) {
      if (Object.prototype.hasOwnProperty.call(publicState, key)) {
        ;(this as any)[key] = value
      }
    }
  }

  /**
   * Reset one or more properties to their initial (class-field default) values.
   * If no properties are given, ALL public properties are reset.
   *
   * Initial values are captured lazily and cached per class so that all
   * instances share the same defaults snapshot.
   *
   * @param props Property names to reset (omit to reset all)
   */
  reset(...props: string[]): void {
    const defaults = this.$getInitialState()
    const targets = props.length > 0 ? props : Object.keys(defaults)
    for (const key of targets) {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) {
        ;(this as any)[key] = structuredClone(defaults[key])
      }
    }
  }

  /**
   * Reset the given properties to their initial values and return the values
   * they held *before* the reset.
   *
   * @param props Properties to pull (reset and retrieve)
   * @returns     Plain object of old values keyed by property name
   */
  pull(...props: string[]): Record<string, any> {
    const old: Record<string, any> = {}
    for (const key of props) {
      old[key] = structuredClone((this as any)[key])
    }
    this.reset(...props)
    return old
  }

  /**
   * Return a subset of the current public state.
   *
   * @param props The property names to include
   */
  only(...props: string[]): Record<string, any> {
    const state = this.$getPublicState()
    const result: Record<string, any> = {}
    for (const key of props) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        result[key] = state[key]
      }
    }
    return result
  }

  /**
   * Return all public component state as a plain object.
   * Developer-facing alias of `$getPublicState()`.
   */
  all(): Record<string, any> {
    return this.$getPublicState()
  }

  // ─── Public State ──────────────────────────────────────────────────────────

  /**
   * Returns all public properties of this component as a plain object.
   * Properties whose names start with `$` or `_` are excluded, as are
   * methods and framework-internal values.
   */
  $getPublicState(): Record<string, any> {
    const state: Record<string, any> = {}
    const proto = Object.getPrototypeOf(this)

    // Computed keys must be excluded from serializable state — they are
    // derived values resolved fresh on each request (like Livewire 4).
    const computedKeys: string[] = Reflect.getMetadata(WIRE_COMPUTED_KEY, proto) ?? []
    const computedSet = new Set(computedKeys)

    // Own instance properties (declared in constructor / class fields)
    for (const key of Object.keys(this)) {
      if (this.$isInternalKey(key)) continue
      // Skip any instance property that shadows a computed method —
      // this can happen if a previous hydration cycle incorrectly
      // assigned a computed value as an instance property.
      if (computedSet.has(key)) continue
      state[key] = (this as any)[key]
    }

    // Computed values are NOT included here. They are resolved and
    // injected into the template data at render time only.

    return state
  }

  /**
   * Capture and return the initial (default) property values for this component.
   * The snapshot is created once per class and cached on the prototype so all
   * instances share it.
   *
   * @internal
   */
  $getInitialState(): Record<string, any> {
    const proto = Object.getPrototypeOf(this)
    const cacheKey = '__$initialState__'

    if (!Object.prototype.hasOwnProperty.call(proto, cacheKey)) {
      // Create a bare instance (no constructor side-effects) to read field defaults
      const tmp = Object.create(proto) as any
      const snapshot: Record<string, any> = {}

      for (const key of Object.keys(this)) {
        if (this.$isInternalKey(key)) continue
        // Prefer tmp's own value; fall back to this instance's current value
        const raw = Object.prototype.hasOwnProperty.call(tmp, key) ? tmp[key] : (this as any)[key]
        snapshot[key] = structuredClone(raw)
      }

      Object.defineProperty(proto, cacheKey, {
        value: snapshot,
        writable: true,
        configurable: true,
        enumerable: false,
      })
    }

    return (proto as any)[cacheKey]
  }

  /**
   * Returns the names of all locked properties (decorated with @Locked).
   */
  $getLockedProperties(): string[] {
    return Reflect.getMetadata(WIRE_LOCKED_KEY, Object.getPrototypeOf(this)) ?? []
  }

  /**
   * Returns the validation rules defined via @Validate decorators.
   */
  $getValidationRules(): Record<string, string> {
    return Reflect.getMetadata(WIRE_VALIDATE_KEY, Object.getPrototypeOf(this)) ?? {}
  }

  /**
   * Returns the event listeners defined via @On decorators.
   * Shape: { eventName: methodName }
   */
  $getEventListeners(): Record<string, string> {
    return Reflect.getMetadata(WIRE_ON_KEY, Object.getPrototypeOf(this)) ?? {}
  }

  /**
   * Returns the layout config defined via @Layout decorator (for page components).
   */
  $getLayout(): { name: string; slot: string } | null {
    return Reflect.getMetadata(WIRE_LAYOUT_KEY, Object.getPrototypeOf(this)) ?? null
  }

  /**
   * Returns the page title for this component.
   *
   * Resolution order:
   *  1. `this.$title` — set dynamically in mount() / actions / boot()
   *  2. `@Title('...')` decorator on the class
   *  3. `null` — no title
   */
  $getTitle(): string | null {
    // Instance-level $title (set dynamically) takes priority over @Title decorator
    if (this.$title !== null) return this.$title
    return Reflect.getMetadata(WIRE_TITLE_KEY, Object.getPrototypeOf(this)) ?? null
  }

  /**
   * Returns true if the named method has the @Renderless decorator.
   */
  $isRenderless(method: string): boolean {
    const keys: string[] =
      Reflect.getMetadata(WIRE_RENDERLESS_KEY, Object.getPrototypeOf(this)) ?? []
    return keys.includes(method)
  }

  /**
   * Returns true if the named method has the @Async decorator.
   */
  $isAsync(method: string): boolean {
    const keys: string[] = Reflect.getMetadata(WIRE_ASYNC_KEY, Object.getPrototypeOf(this)) ?? []
    return keys.includes(method)
  }

  /**
   * Returns true if the named method has the @Json decorator.
   */
  $isJson(method: string): boolean {
    const keys: string[] = Reflect.getMetadata(WIRE_JSON_KEY, Object.getPrototypeOf(this)) ?? []
    return keys.includes(method)
  }

  // ─── Computed Property Cache ───────────────────────────────────────────────

  /**
   * Invoke a computed method, caching the result for the lifetime of this request.
   */
  async $resolveComputed(key: string): Promise<any> {
    if (this.$computedCache.has(key)) {
      return this.$computedCache.get(key)
    }
    const fn = (this as any)[key]
    if (typeof fn !== 'function') return undefined
    const result = await fn.call(this)
    this.$computedCache.set(key, result)
    return result
  }

  /**
   * Clears the computed cache (called between lifecycle hooks if needed).
   */
  $clearComputedCache(): void {
    this.$computedCache.clear()
  }

  // ─── Trait / Mixin Lifecycle Dispatch ─────────────────────────────────────

  /**
   * Discover and call trait-prefixed lifecycle hooks on this component.
   *
   * Convention: `<hook><TraitName>()` where `TraitName` starts with an
   * uppercase letter. For example, if a mixin defines `mountWithPagination()`
   * or `bootWithFileUploads()`, this method finds and calls them automatically
   * when the framework triggers the corresponding root lifecycle hook.
   *
   * @param hook  The lifecycle hook name (e.g. "mount", "boot", "hydrate")
   * @param args  Arguments forwarded verbatim to the trait hook
   */
  async $callTraitHooks(hook: string, ...args: any[]): Promise<void> {
    const seen = new Set<string>()
    let current: object = Object.getPrototypeOf(this)

    while (current && current !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(current)) {
        if (seen.has(key)) continue
        seen.add(key)

        // Must start with the hook name but must not be the hook itself
        if (!key.startsWith(hook) || key === hook) continue

        // Next character must be uppercase (e.g. mountWithPagination → "W")
        const rest = key.slice(hook.length)
        if (!rest || !/^[A-Z]/.test(rest)) continue

        const fn = (this as any)[key]
        if (typeof fn === 'function') {
          await fn.apply(this, args)
        }
      }
      current = Object.getPrototypeOf(current)
    }
  }

  // ─── Magic Actions ─────────────────────────────────────────────────────────

  /**
   * Triggers a re-render of the component without calling any action.
   * (No-op server-side; the framework re-renders automatically after every action.)
   */
  $refresh(): void {
    // intentional no-op — re-render always happens unless skipRender() was called
  }

  /**
   * Set a public property value.
   * Equivalent to `adowire:click="$set('prop', value)"` on the client.
   */
  $set(prop: string, value: any): void {
    ;(this as any)[prop] = value
  }

  /**
   * Toggle a boolean public property.
   * Equivalent to `adowire:click="$toggle('prop')"` on the client.
   */
  $toggle(prop: string): void {
    ;(this as any)[prop] = !(this as any)[prop]
  }

  /**
   * Dispatch a component event.
   * Other components listening via @On('event-name') will receive it.
   *
   * @param name   Event name
   * @param params Optional parameters to pass to listeners
   */
  $dispatch(name: string, params: any[] = []): void {
    if (!this.$effects.dispatches) this.$effects.dispatches = []
    this.$effects.dispatches.push({ name, params } as WireDispatch)
  }

  /**
   * Dispatch an event only to the component itself (self).
   */
  $dispatchSelf(name: string, params: any[] = []): void {
    if (!this.$effects.dispatches) this.$effects.dispatches = []
    this.$effects.dispatches.push({ name, params, self: true } as WireDispatch)
  }

  /**
   * Dispatch an event to a specific named component.
   */
  $dispatchTo(targetName: string, name: string, params: any[] = []): void {
    if (!this.$effects.dispatches) this.$effects.dispatches = []
    this.$effects.dispatches.push({ name, params, to: targetName } as WireDispatch)
  }

  /**
   * Redirect the browser to the given URL after the response is sent.
   * Automatically skips re-rendering.
   */
  $redirect(url: string, _options?: { navigate?: boolean }): void {
    this.$effects.redirect = url
    this.$skipRender = true
  }

  /**
   * Redirect using adowire:navigate (SPA-style, no full page reload).
   */
  $redirectRoute(url: string): void {
    this.$effects.redirect = url
    this.$skipRender = true
  }

  /**
   * Stream a text chunk to a `adowire:stream="name"` element on the client.
   * Use inside an async action with a for-await loop for AI/LLM streaming.
   *
   * @param name    The adowire:stream target name
   * @param content The text content chunk to stream
   * @param replace If true, replace the element content instead of appending
   */
  $stream(name: string, content: string, replace = false): void {
    const chunk: WireStream = { name, content, replace }

    // Real-time path: push the chunk over the open SSE connection immediately.
    if (this.$streamWriter) {
      this.$streamWriter(chunk)
      return
    }

    // Buffered path: collect chunks and send them in the final JSON response.
    if (!this.$effects.streams) this.$effects.streams = []
    this.$effects.streams.push(chunk)
  }

  /**
   * Trigger a file download on the client.
   *
   * @param name File name as it will appear in the download dialog
   * @param url  URL to the file (can be a signed storage URL, etc.)
   */
  $download(name: string, url: string): void {
    this.$effects.download = { name, url } as WireDownload
  }

  /**
   * Invoke a named JavaScript action defined in the component's
   * `<script>` block (via `this.$js.actionName = () => { ... }`).
   */
  js(action: string): void {
    if (!this.$effects.js) this.$effects.js = []
    this.$effects.js.push(action)
  }

  /**
   * Skip re-rendering the component after the current action.
   * Useful for fire-and-forget actions (analytics, logging, etc.).
   */
  skipRender(): void {
    this.$skipRender = true
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate the component's public properties using `@Validate` decorator
   * rules (or explicit override rules).
   *
   * Works like Livewire's `$this->validate()`:
   *   - Just validates — does **not** assign values back to properties.
   *   - After validation passes you read properties directly via `this.title`,
   *     `this.email`, etc.
   *   - Throws `ValidationException` if any property fails, after populating
   *     `$errors` so the template can display them via `@error('field')`.
   *   - Clears errors for properties that pass.
   *
   * ```ts
   * // In an action method:
   * await this.validate()           // uses @Validate decorators
   * Post.create({ title: this.title, email: this.email })
   *
   * // Or with explicit rules:
   * await this.validate({ title: someVineRule, email: anotherRule })
   * ```
   *
   * For full VineJS type inference (coercions, transforms), use
   * `validateUsing(compiledValidator)` instead.
   *
   * @param rules  Optional override rules keyed by property name. If omitted,
   *               uses `@Validate` decorator rules.
   */
  async validate(rules?: Record<string, any>): Promise<void> {
    const proto = Object.getPrototypeOf(this)
    const decoratorRules: Record<
      string,
      { rule: any; message?: string; as?: string; onUpdate: boolean }
    > = Reflect.getMetadata(WIRE_VALIDATE_KEY, proto) ?? {}

    // Build the properties-to-validate map.
    // When explicit `rules` are passed they take priority (single-field
    // validation from `maybeValidateOnUpdate`). Otherwise validate every
    // decorated property.
    const toValidate: Record<
      string,
      { value: any; rule: any; opts?: { message?: string; as?: string } }
    > = {}

    if (rules && Object.keys(rules).length > 0) {
      for (const [prop, rule] of Object.entries(rules)) {
        const meta = decoratorRules[prop]
        toValidate[prop] = {
          value: (this as any)[prop],
          rule,
          opts: meta ? { message: meta.message, as: meta.as } : undefined,
        }
      }
    } else {
      for (const [prop, meta] of Object.entries(decoratorRules)) {
        toValidate[prop] = {
          value: (this as any)[prop],
          rule: meta.rule,
          opts: { message: meta.message, as: meta.as },
        }
      }
    }

    if (Object.keys(toValidate).length === 0) return

    const { errors } = await WireValidator.validateProperties(toValidate)

    // Clear errors for properties that passed validation.
    for (const prop of Object.keys(toValidate)) {
      if (!errors[prop]) {
        delete this.$errors[prop]
      }
    }

    // Merge in any new errors and throw so the request handler re-renders.
    if (Object.keys(errors).length > 0) {
      this.$errors = { ...this.$errors, ...errors }
      throw new ValidationException(this.$errors)
    }
  }

  /**
   * Validate the component's public state using a **pre-compiled VineJS
   * validator**, exactly like AdonisJS's `request.validateUsing(validator)`.
   *
   * The return type is fully inferred from the VineJS schema — no manual
   * interface needed. VineJS coercions, transforms, and refinements are
   * all reflected in the output type automatically.
   *
   * ```ts
   * import vine from '@vinejs/vine'
   *
   * const createPostValidator = vine.compile(
   *   vine.object({
   *     title: vine.string().minLength(3).trim(),
   *     rating: vine.number().min(0).max(100),
   *     isActive: vine.boolean(),
   *   })
   * )
   *
   * // Inside the component:
   * const validated = await this.validateUsing(createPostValidator)
   * validated.title    // ✅ string  (trimmed by VineJS)
   * validated.rating   // ✅ number  (coerced by VineJS)
   * validated.isActive // ✅ boolean (coerced by VineJS)
   * ```
   *
   * On success:
   *   1. Validated values are assigned back to the component properties.
   *   2. All validation errors are cleared.
   *   3. The typed validated data is returned.
   *
   * On failure:
   *   1. `$errors` is populated with VineJS error messages.
   *   2. A `ValidationException` is thrown (caught by the request handler
   *      to re-render the component with errors).
   *
   * @param validator  A compiled VineJS validator (`vine.compile(schema)`).
   * @returns          The validated/coerced data, typed from the schema.
   */
  async validateUsing<T>(validator: { validate(data: any): Promise<T> }): Promise<T> {
    // Collect the component's public state as the data source.
    const data = this.$getPublicState()

    try {
      const validated = await validator.validate(data)

      // Assign validated (coerced/trimmed/transformed) values back to
      // the component properties so the re-rendered template reflects
      // the validator's cleaned output.
      if (validated && typeof validated === 'object') {
        for (const [prop, value] of Object.entries(validated as Record<string, any>)) {
          ;(this as any)[prop] = value
        }
      }

      // Validation passed — clear all errors.
      this.$errors = {}

      return validated
    } catch (err: any) {
      // VineJS validation errors carry a `.messages` array of
      // `{ field: string; message: string; rule: string }` objects.
      if (Array.isArray(err?.messages)) {
        const errors: Record<string, string[]> = {}
        for (const msg of err.messages as Array<{ field?: string; message?: string }>) {
          const field = msg.field ?? '_unknown'
          if (!errors[field]) errors[field] = []
          errors[field].push(msg.message ?? 'Validation failed')
        }
        this.$errors = errors
        throw new ValidationException(this.$errors)
      }

      // Not a VineJS error — re-throw as-is.
      throw err
    }
  }

  /**
   * Reset validation errors (optionally for specific properties).
   * If no properties are given, all errors are cleared.
   */
  resetValidation(...props: string[]): void {
    if (props.length === 0) {
      this.$errors = {}
    } else {
      for (const prop of props) {
        delete this.$errors[prop]
      }
    }
  }

  /**
   * Manually add a validation error for a property.
   */
  addError(property: string, message: string): void {
    if (!this.$errors[property]) this.$errors[property] = []
    this.$errors[property].push(message)
  }

  // ─── Snapshot Helpers ──────────────────────────────────────────────────────

  /**
   * Serialize `$errors` to a plain object for inclusion in the snapshot memo.
   * @internal
   */
  $serializeErrors(): Record<string, string[]> {
    return { ...this.$errors }
  }

  /**
   * Restore `$errors` from a snapshot memo.
   * @internal
   */
  $restoreErrors(errors: Record<string, string[]>): void {
    this.$errors = errors ?? {}
  }

  // ─── Security ──────────────────────────────────────────────────────────────

  /**
   * Returns true for property names that should never be exposed
   * in component state or snapshots.
   * @internal
   */
  private $isInternalKey(key: string): boolean {
    return key.startsWith('$') || key.startsWith('_') || key === 'constructor'
  }

  /**
   * Check whether the given method name is publicly callable from the client.
   *
   * Rules:
   * - Must not start with `$` or `_`
   * - Must exist on the instance and be a function
   * - Must not be a lifecycle hook (always forbidden, even if overridden)
   * - Base-class utility methods (reset, fill, pull, …) are forbidden UNLESS
   *   the concrete subclass explicitly overrides them — in that case the
   *   developer has intentionally declared the method as a client action.
   */
  $isCallable(method: string): boolean {
    if (method.startsWith('$') || method.startsWith('_')) return false

    const fn = (this as any)[method]
    if (typeof fn !== 'function') return false

    // Lifecycle hooks are ALWAYS forbidden — even if a subclass overrides them.
    const lifecycleHooks = new Set([
      'mount',
      'boot',
      'hydrate',
      'dehydrate',
      'updating',
      'updated',
      'rendering',
      'rendered',
      'exception',
    ])
    if (lifecycleHooks.has(method)) return false

    // Walk the prototype chain between the concrete class and WireComponent.
    // If the method is defined on any user-supplied class in that range it is
    // a deliberate user action and should be callable — even when its name
    // shadows a WireComponent base utility such as `reset()`.
    let proto = Object.getPrototypeOf(this) // start at the concrete class prototype
    while (proto && proto !== WireComponent.prototype) {
      if (Object.prototype.hasOwnProperty.call(proto, method)) return true
      proto = Object.getPrototypeOf(proto)
    }

    // The method is inherited directly from WireComponent — block known
    // base-class utilities that must never be invoked from the client.
    const baseUtilities = new Set([
      'render',
      'validate',
      'resetValidation',
      'addError',
      'skipRender',
      'fill',
      'reset',
      'pull',
      'only',
      'all',
    ])
    return !baseUtilities.has(method)
  }
}

// ─── ValidationException ───────────────────────────────────────────────────────

/**
 * Thrown by `component.validate()` when VineJS validation fails.
 * Caught by the request handler to populate `$errors` and re-render the component.
 */
export class ValidationException extends Error {
  constructor(public readonly errors: Record<string, string[]>) {
    super('Validation failed')
    this.name = 'ValidationException'
  }
}

// ─── Shorthand hook types (for documentation / type-checking mixin authors) ───

/**
 * Naming convention for trait/mixin lifecycle hooks that adowire auto-discovers.
 *
 * When the request handler calls e.g. `boot()`, it immediately follows with
 * `$callTraitHooks('boot')`, which walks the prototype chain looking for
 * methods named `boot<TraitName>` (next char uppercase).
 *
 * Hooks that follow the `updatedPropertyName(value)` pattern are dispatched
 * by the request handler after each property update — adowire converts the
 * property name to PascalCase and calls e.g. `updatedCount(value)` if it exists.
 *
 * @example
 * ```ts
 * class Counter extends WireComponent {
 *   count = 0
 *   // Called automatically after `count` is updated by the client:
 *   updatedCount(value: number) { if (value < 0) this.count = 0 }
 *   // Called automatically before `count` is updated:
 *   updatingCount(value: number) { console.log('about to set count to', value) }
 * }
 * ```
 */
export type WireShorthandHookConvention = never
