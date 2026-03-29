/*
|--------------------------------------------------------------------------
| Package entrypoint
|--------------------------------------------------------------------------
|
| Export values from the package entrypoint as you see fit.
|
*/

export { configure } from './configure.ts'
export { stubsRoot } from './stubs/main.ts'

// ─── Core server-side exports ─────────────────────────────────────────────────

export { WireComponent } from './src/component.ts'
export type { ReservedMethodNames, ViewData } from './src/component.ts'
export { ComponentRegistry, ComponentNotFoundException } from './src/component_registry.ts'
export { SnapshotManager, ChecksumException } from './src/snapshot.ts'
export { WireRequestHandler } from './src/request_handler.ts'
export {
  WireException,
  ChecksumException as WireChecksumException,
  LockedPropertyException,
  MethodNotCallableException,
  RenderException,
} from './src/wire_exception.ts'

// ─── Dev-mode template proxy ──────────────────────────────────────────────────

export {
  createDevStateProxy,
  flushDevWarnings,
  maybeDevProxy,
  isDevProxyEnabled,
} from './src/dev_proxy.ts'

// ─── Edge.js integration ──────────────────────────────────────────────────────

export { adowireEdgePlugin } from './src/edge/plugin.ts'
export { adowireStylesTag } from './src/edge/tags/adowire_styles.ts'
export { adowireScriptsTag } from './src/edge/tags/adowire_scripts.ts'
export { adowireComponentTag } from './src/edge/tags/adowire_component.ts'
export { errorTag } from './src/edge/tags/error.ts'

// ─── Decorators ───────────────────────────────────────────────────────────────

export { Computed, Layout, Locked, Title, Validate } from './src/decorators/index.ts'

// ─── Validation engine ────────────────────────────────────────────────────────

export { WireValidator } from './src/validator.ts'

// ─── Provider ─────────────────────────────────────────────────────────────────

export { default as WireProvider, ADOWIRE_BINDING } from './providers/wire_provider.ts'
export type { AdowireBinding } from './providers/wire_provider.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  AdowireConfig,
  WireSnapshot,
  WireMemo,
  WireEffect,
  WireCall,
  WireRequestPayload,
  WireResponse,
  WireComponentResponse,
  WireDispatch,
  WireStream,
  WireDownload,
  ComponentDefinition,
  ComponentConstructor,
  ValidationRule,
  ValidationError,
  Synthesizer,
  SerializedValue,
  SerializedMeta,
  ChildComponentRef,
  LifecycleHook,
  ComputedOptions,
  ValidateOptions,
  UrlOptions,
  OnOptions,
  LazyOptions,
  SessionOptions,
  LayoutOptions,
} from './src/types.ts'

// ─── Decorator metadata keys ──────────────────────────────────────────────────

export {
  WIRE_COMPUTED_KEY,
  WIRE_LOCKED_KEY,
  WIRE_VALIDATE_KEY,
  WIRE_URL_KEY,
  WIRE_ON_KEY,
  WIRE_REACTIVE_KEY,
  WIRE_MODELABLE_KEY,
  WIRE_LAZY_KEY,
  WIRE_SESSION_KEY,
  WIRE_ASYNC_KEY,
  WIRE_RENDERLESS_KEY,
  WIRE_DEFER_KEY,
  WIRE_ISOLATE_KEY,
  WIRE_JSON_KEY,
  WIRE_TITLE_KEY,
  WIRE_LAYOUT_KEY,
} from './src/types.ts'
