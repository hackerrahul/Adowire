/**
 * adowire — WireProvider
 *
 * AdonisJS v7 service provider that wires together the adowire runtime:
 *
 *  register()
 *    - Binds an `Adowire` singleton to the IoC container holding
 *      { registry, snapshot, config }
 *
 *  boot()
 *    - Reads config/adowire.ts (with sensible defaults)
 *    - Registers the Edge.js plugin (tags + globals)
 *    - Registers the POST /adowire/message route
 *    - Triggers component auto-discovery
 */

import { createReadStream, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { ApplicationService } from '@adonisjs/core/types'
import { ComponentRegistry } from '../src/component_registry.js'
import { SnapshotManager } from '../src/snapshot.js'
import { WireRequestHandler } from '../src/request_handler.js'
import { registerAdowireTags, adowireEdgePlugin } from '../src/edge/plugin.js'
import type { AdowireConfig } from '../src/types.js'

// ─── Container binding key ────────────────────────────────────────────────────

export const ADOWIRE_BINDING = 'adowire' as const

// ─── Shape stored in the container ───────────────────────────────────────────

export interface AdowireBinding {
  registry: ComponentRegistry
  snapshot: SnapshotManager
  config: AdowireConfig
}

// ─── Module augmentation — teach the AdonisJS container about our binding ────

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    adowire: AdowireBinding
  }
}

// Teach TypeScript that the AdonisJS router gained a .adowire() method via
// the macro registered in WireProvider.boot(). This makes router.adowire()
// fully typed in start/routes.ts with no casts needed.
declare module '@adonisjs/http-server' {
  interface Router {
    /**
     * Register a GET route that renders a WireComponent as a full page.
     * No controller, no wrapper view needed — the component IS the page.
     *
     * Equivalent to Livewire's `Route::livewire()` in Laravel.
     *
     * Route parameters are passed directly to the component's `mount()`:
     * ```ts
     * // start/routes.ts
     * router.adowire('/posts/:id', 'posts.show')
     *
     * // app/adowire/posts/show.ts
     * async mount({ id }: Record<string, string>) {
     *   this.post = await Post.findOrFail(id)
     *   this.$title = `Post: ${this.post.title}`
     * }
     * ```
     */
    adowire(path: string, componentName: string): any
  }
}

// ─── WireProvider ─────────────────────────────────────────────────────────────

export default class WireProvider {
  constructor(protected app: ApplicationService) {}

  // ─── register ──────────────────────────────────────────────────────────────

  /**
   * Bind the `Adowire` singleton to the container.
   *
   * We defer the full initialisation (config read, discovery, etc.) to
   * boot() because other providers (e.g. the Edge provider) may not have
   * run yet during register().
   *
   * The binding is created as a lazy singleton so the heavyweight
   * SnapshotManager / ComponentRegistry objects are only constructed once.
   */
  async register(): Promise<void> {
    this.app.container.singleton(ADOWIRE_BINDING, async () => {
      // Read config with defaults — done here so the singleton factory is
      // self-contained and can be resolved from anywhere after boot.
      const rawConfig: AdowireConfig = this.app.config.get('adowire', {})

      const config: AdowireConfig = {
        prefix: rawConfig.prefix ?? '/adowire',
        componentsPath: rawConfig.componentsPath ?? 'app/adowire',
        viewPrefix: rawConfig.viewPrefix ?? 'adowire',
        secret: rawConfig.secret ?? process.env['APP_KEY'] ?? '',
        namespaces: rawConfig.namespaces,
        injectMorphMarkers: rawConfig.injectMorphMarkers,
        maxUploadSize: rawConfig.maxUploadSize,
        tmpPath: rawConfig.tmpPath,
      }

      const rawSecret = config.secret ?? process.env['APP_KEY'] ?? ''
      // AdonisJS v7 wraps APP_KEY in a Secret object — unwrap it to a plain string
      const secret: string =
        rawSecret && typeof rawSecret === 'object' && 'release' in (rawSecret as any)
          ? (rawSecret as any).release()
          : String(rawSecret ?? '')
      const registry = new ComponentRegistry(config)
      const snapshot = new SnapshotManager(secret)

      const binding: AdowireBinding = { registry, snapshot, config }
      return binding
    })
  }

  // ─── boot ──────────────────────────────────────────────────────────────────

  /**
   * 1. Resolve the Adowire binding (builds registry + snapshot).
   * 2. Register the Edge.js plugin.
   * 3. Register the POST /adowire/message route.
   * 4. Run component auto-discovery.
   */
  async boot(): Promise<void> {
    // 1. Resolve our own singleton — this also resolves config with defaults.
    const adowire = await this.app.container.make(ADOWIRE_BINDING)
    const { registry, config } = adowire

    let resolvedEdge: any

    // 2. Register Edge.js tags ───────────────────────────────────────────────
    //
    // edge.js is a peer dependency whose default export is a module-level
    // singleton — the same instance that the @adonisjs/core edge_provider
    // imports via `import edge from 'edge.js'`.  Dynamic-importing it here
    // gives us that exact singleton so we mutate the same `tags` object
    // that both the sync and async compilers reference.
    //
    // We call `registerAdowireTags(edge)` directly instead of the deferred
    // `edge.use(plugin)` approach.  `edge.use()` only executes plugins
    // inside `createRenderer()` (i.e. on the first HTTP request), which is
    // fine for most cases but means the tag list isn't populated during
    // boot.  Direct registration is immediate and deterministic.
    try {
      // edge.js is a peer dependency that lives in the HOST application's
      // node_modules.  A bare `import('edge.js')` resolves relative to
      // *this* file's real path on disk — which, when the package is
      // symlinked via `file:../adowire`, is the adowire source tree where
      // edge.js is NOT installed.
      //
      // Fix: use `createRequire` rooted at the host app to resolve the
      // path, then dynamic-import it.  This guarantees we get the exact
      // same module-level Edge singleton that the @adonisjs/core
      // edge_provider already configured.
      const appRequire = createRequire(this.app.appRoot)
      const edgePath: string = appRequire.resolve('edge.js')
      const edgeModule: any = await import(edgePath)
      const edge = edgeModule.default ?? edgeModule
      resolvedEdge = edge

      // Register @adowireStyles, @adowireScripts, @wire, @error tags directly
      registerAdowireTags(edge)

      // Also register as a deferred Edge plugin so our tags win the plugin
      // registration race against other packages that call `edge.use()` (for
      // example, session/shield may register their own @error tag via a
      // plugin).  Registering both directly and as a plugin guarantees our
      // tags are available immediately and that they will override any
      // competing deferred registrations when the first renderer is created.
      try {
        edge.use(adowireEdgePlugin)
      } catch (e) {
        // Some versions of Edge or execution environments may not support
        // `edge.use()` in the same way; swallow the error to avoid breaking
        // app boot while preserving direct tag registration above.
      }

      // Inject $adowire into every Edge template's global state so the
      // @wire tag can resolve the registry, snapshotManager, and config
      // at render time without needing to be passed explicitly.
      // We include the `edge` instance itself so the @wire tag IIFE can
      // render component templates directly (component.render() relies on
      // $ctx which is not available during initial SSR from the tag).
      // Import the dev proxy utilities so the @adowire SSR tag can wrap
      // template data in a warning proxy during development.
      const { maybeDevProxy, isDevProxyEnabled } = await import('../src/dev_proxy.js')
      const devProxyEnabled = isDevProxyEnabled(config)
      const devProxy = devProxyEnabled
        ? (data: Record<string, any>, componentName: string) =>
            maybeDevProxy(data, componentName, true)
        : undefined

      edge.global('$adowire', { registry, snapshot: adowire.snapshot, config, edge, devProxy })
    } catch (edgeError) {
      // Log the error so it's visible — silent swallowing hides real bugs.
      console.error('[adowire] Failed to register Edge.js tags:', edgeError)
    }

    // 3. Register route ───────────────────────────────────────────────────────
    //
    // We resolve the router from the container so this works whether or not
    // the router service has been registered before our provider boots.
    try {
      const router = await this.app.container.make('router')
      const prefix = config.prefix ?? '/adowire'

      // Using a closure lets us create a fresh WireRequestHandler per-request
      // if we ever need per-request state in the future. For now the handler is
      // stateless across requests so the overhead is minimal.
      router.post(`${prefix}/message`, async (ctx: any) => {
        const handler = new WireRequestHandler(registry, config, adowire.snapshot, resolvedEdge)
        await handler.handleRequest(ctx)
      })

      // Serve the bundled client JS from the package's own build directory.
      // This means consumers don't need to copy or configure anything — just
      // drop @adowireScripts into their layout and it works.
      //
      // import.meta.url points to different locations depending on context:
      //   Dev  (ts-exec): <pkg>/providers/wire_provider.ts
      //   Build (chunk):  <pkg>/build/wire_provider-<hash>.js
      // wire.js is always at <pkg>/build/adowire.js, so we try both paths.
      const thisDir = dirname(fileURLToPath(import.meta.url))
      let wireJsPath = join(thisDir, 'adowire.js')
      if (!existsSync(wireJsPath)) {
        wireJsPath = join(thisDir, '..', 'build', 'adowire.js')
      }

      router.get(`${prefix}/adowire.js`, async (ctx: any) => {
        ctx.response.header('Content-Type', 'application/javascript; charset=utf-8')
        ctx.response.header(
          'Cache-Control',
          this.app.inProduction ? 'public, max-age=3600' : 'no-cache, no-store, must-revalidate'
        )
        ctx.response.stream(createReadStream(wireJsPath))
      })

      // ── router.adowire(path, componentName) ──────────────────────────────────
      //
      // Registers a GET route that renders a WireComponent as a full page.
      // No controller, no wrapper view required — the component IS the page.
      //
      // Equivalent to Livewire's Route::livewire() in Laravel.
      //
      // Usage in start/routes.ts:
      //   router.adowire('/posts/create', 'posts.create')
      //   router.adowire('/posts/:id',    'posts.show')
      //
      // Route params are passed straight into mount():
      //   async mount({ id }: Record<string, string>) { ... }
      ;(router as any).adowire = (path: string, componentName: string) => {
        return router.get(path, async (ctx: any) => {
          // 1. Instantiate and wire up the component
          const component = registry.make(componentName)
          component.$name = componentName
          component.$ctx = ctx
          component.$config = config
          if (resolvedEdge) component.$edge = resolvedEdge

          // Auto-fill matching public properties from route params (Livewire auto-prop parity).
          // Any route param key whose name matches a public component property is pre-assigned
          // BEFORE boot() runs so that boot() can rely on those values being present.
          // Developers can still override the values inside mount() if needed.
          const publicKeys = Object.keys(component.$getPublicState())
          for (const [pk, pv] of Object.entries(ctx.params ?? {})) {
            if (publicKeys.includes(pk)) {
              ;(component as any)[pk] = pv
            }
          }

          try {
            // 2. Full initial lifecycle: boot → mount(route params) → dehydrate
            //    Route params (e.g. { id: '1' } from /posts/:id) are passed
            //    directly into mount() — same pattern as Livewire route binding
            await component.boot()
            await component.$callTraitHooks('boot')

            await component.mount(ctx.params ?? {})
            await component.$callTraitHooks('mount', ctx.params ?? {})

            await component.dehydrate()
            await component.$callTraitHooks('dehydrate')
          } catch (err) {
            // Route the error through the component's exception() hook first
            let stopped = false
            await component.exception(err, () => {
              stopped = true
            })
            if (!stopped) throw err
          }

          // 3. Dehydrate snapshot — signs the state and produces the adowire:id
          const snapshot = await adowire.snapshot.dehydrate(component, {
            path: ctx.request.url(),
            method: ctx.request.method(),
            locale: 'en',
          })
          component.$id = snapshot.memo.id

          // 4. Render the component's Edge template.
          //    component.render() uses ctx.view.render() so the layout gets
          //    the full AdonisJS context (auth, session, csrf, Vite, etc.)
          const html = await component.render()

          // 5. Wrap in the wire marker div — identical shape to what @wire produces
          const snapshotJson = JSON.stringify(snapshot).replace(/'/g, '&#39;')
          const wrapper =
            `<div adowire:id="${snapshot.memo.id}"` +
            ` adowire:name="${componentName}"` +
            ` adowire:snapshot='${snapshotJson}'>${html}</div>`

          // 6. Resolve layout:
          //    Priority: @Layout decorator > config.defaultLayout > bare wrapper
          const layoutMeta = component.$getLayout()
          const layoutName = layoutMeta?.name ?? config.defaultLayout ?? null
          if (layoutName) {
            const title = component.$getTitle()
            return ctx.view.render(layoutName, { $body: wrapper, $title: title })
          }

          return wrapper
        })
      }
    } catch (routerError) {
      console.error('[adowire] Failed to register routes / router.adowire() macro:', routerError)
    }

    // 4. Component auto-discovery ─────────────────────────────────────────────
    //
    // Scan the configured componentsPath (and any namespaces) for component
    // class files and register them in the registry.
    try {
      const appRootPath =
        this.app.appRoot instanceof URL ? fileURLToPath(this.app.appRoot) : String(this.app.appRoot)
      await registry.discover(appRootPath)
    } catch {
      // Discovery failure is non-fatal — errors surface when a component is
      // first resolved via registry.make().
    }
  }
}
