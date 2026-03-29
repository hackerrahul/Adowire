import 'reflect-metadata'
import { test } from '@japa/runner'
import { WireComponent, ValidationException } from '../src/component.js'
import { WireRequestHandler } from '../src/request_handler.js'
import { ComponentRegistry } from '../src/component_registry.js'
import { SnapshotManager } from '../src/snapshot.js'
import {
  ChecksumException,
  LockedPropertyException,
  MethodNotCallableException,
} from '../src/wire_exception.js'
import { WIRE_LOCKED_KEY, WIRE_RENDERLESS_KEY } from '../src/types.js'
import type { AdowireConfig, WireRequestPayload } from '../src/types.js'
import type { HttpContext } from '@adonisjs/core/http'

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-key-for-request-handler!!'
const DEFAULT_CONFIG: AdowireConfig = {
  componentsPath: 'app/adowire',
  viewPrefix: 'adowire',
  prefix: '/adowire',
}

// ─── Test doubles ─────────────────────────────────────────────────────────────

/**
 * Build a minimal fake HttpContext that satisfies what WireRequestHandler needs.
 */
function makeCtx(overrides: Partial<{ body: any; url: string; method: string }> = {}): HttpContext {
  const body = overrides.body ?? {}
  return {
    request: {
      body: () => body,
      url: () => overrides.url ?? '/adowire/message',
      method: () => overrides.method ?? 'POST',
      header: (_name: string) => undefined,
    },
    response: {
      status: function (code: number) {
        this._status = code
        return this
      },
      json: function (data: any) {
        this._body = data
        return this
      },
      _status: 200,
      _body: null,
    },
    containerResolver: {
      make: async (_token: any) => undefined,
    },
  } as unknown as HttpContext
}

/**
 * Build a registry + handler pair with the given component classes pre-registered.
 */
function makeHandler(components: Record<string, new () => WireComponent> = {}) {
  const registry = new ComponentRegistry(DEFAULT_CONFIG)
  for (const [name, Ctor] of Object.entries(components)) {
    registry.register(name, Ctor)
  }
  return {
    registry,
    handler: new WireRequestHandler(registry, DEFAULT_CONFIG, SECRET),
    snapshot: new SnapshotManager(SECRET),
  }
}

/**
 * Dehydrate a component into a valid snapshot that can be embedded in a request payload.
 */
async function dehydrate(
  component: WireComponent,
  snapshot: SnapshotManager,
  ctx?: { path?: string; method?: string; locale?: string }
) {
  return snapshot.dehydrate(component, ctx ?? { path: '/test', method: 'GET', locale: 'en' })
}

/**
 * Initialise a component with the minimum fields the handler sets.
 */
function boot<T extends WireComponent>(
  Ctor: new () => T,
  overrides: Partial<{ $id: string; $name: string }> = {}
): T {
  const comp = new Ctor()
  comp.$id = overrides.$id ?? 'TEST-ID-001'
  comp.$name = overrides.$name ?? 'test'
  comp.$config = DEFAULT_CONFIG
  comp.$ctx = makeCtx()
  return comp
}

// ─── Stub base class ──────────────────────────────────────────────────────────

/**
 * Extends WireComponent with a no-op render() so tests never need
 * a real Edge.js instance. Individual tests that care about HTML
 * can override render() on their own subclass.
 */
abstract class StubComponent extends WireComponent {
  async render(): Promise<string> {
    return `<div data-component="${this.$name}"></div>`
  }
}

// ─── Test components ──────────────────────────────────────────────────────────

class CounterComponent extends StubComponent {
  count = 0

  increment() {
    this.count++
  }

  decrement() {
    this.count--
  }

  addAmount(amount: number) {
    this.count += amount
  }
}

class LockedComponent extends StubComponent {
  open = true
  userId = 99
}
// Simulate @Locked on userId via metadata
Reflect.defineMetadata(WIRE_LOCKED_KEY, ['userId'], LockedComponent.prototype)

class RenderlessComponent extends StubComponent {
  logged = false

  logSomething() {
    this.logged = true
  }
}
// Simulate @Renderless on logSomething
Reflect.defineMetadata(WIRE_RENDERLESS_KEY, ['logSomething'], RenderlessComponent.prototype)

class HookTrackingComponent extends StubComponent {
  bootCalled = false
  hydrateCalled = false
  dehydrateCalled = false
  mountCalled = false
  updatingName = ''
  updatedName = ''
  updatingValue: any = null
  updatedValue: any = null
  count = 0

  async boot() {
    this.bootCalled = true
  }

  async hydrate() {
    this.hydrateCalled = true
  }

  async dehydrate() {
    this.dehydrateCalled = true
  }

  async mount(_props: Record<string, any>) {
    this.mountCalled = true
  }

  async updating(name: string, value: any) {
    this.updatingName = name
    this.updatingValue = value
  }

  async updated(name: string, value: any) {
    this.updatedName = name
    this.updatedValue = value
  }

  increment() {
    this.count++
  }
}

class ExceptionComponent extends StubComponent {
  exceptionCaught = false

  async exception(_err: unknown, stopPropagation: () => void) {
    this.exceptionCaught = true
    stopPropagation()
  }

  throwOnAction() {
    throw new Error('action-error')
  }
}

class MagicActionComponent extends StubComponent {
  count = 0
  flag = false
  redirectUrl = ''
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a full WireRequestPayload for a component that has already been
 * dehydrated (i.e. a "subsequent" AJAX request).
 */
function buildPayload(
  snapshot: any,
  options: {
    calls?: Array<{ method: string; params: any[] }>
    updates?: Record<string, any>
  } = {}
): WireRequestPayload {
  return {
    components: [
      {
        snapshot,
        calls: options.calls ?? [],
        updates: options.updates ?? {},
      },
    ],
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.group('WireRequestHandler — lifecycle hooks', () => {
  test('boot() is called on every request', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ 'hook-tracking': HookTrackingComponent })

    const comp = boot(HookTrackingComponent, { $name: 'hook-tracking' })
    const snap = await dehydrate(comp, snapshot)
    // Give it a real ID so it's treated as subsequent
    snap.memo.id = 'EXISTING-ID'
    // Re-sign after mutating memo
    snap.checksum = snapshot.sign({ state: snap.state, memo: snap.memo })

    const payload = buildPayload(snap)
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.isTrue(response.components[0].snapshot.memo.id !== '')
  })

  test('mount() is called when snapshot has no id (initial render)', async ({ assert }) => {
    const { handler, snapshot, registry } = makeHandler()
    registry.register('hook-tracking', HookTrackingComponent)

    const comp = boot(HookTrackingComponent, { $name: 'hook-tracking', $id: '' })
    const snap = await dehydrate(comp, snapshot)
    // Simulate initial render — clear the id
    snap.memo.id = ''
    snap.checksum = snapshot.sign({ state: snap.state, memo: snap.memo })

    const payload = buildPayload(snap)
    const ctx = makeCtx()

    // Should not throw
    await assert.doesNotReject(() => handler.handle(payload, ctx))
  })

  test('dehydrate() is called at the end of every request', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'increment', params: [] }] })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    // count should be 1 in the new snapshot state
    assert.equal(response.components[0].snapshot.state.count, 1)
  })
})

test.group('WireRequestHandler — property updates', () => {
  test('applies a simple property update', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { updates: { count: 42 } })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.count, 42)
  })

  test('calls updating() and updated() hooks during property update', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ 'hook-tracking': HookTrackingComponent })

    const comp = boot(HookTrackingComponent, { $name: 'hook-tracking' })
    // Track what hooks captured — we check via the dehydrated state
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { updates: { count: 7 } })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    // count updated to 7 in the new snapshot
    assert.equal(response.components[0].snapshot.state.count, 7)
  })

  test('calls updatedPropertyName() shorthand after update', async ({ assert }) => {
    class ShorthandComp extends StubComponent {
      count = 0
      countWasUpdatedTo: number | null = null

      updatedCount(value: number) {
        this.countWasUpdatedTo = value
      }
    }

    const { handler, snapshot } = makeHandler({ shorthand: ShorthandComp })

    const comp = boot(ShorthandComp, { $name: 'shorthand' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { updates: { count: 55 } })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.countWasUpdatedTo, 55)
  })

  test('supports nested dot-path property updates (e.g. "items.0")', async ({ assert }) => {
    class NestedComp extends StubComponent {
      items = ['a', 'b', 'c']
    }

    const { handler, snapshot } = makeHandler({ nested: NestedComp })

    const comp = boot(NestedComp, { $name: 'nested' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { updates: { 'items.1': 'CHANGED' } })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    const items = response.components[0].snapshot.state.items as string[]
    assert.equal(items[1], 'CHANGED')
  })

  test('throws LockedPropertyException when a @Locked property is updated', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ locked: LockedComponent })

    const comp = boot(LockedComponent, { $name: 'locked' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { updates: { userId: 1337 } })
    const ctx = makeCtx()

    await assert.rejects(() => handler.handle(payload, ctx), LockedPropertyException)
  })

  test('allows updating non-locked properties when sibling is locked', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ locked: LockedComponent })

    const comp = boot(LockedComponent, { $name: 'locked' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { updates: { open: false } })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.open, false)
  })
})

test.group('WireRequestHandler — action dispatch', () => {
  test('calls a public action method', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'increment', params: [] }] })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.count, 1)
  })

  test('calls action with client-supplied params', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'addAmount', params: [10] }] })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.count, 10)
  })

  test('calls multiple actions in sequence', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [
        { method: 'increment', params: [] },
        { method: 'increment', params: [] },
        { method: 'decrement', params: [] },
      ],
    })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.count, 1)
  })

  test('throws MethodNotCallableException for a lifecycle hook called as action', async ({
    assert,
  }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'mount', params: [] }] })
    const ctx = makeCtx()

    await assert.rejects(() => handler.handle(payload, ctx), MethodNotCallableException)
  })

  test('throws MethodNotCallableException for underscore-prefixed method', async ({ assert }) => {
    class PrivateMethod extends StubComponent {
      _secret() {}
    }

    const { handler, snapshot } = makeHandler({ priv: PrivateMethod })

    const comp = boot(PrivateMethod, { $name: 'priv' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: '_secret', params: [] }] })
    const ctx = makeCtx()

    await assert.rejects(() => handler.handle(payload, ctx), MethodNotCallableException)
  })

  test('catches ValidationException from action and populates $errors', async ({ assert }) => {
    class ValidatingComp extends StubComponent {
      title = ''

      async save() {
        throw new ValidationException({ title: ['Title is required'] })
      }
    }

    const { handler, snapshot } = makeHandler({ validating: ValidatingComp })

    const comp = boot(ValidatingComp, { $name: 'validating' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'save', params: [] }] })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    // Errors are stored in the snapshot memo
    assert.deepEqual(response.components[0].snapshot.memo.errors, {
      title: ['Title is required'],
    })
  })
})

test.group('WireRequestHandler — @Renderless', () => {
  test('sets skipRender when method has @Renderless metadata', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ renderless: RenderlessComponent })

    const comp = boot(RenderlessComponent, { $name: 'renderless' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'logSomething', params: [] }] })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    // No html in effects means skipRender was respected
    assert.isUndefined(response.components[0].effects.html)
  })
})

test.group('WireRequestHandler — magic $ actions', () => {
  test('$set updates a property', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ magic: MagicActionComponent })

    const comp = boot(MagicActionComponent, { $name: 'magic' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [{ method: '$set', params: ['count', 99] }],
    })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.count, 99)
  })

  test('$toggle flips a boolean property', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ magic: MagicActionComponent })

    const comp = boot(MagicActionComponent, { $name: 'magic' })
    comp.flag = false
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [{ method: '$toggle', params: ['flag'] }],
    })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].snapshot.state.flag, true)
  })

  test('$refresh is a no-op but does not throw', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ magic: MagicActionComponent })

    const comp = boot(MagicActionComponent, { $name: 'magic' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [{ method: '$refresh', params: [] }],
    })
    const ctx = makeCtx()

    await assert.doesNotReject(() => handler.handle(payload, ctx))
  })

  test('$dispatch queues an effect dispatch', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ magic: MagicActionComponent })

    const comp = boot(MagicActionComponent, { $name: 'magic' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [{ method: '$dispatch', params: ['my-event', 'arg1'] }],
    })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.isArray(response.components[0].effects.dispatches)
    assert.equal(response.components[0].effects.dispatches![0].name, 'my-event')
  })

  test('$redirect sets redirect effect and skips render', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ magic: MagicActionComponent })

    const comp = boot(MagicActionComponent, { $name: 'magic' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [{ method: '$redirect', params: ['/dashboard'] }],
    })
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components[0].effects.redirect, '/dashboard')
    assert.isUndefined(response.components[0].effects.html)
  })
})

test.group('WireRequestHandler — error handling', () => {
  test('throws ChecksumException when snapshot is tampered', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    // Tamper with state
    ;(snap.state as any).count = 9999

    const payload = buildPayload(snap)
    const ctx = makeCtx()

    await assert.rejects(() => handler.handle(payload, ctx), ChecksumException)
  })

  test('component exception() hook can swallow errors', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ exception: ExceptionComponent })

    const comp = boot(ExceptionComponent, { $name: 'exception' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, {
      calls: [{ method: 'throwOnAction', params: [] }],
    })
    const ctx = makeCtx()

    // Should NOT throw because exception() calls stopPropagation()
    await assert.doesNotReject(() => handler.handle(payload, ctx))
  })

  test('re-throws when exception() hook does not call stopPropagation', async ({ assert }) => {
    class BubbleComp extends StubComponent {
      blowUp() {
        throw new Error('boom')
      }
    }

    const { handler, snapshot } = makeHandler({ bubble: BubbleComp })

    const comp = boot(BubbleComp, { $name: 'bubble' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap, { calls: [{ method: 'blowUp', params: [] }] })
    const ctx = makeCtx()

    await assert.rejects(() => handler.handle(payload, ctx))
  })

  test('handleRequest() returns 400 for missing payload', async ({ assert }) => {
    const { handler } = makeHandler()
    const ctx = makeCtx({ body: null })
    await handler.handleRequest(ctx)
    assert.equal((ctx.response as any)._status, 400)
  })

  test('handleRequest() returns 403 for tampered snapshot', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)
    ;(snap.state as any).count = 9999

    const ctx = makeCtx({
      body: buildPayload(snap),
    })

    await handler.handleRequest(ctx)
    assert.equal((ctx.response as any)._status, 403)
  })

  test('handleRequest() returns 200 for a valid request', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const ctx = makeCtx({ body: buildPayload(snap) })
    await handler.handleRequest(ctx)

    assert.equal((ctx.response as any)._status, 200)
  })
})

test.group('WireRequestHandler — batched components', () => {
  test('handles multiple components in a single request', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp1 = boot(CounterComponent, { $name: 'counter', $id: 'ID-1' })
    const comp2 = boot(CounterComponent, { $name: 'counter', $id: 'ID-2' })
    comp1.count = 0
    comp2.count = 10

    const snap1 = await dehydrate(comp1, snapshot)
    const snap2 = await dehydrate(comp2, snapshot)

    const payload: WireRequestPayload = {
      components: [
        { snapshot: snap1, calls: [{ method: 'increment', params: [] }], updates: {} },
        { snapshot: snap2, calls: [{ method: 'decrement', params: [] }], updates: {} },
      ],
    }

    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    assert.equal(response.components.length, 2)
    assert.equal(response.components[0].snapshot.state.count, 1)
    assert.equal(response.components[1].snapshot.state.count, 9)
  })

  test('a tampered component in a batch does not affect others', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp1 = boot(CounterComponent, { $name: 'counter', $id: 'ID-1' })
    const comp2 = boot(CounterComponent, { $name: 'counter', $id: 'ID-2' })

    const snap1 = await dehydrate(comp1, snapshot)
    const snap2 = await dehydrate(comp2, snapshot)

    // Tamper snap2
    ;(snap2.state as any).count = 9999

    const payload: WireRequestPayload = {
      components: [
        { snapshot: snap1, calls: [], updates: {} },
        { snapshot: snap2, calls: [], updates: {} },
      ],
    }

    const ctx = makeCtx()

    // The whole batch rejects because one snapshot is bad
    await assert.rejects(() => handler.handle(payload, ctx), ChecksumException)
  })
})

test.group('WireRequestHandler — response shape', () => {
  test('response always contains snapshot + effects per component', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap)
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    const result = response.components[0]
    assert.property(result, 'snapshot')
    assert.property(result, 'effects')
    assert.property(result.snapshot, 'state')
    assert.property(result.snapshot, 'memo')
    assert.property(result.snapshot, 'checksum')
  })

  test('new snapshot checksum is valid (can be verified)', async ({ assert }) => {
    const { handler, snapshot } = makeHandler({ counter: CounterComponent })

    const comp = boot(CounterComponent, { $name: 'counter' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap)
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    const newSnap = response.components[0].snapshot
    assert.doesNotThrow(() => snapshot.verify(newSnap))
  })

  test('effects.html is present when skipRender is false', async ({ assert }) => {
    class SimpleComp extends StubComponent {
      async render() {
        return '<div>hello</div>'
      }
    }

    const { handler, snapshot } = makeHandler({ simple: SimpleComp })

    const comp = boot(SimpleComp, { $name: 'simple' })
    const snap = await dehydrate(comp, snapshot)

    const payload = buildPayload(snap)
    const ctx = makeCtx()
    const response = await handler.handle(payload, ctx)

    const html = response.components[0].effects.html ?? ''
    assert.isTrue(
      html.includes('<div>hello</div>'),
      `effects.html should contain rendered output, got: ${html}`
    )
    assert.isTrue(
      html.includes('adowire:id='),
      'effects.html should be wrapped in the wire marker div'
    )
  })
})
