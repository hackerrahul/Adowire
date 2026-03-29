/**
 * adowire - Livewire-like reactive components for AdonisJS + Edge.js
 * Core type definitions
 */

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface WireSnapshot {
  state: Record<string, SerializedValue>
  memo: WireMemo
  checksum: string
}

export interface WireMemo {
  name: string
  id: string
  children: Record<string, ChildComponentRef>
  errors: Record<string, string[]>
  locale: string
  lazy?: boolean
  lazyLoaded?: boolean
  path?: string
  method?: string
  scrollTo?: boolean
}

export interface ChildComponentRef {
  id: string
  tag: string
}

/**
 * A serialized value in the snapshot.
 * Primitive values are stored as-is.
 * Complex types are stored as a 2-tuple: [data, metadata].
 */
export type SerializedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializedValue[]
  | { [key: string]: SerializedValue }
  | [SerializedValue, SerializedMeta]

export interface SerializedMeta {
  /** synthesizer type key */
  s: string
  /** optional class/type name */
  class?: string
  [key: string]: any
}

// ─── Component Call / Request ─────────────────────────────────────────────────

export interface WireCall {
  method: string
  params: any[]
}

export interface WirePropertyUpdate {
  name: string
  value: any
}

/** Shape of the POST /adowire/message request body */
export interface WireRequestPayload {
  _token?: string
  components: Array<{
    snapshot: WireSnapshot
    calls: WireCall[]
    updates: Record<string, any>
  }>
}

// ─── Component Response / Effects ────────────────────────────────────────────

export interface WireEffect {
  /** New rendered HTML (undefined = skip re-render) */
  html?: string
  /** Redirect the browser to this URL */
  redirect?: string
  /** Events to dispatch on the client */
  dispatches?: WireDispatch[]
  /** JS actions to invoke on the client */
  js?: string[]
  /** Streams queued for adowire:stream */
  streams?: WireStream[]
  /** Property paths that were updated */
  dirty?: string[]
  /** File download to trigger */
  download?: WireDownload
  /** Title to update in the browser tab */
  title?: string
  /** Whether to scroll to the top */
  xjs?: string[]
}

export interface WireDispatch {
  name: string
  params: any[]
  /** If set, only dispatch to the component with this ID */
  to?: string
  /** If true, dispatch to parent */
  up?: boolean
  /** If true, dispatch globally (window event) */
  self?: boolean
}

export interface WireStream {
  name: string
  content: string
  replace?: boolean
}

export interface WireDownload {
  name: string
  url: string
}

/** Shape of a single component's response */
export interface WireComponentResponse {
  snapshot: WireSnapshot
  effects: WireEffect
}

/** Shape of the full POST /adowire/message response */
export interface WireResponse {
  components: WireComponentResponse[]
}

// ─── Lifecycle Hooks ──────────────────────────────────────────────────────────

export type LifecycleHook =
  | 'mount'
  | 'hydrate'
  | 'dehydrate'
  | 'render'
  | 'updating'
  | 'updated'
  | 'exception'

// ─── Decorators metadata keys ─────────────────────────────────────────────────

export const WIRE_COMPUTED_KEY = 'adowire:computed'
export const WIRE_LOCKED_KEY = 'adowire:locked'
export const WIRE_VALIDATE_KEY = 'adowire:validate'
export const WIRE_URL_KEY = 'adowire:url'
export const WIRE_ON_KEY = 'adowire:on'
export const WIRE_REACTIVE_KEY = 'adowire:reactive'
export const WIRE_MODELABLE_KEY = 'adoadowire:modelable'
export const WIRE_LAZY_KEY = 'adowire:lazy'
export const WIRE_SESSION_KEY = 'adowire:session'
export const WIRE_ASYNC_KEY = 'adowire:async'
export const WIRE_RENDERLESS_KEY = 'adowire:renderless'
export const WIRE_DEFER_KEY = 'adowire:defer'
export const WIRE_ISOLATE_KEY = 'adowire:isolate'
export const WIRE_JSON_KEY = 'adowire:json'
export const WIRE_TITLE_KEY = 'adowire:title'
export const WIRE_LAYOUT_KEY = 'adowire:layout'

// ─── Decorator option types ───────────────────────────────────────────────────

export interface ComputedOptions {
  cache?: boolean
}

export interface ValidateOptions {
  rule: string | string[]
  message?: string
}

export interface UrlOptions {
  as?: string
  history?: 'push' | 'replace'
  except?: any
}

export interface OnOptions {
  event: string
  /** If true, only listen if dispatched from a direct parent */
  fromParent?: boolean
  /** If true, only listen from self */
  self?: boolean
}

export interface LazyOptions {
  isolate?: boolean
}

export interface SessionOptions {
  key?: string
}

export interface LayoutOptions {
  name: string
  slot?: string
}

// ─── Component Registry ───────────────────────────────────────────────────────

export interface ComponentDefinition {
  name: string
  /** Absolute path to the component class file */
  classPath: string
  /** Edge template name (e.g. "adowire/counter") */
  viewName: string
}

export interface ComponentConstructor {
  new (): any
  /** Optionally define custom name instead of file-based auto-detection */
  componentName?: string
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationRule {
  property: string
  rule: string
  message?: string
}

export interface ValidationError {
  property: string
  message: string
}

// ─── Synthesizers ─────────────────────────────────────────────────────────────

export interface Synthesizer {
  /** Return true if this synthesizer can handle the given value */
  match(value: unknown): boolean
  /** Dehydrate (serialize) a value to a plain JSON-safe tuple */
  dehydrate(value: unknown): [SerializedValue, SerializedMeta]
  /** Hydrate (deserialize) a tuple back to the original value */
  hydrate(value: SerializedValue, meta: SerializedMeta): unknown
}

// ─── Wire Provider Config ─────────────────────────────────────────────────────

export interface AdowireConfig {
  /**
   * URL prefix for the wire message endpoint.
   * @default '/adowire'
   */
  prefix?: string

  /**
   * Path (glob) where wire component class files live.
   * @default 'app/adowire'
   */
  componentsPath?: string

  /**
   * Named namespaces that map a prefix to an additional component directory.
   * Components in a namespace are referenced as `namespace::component.name`.
   *
   * @example
   * ```ts
   * namespaces: {
   *   admin: 'app/adowire/admin',
   *   pages: 'app/adowire/pages',
   * }
   * ```
   */
  namespaces?: Record<string, string>

  /**
   * Edge view prefix for wire component templates.
   * @default 'adowire'
   */
  viewPrefix?: string

  /**
   * Secret used for HMAC snapshot signing.
   * Falls back to APP_KEY env var.
   *
   * Accepts a plain string or an AdonisJS v7 `Secret` object (which has a
   * `.release()` method). The provider unwraps it automatically.
   */
  secret?: string | { release(): string }

  /**
   * Whether to inject morph markers around @if/@each blocks.
   * @default true
   */
  injectMorphMarkers?: boolean

  /**
   * Max file upload size in bytes.
   * @default 12 * 1024 * 1024 (12MB)
   */
  maxUploadSize?: number

  /**
   * Temporary directory for file uploads.
   */
  tmpPath?: string

  /**
   * Default layout template used when a page component registered via
   * `router.adowire()` does not have an explicit `@Layout` decorator.
   *
   * Must be an Edge view name, e.g. `'layouts/app'`.
   * If omitted, the component HTML is returned as-is (no layout wrapper).
   *
   * @example 'layouts/app'
   */
  defaultLayout?: string

  /**
   * Enable the development-mode template proxy that warns when an Edge
   * template accesses a variable not present in the component's public state.
   *
   * This catches typos like `{{ naem }}` (instead of `{{ name }}`) at
   * runtime with a clear console warning.
   *
   * @default `true` when `NODE_ENV !== 'production'`, `false` otherwise.
   */
  devProxy?: boolean
}

// ─── Client-side types (mirrored for SSR-aware code) ─────────────────────────

export interface WireComponentMeta {
  id: string
  name: string
  fingerprint: WireSnapshot
}

export interface WireClientEffect {
  type: 'morph' | 'redirect' | 'dispatch' | 'js' | 'stream' | 'download'
  payload: any
}
