import 'reflect-metadata'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WireComponent } from './component.js'
import type { ComponentConstructor, ComponentDefinition, AdowireConfig } from './types.js'

// ─── ComponentRegistry ────────────────────────────────────────────────────────

/**
 * Discovers, registers, and instantiates adowire components.
 *
 * ## Name resolution
 *
 * Component names are derived from their file path relative to the components
 * root directory. Path segments are joined with dots and the file extension is
 * stripped:
 *
 *   app/adowire/counter.ts          → "counter"
 *   app/adowire/posts/create.ts     → "posts.create"
 *   app/adowire/posts/index.ts      → "posts.index"
 *
 * A component class can override auto-detected naming by setting a static
 * `componentName` property:
 *
 * ```ts
 * export default class MyCounter extends WireComponent {
 *   static componentName = 'my-counter'
 * }
 * ```
 *
 * ## Namespaces
 *
 * Additional component directories can be registered under a namespace prefix.
 * Components in a namespace are referenced as `namespace::component.name`:
 *
 *   namespace "admin", path "app/adowire/admin"
 *   app/adowire/admin/users.ts  →  "admin::users"
 *
 * Namespaces are configured in `config/adowire.ts` under `namespaces`.
 *
 * ## Usage
 *
 * ```ts
 * const registry = new ComponentRegistry(config)
 * await registry.discover()
 *
 * // Instantiate by name
 * const counter = await registry.make('counter')
 *
 * // Manual registration
 * registry.register('my-counter', MyCounter)
 * ```
 */
export class ComponentRegistry {
  /**
   * All registered components keyed by their full name (including namespace
   * prefix if applicable), e.g. `"counter"`, `"posts.create"`, `"admin::users"`.
   */
  private components: Map<string, ComponentDefinition> = new Map()

  /**
   * Constructors for manually registered components.
   * Keyed by component name.
   */
  private constructors: Map<string, ComponentConstructor> = new Map()

  constructor(private readonly config: AdowireConfig) {}

  // ─── Discovery ─────────────────────────────────────────────────────────────

  /**
   * Scan the configured component directories and register all found components.
   *
   * Auto-discovers from:
   * 1. The default `componentsPath` (default: `app/adowire`)
   * 2. Any namespace paths defined in `config.namespaces`
   *
   * This is called once at application boot by the service provider.
   *
   * @param appRoot Absolute path to the AdonisJS application root
   */
  async discover(appRoot: string): Promise<void> {
    const defaultPath = this.config.componentsPath ?? 'app/adowire'
    await this.scanDirectory(join(appRoot, defaultPath), join(appRoot, defaultPath), null)

    const namespaces = this.config.namespaces ?? {}
    for (const [ns, nsPath] of Object.entries(namespaces)) {
      const absNsPath = join(appRoot, nsPath)
      await this.scanDirectory(absNsPath, absNsPath, ns)
    }
  }

  /**
   * Recursively scan a directory for component files.
   *
   * @param dir       Current directory being scanned (absolute)
   * @param root      Root of the component tree for this scan (absolute)
   * @param namespace Namespace prefix, or null for the default namespace
   */
  private async scanDirectory(dir: string, root: string, namespace: string | null): Promise<void> {
    let entries: string[]

    try {
      entries = await readdir(dir)
    } catch {
      // Directory doesn't exist yet — not an error (app may not have any components)
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const info = await stat(fullPath).catch(() => null)
      if (!info) continue

      if (info.isDirectory()) {
        await this.scanDirectory(fullPath, root, namespace)
      } else if (info.isFile() && isComponentFile(entry)) {
        await this.registerFromFile(fullPath, root, namespace)
      }
    }
  }

  /**
   * Import a component file and register the default export.
   *
   * @param filePath  Absolute path to the component class file
   * @param root      Root directory for name resolution
   * @param namespace Namespace prefix or null
   */
  private async registerFromFile(
    filePath: string,
    root: string,
    namespace: string | null
  ): Promise<void> {
    let mod: any
    try {
      mod = await import(pathToFileURL(filePath).href)
    } catch (err) {
      // Log the error so discovery failures are visible during development
      console.error(
        `[adowire] Failed to import component file: ${filePath}`,
        err instanceof Error ? err.message : err
      )
      return
    }

    const Ctor: ComponentConstructor | undefined = mod?.default ?? mod?.[Object.keys(mod ?? {})[0]]
    if (!Ctor || typeof Ctor !== 'function') return

    // Allow the class to declare its own name
    const name = Ctor.componentName ?? resolveNameFromPath(filePath, root, namespace)
    const viewName = nameToViewPath(name, this.config.viewPrefix ?? 'adowire')

    const definition: ComponentDefinition = {
      name,
      classPath: filePath,
      viewName,
    }

    this.components.set(name, definition)
    this.constructors.set(name, Ctor)
  }

  // ─── Manual Registration ───────────────────────────────────────────────────

  /**
   * Manually register a component class under the given name.
   *
   * This is the programmatic equivalent of file-based auto-discovery.
   * Manually registered components take precedence over auto-discovered ones
   * with the same name.
   *
   * ```ts
   * registry.register('counter', CounterComponent)
   * registry.register('admin::users', AdminUsersComponent)
   * ```
   *
   * @param name  The component name (dot-notation, with optional `namespace::` prefix)
   * @param Ctor  The component constructor (class that extends WireComponent)
   */
  register(name: string, Ctor: ComponentConstructor): void {
    const viewName = nameToViewPath(name, this.config.viewPrefix ?? 'adowire')
    const definition: ComponentDefinition = {
      name,
      classPath: '',
      viewName,
    }
    this.components.set(name, definition)
    this.constructors.set(name, Ctor)
  }

  // ─── Factory ───────────────────────────────────────────────────────────────

  /**
   * Create a fresh instance of the named component.
   *
   * @param name  Component name (e.g. `"counter"`, `"posts.create"`, `"admin::users"`)
   * @returns     A new, uninitialised `WireComponent` instance
   * @throws      `ComponentNotFoundException` if the name is not registered
   */
  make(name: string): InstanceType<ComponentConstructor> {
    const Ctor = this.constructors.get(name)
    if (!Ctor) {
      throw new ComponentNotFoundException(
        `Adowire: no component registered under the name "${name}". ` +
          `Make sure the file exists in "${this.config.componentsPath ?? 'app/adowire'}" ` +
          `and that \`registry.discover(appRoot)\` has been called.`
      )
    }
    return new Ctor()
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /**
   * Return the `ComponentDefinition` for a registered component name.
   * Returns `undefined` if the component is not registered.
   */
  get(name: string): ComponentDefinition | undefined {
    return this.components.get(name)
  }

  /**
   * Return `true` if a component with the given name is registered.
   */
  has(name: string): boolean {
    return this.components.has(name)
  }

  /**
   * Return all registered component definitions as an array, sorted by name.
   */
  all(): ComponentDefinition[] {
    return [...this.components.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Return the total number of registered components.
   */
  get size(): number {
    return this.components.size
  }

  /**
   * Remove all registered components. Useful in tests.
   */
  clear(): void {
    this.components.clear()
    this.constructors.clear()
  }
}

// ─── Name Resolution Helpers ──────────────────────────────────────────────────

/**
 * Derive a dot-notation component name from a file path.
 *
 * Examples (root = "/app/adowire", namespace = null):
 *   /app/adowire/counter.ts         → "counter"
 *   /app/adowire/posts/create.ts    → "posts.create"
 *   /app/adowire/posts/index.ts     → "posts.index"
 *
 * Examples (root = "/app/adowire/admin", namespace = "admin"):
 *   /app/adowire/admin/users.ts     → "admin::users"
 *   /app/adowire/admin/roles/list.ts → "admin::roles.list"
 *
 * @param filePath  Absolute path to the component file
 * @param root      Absolute root directory for this namespace
 * @param namespace Namespace prefix (e.g. "admin"), or null for default
 */
export function resolveNameFromPath(
  filePath: string,
  root: string,
  namespace: string | null
): string {
  // Make relative and strip extension
  const rel = relative(root, filePath)
  const withoutExt = rel.slice(0, rel.length - extname(rel).length)

  // Convert OS path separators to dots
  const dotName = withoutExt.split(sep).join('.')

  return namespace ? `${namespace}::${dotName}` : dotName
}

/**
 * Convert a dot-notation component name to an Edge.js view path.
 *
 * Examples (prefix = "adowire"):
 *   "counter"         → "adowire/counter"
 *   "posts.create"    → "adowire/posts/create"
 *   "admin::users"    → "adowire/admin/users"
 *   "admin::roles.list" → "adowire/admin/roles/list"
 *
 * @param name    Dot-notation component name (with optional `namespace::` prefix)
 * @param prefix  Edge view prefix (default: "adowire")
 */
export function nameToViewPath(name: string, prefix: string): string {
  // Strip namespace prefix and fold it into the path
  let normalized = name
  if (name.includes('::')) {
    const [ns, rest] = name.split('::', 2)
    normalized = `${ns}/${rest}`
  }

  // Dots → slashes for the view path
  const viewPath = normalized.replace(/\./g, '/')

  return `${prefix}/${viewPath}`
}

/**
 * Returns `true` if the given filename looks like a component file.
 * We accept `.ts` files but skip type declaration files (`.d.ts`),
 * test files (`.spec.ts`, `.test.ts`), and hidden files.
 */
function isComponentFile(filename: string): boolean {
  if (filename.startsWith('.')) return false
  if (filename.endsWith('.d.ts')) return false
  if (filename.endsWith('.spec.ts') || filename.endsWith('.test.ts')) return false
  if (filename.endsWith('.spec.js') || filename.endsWith('.test.js')) return false
  return filename.endsWith('.ts') || filename.endsWith('.js')
}

// ─── ComponentNotFoundException ───────────────────────────────────────────────

/**
 * Thrown by `ComponentRegistry.make()` when the requested component name
 * has not been registered.
 */
export class ComponentNotFoundException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComponentNotFoundException'
  }
}

// ─── WireComponent type re-export for registry consumers ─────────────────────

// Exported so callers can type-check instances returned by make() without
// importing from component.ts directly.
export type { WireComponent }
