/**
 * adowire — Edge.js plugin
 *
 * Registers all adowire custom tags and global helpers with the Edge.js
 * template engine.
 *
 * This plugin can be used in two ways:
 *
 * 1. Via `edge.use()` (deferred — executes on first `createRenderer()` call):
 *      import { adowireEdgePlugin } from '../src/edge/plugin.js'
 *      edge.use(adowireEdgePlugin)
 *
 * 2. Via direct registration (immediate — preferred in the provider):
 *      import { registerAdowireTags } from '../src/edge/plugin.js'
 *      registerAdowireTags(edge)
 *
 * The provider uses approach (2) because it is more robust: tags are
 * available immediately after boot() without depending on when the first
 * renderer is created.
 *
 * **Important — @error tag precedence:**
 *
 * The `@adonisjs/session` package registers its own `@error` tag that reads
 * from session flash messages (`state.flashMessages`). Since session's edge
 * plugin runs as a deferred `edge.use()` plugin (executed lazily inside
 * `createRenderer()`), it can overwrite adowire's `@error` tag even when
 * adowire registers first during `boot()`.
 *
 * To guarantee adowire's `@error` tag always wins, we use `edge.onRender()`
 * to re-register the tag on every `createRenderer()` call — after all
 * plugins (including session's) have executed. This ensures that
 * `@error('field')` in wire component templates always reads from
 * `state.$errors` (the component's validation errors) rather than from
 * session flash messages.
 */

import { adowireStylesTag } from './tags/adowire_styles.js'
import { adowireScriptsTag } from './tags/adowire_scripts.js'
import { adowireComponentTag } from './tags/adowire_component.js'
import { errorTag } from './tags/error.js'
import { adowireHtmlProcessor } from './adowire_html_processor.js'

/**
 * Minimal inline shape of the Edge.js PluginFn type.
 * We avoid importing from 'edge.js/types' because edge.js is a peer
 * dependency that may not be installed in the package's own node_modules.
 */
type EdgePluginFn = (edge: any, firstRun: boolean, options: undefined) => void

/**
 * Tracks every Edge instance that has already had adowire tags registered.
 *
 * This prevents double-registration when both `registerAdowireTags(edge)` is
 * called directly in `boot()` AND `edge.use(adowireEdgePlugin)` is later
 * executed inside `createRenderer()`.  Because `adowireHtmlProcessor` is a
 * named exported function, Edge.js's internal Set-based processor registry
 * would deduplicate it on its own — but using our own WeakSet guard is
 * cleaner, cheaper, and also prevents duplicate `registerTag()` calls.
 */
const registeredInstances = new WeakSet<object>()

/**
 * Register all adowire tags directly on an Edge instance.
 *
 * This is the preferred approach in the provider's boot() method because
 * `edge.registerTag()` mutates the shared `tags` object that both the
 * sync and async compilers reference — tags are available immediately.
 *
 * Registers:
 *  - @adowireStyles   — CSS placeholder / link tag
 *  - @adowireScripts  — Alpine.js CDN + adowire.js scripts
 *  - @adowire / @end  — embedded child component renderer
 *  - @error / @end    — validation error block
 *
 * Also installs an `onRender` callback that re-registers the `@error` tag
 * on every `createRenderer()` call, ensuring it is never overwritten by
 * `@adonisjs/session`'s deferred plugin which registers its own `@error`
 * tag for session flash messages.
 *
 * Idempotent — safe to call multiple times on the same Edge instance.
 * A module-level `WeakSet` tracks which instances have already been
 * registered; subsequent calls are no-ops.
 */
export function registerAdowireTags(edge: any): void {
  // Guard against double-registration (direct call + deferred plugin call).
  if (registeredInstances.has(edge)) return
  registeredInstances.add(edge)

  edge.registerTag(adowireStylesTag)
  edge.registerTag(adowireScriptsTag)
  edge.registerTag(adowireComponentTag)
  edge.registerTag(errorTag)

  // Register the HTML-style tag preprocessor so <adowire:*> tags in templates
  // are transparently transformed into @adowire(...) calls before compilation.
  // Using a named exported function ensures Edge.js's Set-based processor
  // registry deduplicates it correctly if process() is ever called twice.
  edge.processor.process('raw', adowireHtmlProcessor)

  // ── @error tag precedence guard ───────────────────────────────────────────
  //
  // `@adonisjs/session` registers a deferred Edge plugin via `edge.use()`
  // that adds its own `@error` tag reading from `state.flashMessages`.
  // Deferred plugins execute inside `createRenderer()`, which happens AFTER
  // our `boot()` registration above — so session's tag overwrites ours.
  //
  // `edge.onRender()` registers a callback that runs at the END of every
  // `createRenderer()` call, after all plugins have executed. By
  // re-registering our `@error` tag here, we guarantee it always takes
  // precedence regardless of plugin execution order.
  //
  // This is safe and cheap: `registerTag()` is a simple property assignment
  // on the shared `tags` object (`tags['error'] = errorTag`).
  if (typeof edge.onRender === 'function') {
    edge.onRender((_renderer: any) => {
      edge.registerTag(errorTag)
    })
  }
}

/**
 * The main adowire Edge.js plugin (for use with `edge.use()`).
 *
 * This is a thin wrapper around `registerAdowireTags` that conforms to the
 * Edge.js plugin function signature. Plugins registered via `edge.use()` are
 * executed lazily inside `createRenderer()`, so prefer `registerAdowireTags`
 * when you have a direct reference to the Edge instance during boot.
 */
export const adowireEdgePlugin: EdgePluginFn = (edge, _firstRun, _options) => {
  registerAdowireTags(edge)
}
