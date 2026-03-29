import 'reflect-metadata'
import { test } from '@japa/runner'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ComponentRegistry,
  ComponentNotFoundException,
  resolveNameFromPath,
  nameToViewPath,
} from '../src/component_registry.js'
import { WireComponent } from '../src/component.js'
import type { AdowireConfig } from '../src/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AdowireConfig> = {}): AdowireConfig {
  return {
    componentsPath: 'app/adowire',
    viewPrefix: 'adowire',
    ...overrides,
  }
}

/**
 * Create a temporary directory tree for a single test and return its path.
 * The caller is responsible for cleaning up via the returned `cleanup` fn.
 */
async function makeTmpDir(label: string): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = join(tmpdir(), `adowire-test-${label}-${Date.now()}`)
  await mkdir(root, { recursive: true })
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/**
 * Write a minimal valid WireComponent class file to the given path.
 * The class name is derived from the label for clarity.
 */
async function writeComponent(filePath: string, label: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  // No external imports — so dynamic import() succeeds from any temp directory
  const content = `
export default class ${label}Component {
  static __isWireComponent = true
}
`.trimStart()
  await writeFile(filePath, content, 'utf8')
}

/**
 * Write a component file with a custom static componentName.
 */
async function writeNamedComponent(filePath: string, customName: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  const content = `
export default class CustomComponent {
  static __isWireComponent = true
  static componentName = '${customName}'
}
`.trimStart()
  await writeFile(filePath, content, 'utf8')
}

// ─── resolveNameFromPath ──────────────────────────────────────────────────────

test.group('resolveNameFromPath', () => {
  test('flat file → single segment name', ({ assert }) => {
    const result = resolveNameFromPath('/app/adowire/counter.ts', '/app/adowire', null)
    assert.equal(result, 'counter')
  })

  test('nested file → dot-notation name', ({ assert }) => {
    const result = resolveNameFromPath('/app/adowire/posts/create.ts', '/app/adowire', null)
    assert.equal(result, 'posts.create')
  })

  test('deeply nested file → multi-segment dot name', ({ assert }) => {
    const result = resolveNameFromPath('/app/adowire/admin/posts/create.ts', '/app/adowire', null)
    assert.equal(result, 'admin.posts.create')
  })

  test('index file → name includes "index"', ({ assert }) => {
    const result = resolveNameFromPath('/app/adowire/posts/index.ts', '/app/adowire', null)
    assert.equal(result, 'posts.index')
  })

  test('.js extension is stripped correctly', ({ assert }) => {
    const result = resolveNameFromPath('/app/adowire/counter.js', '/app/adowire', null)
    assert.equal(result, 'counter')
  })

  test('namespace prefix is prepended with "::"', ({ assert }) => {
    const result = resolveNameFromPath('/app/adowire/admin/users.ts', '/app/adowire/admin', 'admin')
    assert.equal(result, 'admin::users')
  })

  test('namespace + nested path produces correct name', ({ assert }) => {
    const result = resolveNameFromPath(
      '/app/adowire/admin/roles/list.ts',
      '/app/adowire/admin',
      'admin'
    )
    assert.equal(result, 'admin::roles.list')
  })
})

// ─── nameToViewPath ───────────────────────────────────────────────────────────

test.group('nameToViewPath', () => {
  test('flat name → prefix/name', ({ assert }) => {
    assert.equal(nameToViewPath('counter', 'adowire'), 'adowire/counter')
  })

  test('dot-notation → slashes in view path', ({ assert }) => {
    assert.equal(nameToViewPath('posts.create', 'adowire'), 'adowire/posts/create')
  })

  test('deeply nested dot-notation', ({ assert }) => {
    assert.equal(nameToViewPath('admin.posts.create', 'adowire'), 'adowire/admin/posts/create')
  })

  test('namespace :: prefix is unfolded into path', ({ assert }) => {
    assert.equal(nameToViewPath('admin::users', 'adowire'), 'adowire/admin/users')
  })

  test('namespace + dot-notation', ({ assert }) => {
    assert.equal(nameToViewPath('admin::roles.list', 'adowire'), 'adowire/admin/roles/list')
  })

  test('custom prefix is respected', ({ assert }) => {
    assert.equal(nameToViewPath('counter', 'components'), 'components/counter')
  })
})

// ─── ComponentRegistry — manual registration ──────────────────────────────────

test.group('ComponentRegistry — manual registration', () => {
  test('register() and has() work', ({ assert }) => {
    class Counter extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('counter', Counter)
    assert.isTrue(registry.has('counter'))
  })

  test('has() returns false for unknown name', ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    assert.isFalse(registry.has('unknown'))
  })

  test('get() returns the definition for a registered component', ({ assert }) => {
    class Counter extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('counter', Counter)

    const def = registry.get('counter')
    assert.equal(def?.name, 'counter')
    assert.equal(def?.viewName, 'adowire/counter')
  })

  test('get() returns undefined for unknown name', ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    assert.isUndefined(registry.get('nope'))
  })

  test('register() with namespace name', ({ assert }) => {
    class AdminUsers extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('admin::users', AdminUsers)

    const def = registry.get('admin::users')
    assert.equal(def?.name, 'admin::users')
    assert.equal(def?.viewName, 'adowire/admin/users')
  })

  test('register() with dot-notation name', ({ assert }) => {
    class PostsCreate extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('posts.create', PostsCreate)

    const def = registry.get('posts.create')
    assert.equal(def?.viewName, 'adowire/posts/create')
  })

  test('custom viewPrefix is used in viewName', ({ assert }) => {
    class Counter extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig({ viewPrefix: 'components' }))
    registry.register('counter', Counter)

    const def = registry.get('counter')
    assert.equal(def?.viewName, 'components/counter')
  })
})

// ─── ComponentRegistry — make() factory ──────────────────────────────────────

test.group('ComponentRegistry — make()', () => {
  test('make() returns a fresh instance of the component', ({ assert }) => {
    class Counter extends WireComponent {
      count = 0
    }
    const registry = new ComponentRegistry(makeConfig())
    registry.register('counter', Counter)

    const instance = registry.make('counter')
    assert.instanceOf(instance, Counter)
  })

  test('make() returns a new instance on each call', ({ assert }) => {
    class Counter extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('counter', Counter)

    const a = registry.make('counter')
    const b = registry.make('counter')
    assert.notStrictEqual(a, b)
  })

  test('make() throws ComponentNotFoundException for unknown name', ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    assert.throws(() => registry.make('unknown'), ComponentNotFoundException)
  })

  test('ComponentNotFoundException message includes the component name', ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    try {
      registry.make('my.component')
      assert.fail('should have thrown')
    } catch (err: any) {
      assert.include(err.message, 'my.component')
    }
  })
})

// ─── ComponentRegistry — introspection ───────────────────────────────────────

test.group('ComponentRegistry — introspection', () => {
  test('all() returns all registered definitions sorted by name', ({ assert }) => {
    class A extends WireComponent {}
    class B extends WireComponent {}
    class C extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('posts.create', A)
    registry.register('counter', B)
    registry.register('admin::users', C)

    const names = registry.all().map((d) => d.name)
    assert.deepEqual(names, ['admin::users', 'counter', 'posts.create'])
  })

  test('size returns correct count', ({ assert }) => {
    class A extends WireComponent {}
    class B extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    assert.equal(registry.size, 0)
    registry.register('a', A)
    registry.register('b', B)
    assert.equal(registry.size, 2)
  })

  test('clear() removes all registrations', ({ assert }) => {
    class A extends WireComponent {}
    const registry = new ComponentRegistry(makeConfig())
    registry.register('a', A)
    registry.clear()
    assert.equal(registry.size, 0)
    assert.isFalse(registry.has('a'))
  })
})

// ─── ComponentRegistry — file-system discovery ────────────────────────────────

test.group('ComponentRegistry — discover() (file system)', (group) => {
  let root = ''
  let cleanup: () => Promise<void>

  group.setup(async () => {
    const tmp = await makeTmpDir('discover')
    root = tmp.root
    cleanup = tmp.cleanup

    // Flat component
    await writeComponent(join(root, 'app/adowire/counter.ts'), 'Counter')
    // Nested component
    await writeComponent(join(root, 'app/adowire/posts/create.ts'), 'PostsCreate')
    await writeComponent(join(root, 'app/adowire/posts/index.ts'), 'PostsIndex')
    // Deeply nested
    await writeComponent(join(root, 'app/adowire/admin/reports/summary.ts'), 'Summary')
  })

  group.teardown(async () => {
    await cleanup()
  })

  test('discovers flat component', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    assert.isTrue(registry.has('counter'))
  })

  test('discovers nested components with dot-notation names', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    assert.isTrue(registry.has('posts.create'))
    assert.isTrue(registry.has('posts.index'))
  })

  test('discovers deeply nested component', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    assert.isTrue(registry.has('admin.reports.summary'))
  })

  test('discovered component has correct viewName', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    const def = registry.get('posts.create')
    assert.equal(def?.viewName, 'adowire/posts/create')
  })

  test('total discovery count is correct', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    // counter, posts.create, posts.index, admin.reports.summary = 4
    assert.equal(registry.size, 4)
  })

  test('discover() is idempotent (calling twice does not duplicate)', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    await registry.discover(root)
    assert.equal(registry.size, 4)
  })

  test('discover() on a non-existent directory does not throw', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig({ componentsPath: 'app/does_not_exist' }))
    await assert.doesNotReject(() => registry.discover(root))
  })
})

// ─── ComponentRegistry — namespace discovery ──────────────────────────────────

test.group('ComponentRegistry — discover() with namespaces', (group) => {
  let root = ''
  let cleanup: () => Promise<void>

  group.setup(async () => {
    const tmp = await makeTmpDir('namespaces')
    root = tmp.root
    cleanup = tmp.cleanup

    // Default namespace
    await writeComponent(join(root, 'app/adowire/counter.ts'), 'Counter')
    // Admin namespace
    await writeComponent(join(root, 'app/adowire/admin/users.ts'), 'AdminUsers')
    await writeComponent(join(root, 'app/adowire/admin/roles/list.ts'), 'RolesList')
  })

  group.teardown(async () => {
    await cleanup()
  })

  test('namespace components are discovered with :: prefix', async ({ assert }) => {
    const registry = new ComponentRegistry(
      makeConfig({ namespaces: { admin: 'app/adowire/admin' } })
    )
    await registry.discover(root)
    assert.isTrue(registry.has('admin::users'))
    assert.isTrue(registry.has('admin::roles.list'))
  })

  test('default namespace component is still discovered', async ({ assert }) => {
    const registry = new ComponentRegistry(
      makeConfig({ namespaces: { admin: 'app/adowire/admin' } })
    )
    await registry.discover(root)
    assert.isTrue(registry.has('counter'))
  })

  test('namespace component has correct viewName', async ({ assert }) => {
    const registry = new ComponentRegistry(
      makeConfig({ namespaces: { admin: 'app/adowire/admin' } })
    )
    await registry.discover(root)
    const def = registry.get('admin::users')
    assert.equal(def?.viewName, 'adowire/admin/users')
  })
})

// ─── ComponentRegistry — static componentName override ───────────────────────

test.group('ComponentRegistry — static componentName override', (group) => {
  let root = ''
  let cleanup: () => Promise<void>

  group.setup(async () => {
    const tmp = await makeTmpDir('static-name')
    root = tmp.root
    cleanup = tmp.cleanup

    // Component with a custom static name
    await writeNamedComponent(join(root, 'app/adowire/my_counter.ts'), 'counter')
  })

  group.teardown(async () => {
    await cleanup()
  })

  test('static componentName overrides file-based name', async ({ assert }) => {
    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    // Should be registered under 'counter', NOT 'my_counter'
    assert.isTrue(registry.has('counter'))
    assert.isFalse(registry.has('my_counter'))
  })
})

// ─── ComponentRegistry — manual overrides auto-discovered ────────────────────

test.group('ComponentRegistry — manual registration overrides auto-discovery', (group) => {
  let root = ''
  let cleanup: () => Promise<void>

  group.setup(async () => {
    const tmp = await makeTmpDir('override')
    root = tmp.root
    cleanup = tmp.cleanup
    await writeComponent(join(root, 'app/adowire/counter.ts'), 'Counter')
  })

  group.teardown(async () => {
    await cleanup()
  })

  test('manually registered constructor is used by make()', async ({ assert }) => {
    class ManualCounter extends WireComponent {
      isManual = true
    }

    const registry = new ComponentRegistry(makeConfig())
    await registry.discover(root)
    // Override the auto-discovered 'counter' with the manual one
    registry.register('counter', ManualCounter)

    const instance = registry.make('counter')
    assert.instanceOf(instance, ManualCounter)
  })
})
