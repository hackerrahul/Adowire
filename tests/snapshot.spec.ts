import 'reflect-metadata'
import { test } from '@japa/runner'
import { WireComponent } from '../src/component.js'
import { SnapshotManager, ChecksumException } from '../src/snapshot.js'
import type { AdowireConfig } from '../src/types.js'
import type { HttpContext } from '@adonisjs/core/http'

// ─── Test double for WireComponent ───────────────────────────────────────────

const SECRET = 'test-secret-key-32-chars-minimum!!'

function makeManager() {
  return new SnapshotManager(SECRET)
}

/**
 * Minimal concrete WireComponent for testing.
 * We bypass $ctx and $config since snapshot tests don't need them.
 */
class TestComponent extends WireComponent {
  count = 0
  title = 'Hello'
  active = true
  score: number | null = null
}

class ComplexComponent extends WireComponent {
  createdAt = new Date('2024-01-15T12:00:00.000Z')
  tags = new Set(['a', 'b', 'c'])
  meta = new Map<string, number>([
    ['views', 42],
    ['likes', 7],
  ])
  nested = { foo: 'bar', count: 3 }
  items = ['x', 'y', 'z']
}

function makeComponent<T extends WireComponent>(
  Cls: new () => T,
  overrides: Partial<{ $id: string; $name: string }> = {}
): T {
  const comp = new Cls()
  comp.$id = overrides.$id ?? '01HXTEST0000000000000001'
  comp.$name = overrides.$name ?? 'test'
  comp.$config = {} as AdowireConfig
  comp.$ctx = {} as HttpContext
  return comp
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.group('SnapshotManager — constructor', () => {
  test('throws when secret is empty', ({ assert }) => {
    assert.throws(() => new SnapshotManager(''), /non-empty secret/)
  })

  test('throws when secret is only whitespace', ({ assert }) => {
    assert.throws(() => new SnapshotManager('   '), /non-empty secret/)
  })

  test('constructs successfully with a valid secret', ({ assert }) => {
    assert.doesNotThrow(() => new SnapshotManager('valid-secret'))
  })
})

test.group('SnapshotManager — dehydrate (primitives)', () => {
  test('serialises primitive properties verbatim', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)

    const snapshot = await manager.dehydrate(comp)

    assert.equal(snapshot.state.count, 0)
    assert.equal(snapshot.state.title, 'Hello')
    assert.equal(snapshot.state.active, true)
    assert.isNull(snapshot.state.score)
  })

  test('builds memo with correct name, id, locale, and empty errors', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent, { $name: 'counter', $id: 'MYID' })

    const snapshot = await manager.dehydrate(comp, {
      locale: 'fr',
      path: '/counter',
      method: 'GET',
    })

    assert.equal(snapshot.memo.name, 'counter')
    assert.equal(snapshot.memo.id, 'MYID')
    assert.equal(snapshot.memo.locale, 'fr')
    assert.equal(snapshot.memo.path, '/counter')
    assert.equal(snapshot.memo.method, 'GET')
    assert.deepEqual(snapshot.memo.errors, {})
  })

  test('defaults locale to "en" when ctx is omitted', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)
    assert.equal(snapshot.memo.locale, 'en')
  })

  test('includes a non-empty checksum string', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)
    assert.typeOf(snapshot.checksum, 'string')
    assert.isAbove(snapshot.checksum.length, 0)
  })

  test('serialises nested plain objects recursively', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)
    assert.deepEqual(snapshot.state.nested, { foo: 'bar', count: 3 })
  })

  test('serialises plain arrays recursively', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)
    assert.deepEqual(snapshot.state.items, ['x', 'y', 'z'])
  })
})

test.group('SnapshotManager — dehydrate (synthesizers)', () => {
  test('dehydrates Date as [isoString, { s: "date" }] tuple', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const dateField = snapshot.state.createdAt as [string, { s: string }]
    assert.isArray(dateField)
    assert.equal(dateField.length, 2)
    assert.equal(dateField[0], '2024-01-15T12:00:00.000Z')
    assert.deepEqual(dateField[1], { s: 'date' })
  })

  test('dehydrates Set as [array, { s: "set" }] tuple', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const setField = snapshot.state.tags as [unknown[], { s: string }]
    assert.isArray(setField)
    assert.equal(setField[1].s, 'set')
    assert.sameMembers(setField[0] as string[], ['a', 'b', 'c'])
  })

  test('dehydrates Map as [entries, { s: "map" }] tuple', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const mapField = snapshot.state.meta as [unknown[][], { s: string }]
    assert.isArray(mapField)
    assert.equal(mapField[1].s, 'map')
    assert.isArray(mapField[0])
    // entries: [['views', 42], ['likes', 7]]
    const entries = mapField[0] as [string, number][]
    const asObj = Object.fromEntries(entries)
    assert.equal(asObj['views'], 42)
    assert.equal(asObj['likes'], 7)
  })
})

test.group('SnapshotManager — hydrate (primitives)', () => {
  test('round-trips primitive properties unchanged', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    comp.count = 99
    comp.title = 'World'
    comp.active = false

    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(TestComponent)
    manager.hydrate(restored, snapshot)

    assert.equal(restored.count, 99)
    assert.equal(restored.title, 'World')
    assert.equal(restored.active, false)
    assert.isNull(restored.score)
  })

  test('restores $id and $name from memo', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent, { $id: 'SNAP_ID', $name: 'my.component' })

    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(TestComponent)
    manager.hydrate(restored, snapshot)

    assert.equal(restored.$id, 'SNAP_ID')
    assert.equal(restored.$name, 'my.component')
  })

  test('restores $errors from memo', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    comp.$errors = { title: ['Title is required'] }

    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(TestComponent)
    manager.hydrate(restored, snapshot)

    assert.deepEqual(restored.$errors, { title: ['Title is required'] })
  })

  test('round-trips nested plain objects', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(ComplexComponent)
    manager.hydrate(restored, snapshot)

    assert.deepEqual(restored.nested, { foo: 'bar', count: 3 })
  })

  test('round-trips plain arrays', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(ComplexComponent)
    manager.hydrate(restored, snapshot)

    assert.deepEqual(restored.items, ['x', 'y', 'z'])
  })
})

test.group('SnapshotManager — hydrate (synthesizers)', () => {
  test('round-trips Date correctly', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(ComplexComponent)
    manager.hydrate(restored, snapshot)

    assert.instanceOf(restored.createdAt, Date)
    assert.equal(restored.createdAt.toISOString(), '2024-01-15T12:00:00.000Z')
  })

  test('round-trips Set correctly', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(ComplexComponent)
    manager.hydrate(restored, snapshot)

    assert.instanceOf(restored.tags, Set)
    assert.isTrue(restored.tags.has('a'))
    assert.isTrue(restored.tags.has('b'))
    assert.isTrue(restored.tags.has('c'))
    assert.equal(restored.tags.size, 3)
  })

  test('round-trips Map correctly', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(ComplexComponent)
    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(ComplexComponent)
    manager.hydrate(restored, snapshot)

    assert.instanceOf(restored.meta, Map)
    assert.equal(restored.meta.get('views'), 42)
    assert.equal(restored.meta.get('likes'), 7)
  })
})

test.group('SnapshotManager — HMAC signing', () => {
  test('two dehydrations of the same component produce the same checksum', async ({ assert }) => {
    const manager = makeManager()
    const comp1 = makeComponent(TestComponent, { $id: 'FIXED', $name: 'test' })
    const comp2 = makeComponent(TestComponent, { $id: 'FIXED', $name: 'test' })

    const snap1 = await manager.dehydrate(comp1, { locale: 'en' })
    const snap2 = await manager.dehydrate(comp2, { locale: 'en' })

    assert.equal(snap1.checksum, snap2.checksum)
  })

  test('different secrets produce different checksums', async ({ assert }) => {
    const mgr1 = new SnapshotManager('secret-one')
    const mgr2 = new SnapshotManager('secret-two')
    const comp = makeComponent(TestComponent, { $id: 'FIXED', $name: 'test' })

    const snap1 = await mgr1.dehydrate(comp, { locale: 'en' })
    const snap2 = await mgr2.dehydrate(comp, { locale: 'en' })

    assert.notEqual(snap1.checksum, snap2.checksum)
  })

  test('verify() passes for a freshly dehydrated snapshot', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)

    assert.doesNotThrow(() => manager.verify(snapshot))
  })

  test('verify() throws ChecksumException when state is tampered', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)

    // Tamper with the state
    ;(snapshot.state as any).count = 9999

    assert.throws(() => manager.verify(snapshot), ChecksumException)
  })

  test('verify() throws ChecksumException when memo is tampered', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)

    // Tamper with the memo
    snapshot.memo.name = 'evil.component'

    assert.throws(() => manager.verify(snapshot), ChecksumException)
  })

  test('verify() throws ChecksumException when checksum is empty', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)

    snapshot.checksum = ''

    assert.throws(() => manager.verify(snapshot), ChecksumException)
  })

  test('hydrate() throws ChecksumException on a tampered snapshot', async ({ assert }) => {
    const manager = makeManager()
    const comp = makeComponent(TestComponent)
    const snapshot = await manager.dehydrate(comp)

    snapshot.state.count = 42 as any

    const restored = makeComponent(TestComponent)
    assert.throws(() => manager.hydrate(restored, snapshot), ChecksumException)
  })
})

test.group('SnapshotManager — custom synthesizer', () => {
  test('register() prepends a custom synthesizer and it takes priority', async ({ assert }) => {
    const manager = makeManager()

    // Custom synthesizer for BigInt
    const BigIntSynth = {
      key: 'bigint',
      match: (v: unknown) => typeof v === 'bigint',
      dehydrate: (v: unknown) => [String(v as bigint), { s: 'bigint' }] as [string, { s: string }],
      hydrate: (v: unknown) => BigInt(v as string),
    }

    manager.register(BigIntSynth)

    // Manually dehydrate a bigint value
    const serialized = manager.dehydrateValue(BigInt(12345))
    assert.isArray(serialized)
    const [data, meta] = serialized as [unknown, { s: string }]
    assert.equal(data, '12345')
    assert.equal(meta.s, 'bigint')

    // Hydrate it back
    const restored = manager.hydrateValue(serialized as any)
    assert.equal(restored, BigInt(12345))
  })

  test('custom synthesizer shadows built-in when same key is used', ({ assert }) => {
    const manager = makeManager()

    let dehydrateCalled = false
    const CustomDate = {
      key: 'date',
      match: (v: unknown) => v instanceof Date,
      dehydrate: (v: unknown) => {
        dehydrateCalled = true
        return [(v as Date).getFullYear().toString(), { s: 'date' }] as [string, { s: string }]
      },
      hydrate: (v: unknown) => new Date(Number(v as string), 0, 1),
    }

    manager.register(CustomDate)
    manager.dehydrateValue(new Date('2024-06-15'))

    assert.isTrue(dehydrateCalled)
  })
})

test.group('SnapshotManager — edge cases', () => {
  test('dehydrateValue returns null for unrecognised class instances', ({ assert }) => {
    const manager = makeManager()

    class Foo {
      bar = 1
    }

    const result = manager.dehydrateValue(new Foo())
    assert.isNull(result)
  })

  test('dehydrateValue handles undefined as null', ({ assert }) => {
    const manager = makeManager()
    const result = manager.dehydrateValue(undefined)
    assert.isUndefined(result)
  })

  test('hydrateValue handles unknown synthesizer key gracefully', ({ assert }) => {
    const manager = makeManager()
    // A tuple with an unknown synthesizer key — should return the raw data portion
    const result = manager.hydrateValue(['raw-data', { s: 'unknown-type' }] as any)
    assert.equal(result, 'raw-data')
  })

  test('full round-trip with empty component state', async ({ assert }) => {
    class EmptyComponent extends WireComponent {}

    const manager = makeManager()
    const comp = makeComponent(EmptyComponent)
    const snapshot = await manager.dehydrate(comp)

    const restored = makeComponent(EmptyComponent)
    manager.hydrate(restored, snapshot)

    assert.deepEqual(restored.$getPublicState(), {})
  })
})
