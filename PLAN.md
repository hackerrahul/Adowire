# Adowire — Full Build Plan

> A Livewire v4-equivalent reactive component system for AdonisJS v7 + Edge.js
> Modelled feature-for-feature after [Livewire v4](https://livewire.laravel.com/docs/quickstart)

---

## ⚙️ Agent / Terminal Bootstrap

Before running **any** `yarn`, `node`, or `tsc` command in this project, activate the correct Node version with:

```sh
source "/Users/apple/Library/Application Support/Herd/config/nvm/nvm.sh" && nvm use default
```

This sets Node to **v25.8.1** (required — `package.json` enforces `>=24.0.0`).

Full example:

```sh
source "/Users/apple/Library/Application Support/Herd/config/nvm/nvm.sh" && nvm use default && yarn quick:test
```

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Folder Structure](#3-folder-structure)
4. [How It Works (The Lifecycle)](#4-how-it-works-the-lifecycle)
5. [Feature Checklist](#5-feature-checklist)
6. [Build Phases](#6-build-phases)
7. [API Design (Developer-Facing)](#7-api-design-developer-facing)
8. [VineJS Validation Design](#8-vinejs-validation-design)
9. [Edge.js Template API](#9-edgejs-template-api)
10. [Client-Side Directives](#10-client-side-directives)
11. [TypeScript Decorators](#11-typescript-decorators)
12. [Security Model](#12-security-model)
13. [Testing Strategy](#13-testing-strategy)
14. [Ace Commands Reference](#14-ace-commands-reference)
15. [Package Publishing](#15-package-publishing)

---

## 1. Project Overview

**Adowire** is a full-stack reactive component library for [AdonisJS v7](https://adonisjs.com/) that brings the developer experience of [Livewire v4](https://livewire.laravel.com) to the Node.js ecosystem.

Instead of writing AJAX boilerplate or reaching for a frontend framework, developers write TypeScript classes + Edge.js templates. Adowire handles the network roundtrip, DOM morphing, state management, and event system automatically.

### Key Goals

| Goal                           | Description                                                           |
| ------------------------------ | --------------------------------------------------------------------- |
| **Zero-JS for developers**     | Write TypeScript + Edge templates. No manual fetch/axios.             |
| **Livewire v4 feature parity** | Every Livewire v4 feature has an adowire equivalent                   |
| **Edge.js native**             | First-class integration with AdonisJS Edge.js template engine         |
| **Alpine.js bridge**           | Full `$wire` object integration, same as Livewire                     |
| **TypeScript-first**           | Decorators, type-safe properties, full IDE support                    |
| **VineJS validation**          | Uses AdonisJS's own VineJS for all validation — no external validator |
| **AdonisJS v7 patterns**       | Providers, Ace commands, IoC container, config files                  |

### Tech Stack

| Layer            | Technology                                    |
| ---------------- | --------------------------------------------- |
| Server framework | AdonisJS v7                                   |
| Template engine  | Edge.js v6                                    |
| Validation       | **VineJS v4** (AdonisJS's official validator) |
| DOM morphing     | `morphdom`                                    |
| JS companion     | Alpine.js v3                                  |
| Build tool       | `tsdown` (Rolldown-based)                     |
| Test runner      | Japa v5                                       |
| TypeScript       | v5.9+                                         |

### Why VineJS?

VineJS is AdonisJS's official validation library — it is already a `peerDependency` of `@adonisjs/core`, so every AdonisJS app already has it available. Using it means:

- Zero extra dependencies for adowire consumers
- Native AdonisJS error formatting that matches the rest of the app
- Full access to VineJS custom rules, custom messages providers, and metadata API
- 5–10× faster than Zod/Yup
- Handles HTML form serialization quirks natively (strings cast to numbers/booleans, empty strings, etc.)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
│                                                     │
│  Edge HTML + wire:* attributes + Alpine $wire       │
│            │                    ▲                   │
│            │ POST /adowire/msg  │ JSON response     │
└────────────┼────────────────────┼───────────────────┘
             │                    │
┌────────────▼────────────────────┼───────────────────┐
│                 AdonisJS Server                     │
│                                                     │
│  WireRequestHandler                                 │
│    │                                                │
│    ├── SnapshotManager  (dehydrate / hydrate)       │
│    ├── ComponentRegistry (discover & resolve)       │
│    ├── WireComponent     (your TS class)            │
│    │     ├── mount / boot / hydrate / dehydrate     │
│    │     ├── updating / updated                     │
│    │     ├── rendering / rendered                   │
│    │     └── exception                              │
│    ├── WireValidator     (VineJS integration)       │
│    │     ├── @Validate decorator → vine schema      │
│    │     ├── validate() method                      │
│    │     ├── rules() method override                │
│    │     └── SimpleMessagesProvider support         │
│    └── Edge.js           (render template → HTML)  │
└─────────────────────────────────────────────────────┘
```

### Request Lifecycle (per AJAX call)

```
1.  Browser sends POST /adowire/message
    Body: { components: [{ snapshot, calls, updates }] }

2.  Server: verify HMAC checksum on snapshot

3.  Server: hydrate component from snapshot state

4.  Server: run boot() hook

5.  Server: run hydrate() hook

6.  Server: apply property updates (wire:model mutations)
    - for each update:
        - check property is not @Locked
        - run updating(name, value) hook
        - set property
        - run updated(name, value) hook
        - if @Validate(onUpdate: true) on property: run VineJS validation

7.  Server: call action methods
    - check method is public and callable ($isCallable guard)
    - resolve DI params from AdonisJS IoC container
    - call method
    - if @Renderless: set skipRender = true
    - catch ValidationException from VineJS → populate $errors

8.  Server: run dehydrate() hook

9.  Server: if !skipRender → render Edge template → HTML
    - inject morph markers around @if / @each blocks

10. Server: dehydrate new snapshot (HMAC sign)

11. Server: return JSON { components: [{ snapshot, effects }] }
    effects: { html, redirect, dispatches, js, streams, download, title }

12. Browser: morphdom(oldHtml, newHtml)

13. Browser: process effects
    (redirect, dispatch browser events, run JS actions, stream text chunks)
```

---

## 3. Folder Structure

```
adowire/
│
├── src/                              # Server-side TypeScript source
│   ├── component.ts                  # WireComponent base class
│   ├── component_registry.ts         # Auto-discover + register components
│   ├── snapshot.ts                   # Dehydrate / Hydrate state ↔ JSON
│   ├── morph_markers.ts              # Inject HTML comment markers for morphdom
│   ├── request_handler.ts            # POST /adowire/message endpoint
│   ├── form.ts                       # WireForm base class
│   ├── validator.ts                  # VineJS validation engine wrapper
│   ├── wire_exception.ts             # WireException, ValidationException
│   ├── synthesizers/                 # Custom type serializers
│   │   ├── synthesizer.ts            # Base Synthesizer interface
│   │   ├── date_synthesizer.ts       # Date / DateTime
│   │   ├── map_synthesizer.ts        # Map
│   │   └── set_synthesizer.ts        # Set
│   ├── decorators/                   # TypeScript property/method decorators
│   │   ├── index.ts                  # Re-export all decorators
│   │   ├── computed.ts               # @Computed
│   │   ├── locked.ts                 # @Locked
│   │   ├── validate.ts               # @Validate(schema, opts)
│   │   ├── url.ts                    # @Url
│   │   ├── on.ts                     # @On('event-name')
│   │   ├── reactive.ts               # @Reactive
│   │   ├── modelable.ts              # @Modelable
│   │   ├── lazy.ts                   # @Lazy
│   │   ├── session.ts                # @Session
│   │   ├── async.ts                  # @Async
│   │   ├── renderless.ts             # @Renderless
│   │   ├── defer.ts                  # @Defer
│   │   ├── isolate.ts                # @Isolate
│   │   ├── json.ts                   # @Json
│   │   ├── title.ts                  # @Title
│   │   └── layout.ts                 # @Layout
│   ├── concerns/                     # Mixins / Traits
│   │   ├── with_pagination.ts        # WithPagination mixin
│   │   └── with_file_uploads.ts      # WithFileUploads mixin
│   ├── edge/                         # Edge.js plugin
│   │   ├── plugin.ts                 # Registers all tags + globals
│   │   └── tags/
│   │       ├── wire_styles.ts        # @!wireStyles()
│   │       ├── wire_scripts.ts       # @!wireScripts()
│   │       ├── wire_component.ts     # @adowire('name', props)
│   │       ├── error.ts              # @error('field') / @enderror
│   │       ├── island.ts             # @island / @endisland
│   │       ├── placeholder.ts        # @placeholder / @endplaceholder
│   │       ├── persist.ts            # @persist / @endpersist
│   │       └── teleport.ts           # @teleport / @endteleport
│   ├── testing/
│   │   └── wire_test.ts              # Adowire.test() helper
│   └── types.ts                      # All shared TypeScript interfaces
│
├── client/                           # Browser-side TypeScript → wire.js
│   ├── index.ts                      # Adowire client bootstrap + global API
│   ├── component.ts                  # Client-side component class
│   ├── connection.ts                 # HTTP request pool + queue management
│   ├── morph.ts                      # morphdom integration
│   ├── store.ts                      # Client component state store
│   ├── alpine_bridge.ts              # $wire magic object for Alpine.js
│   └── directives/                   # wire:* attribute handlers
│       ├── index.ts                  # Register all directives
│       ├── model.ts                  # wire:model
│       ├── click.ts                  # wire:click
│       ├── submit.ts                 # wire:submit
│       ├── keydown.ts                # wire:keydown + key modifiers
│       ├── loading.ts                # wire:loading
│       ├── navigate.ts               # wire:navigate
│       ├── poll.ts                   # wire:poll
│       ├── intersect.ts              # wire:intersect
│       ├── confirm.ts                # wire:confirm
│       ├── transition.ts             # wire:transition
│       ├── init.ts                   # wire:init
│       ├── offline.ts                # wire:offline
│       ├── ignore.ts                 # wire:ignore
│       ├── replace.ts                # wire:replace
│       ├── show.ts                   # wire:show
│       ├── cloak.ts                  # wire:cloak
│       ├── dirty.ts                  # wire:dirty
│       ├── ref.ts                    # wire:ref
│       ├── sort.ts                   # wire:sort
│       ├── stream.ts                 # wire:stream
│       ├── text.ts                   # wire:text
│       ├── current.ts                # wire:current
│       └── bind.ts                   # wire:bind
│
├── providers/
│   └── wire_provider.ts              # AdonisJS ServiceProvider
│
├── commands/
│   ├── make_adowire.ts               # node ace make:adowire
│   └── make_adowire_form.ts          # node ace make:adowire:form
│
├── stubs/
│   ├── component.stub                # Component class stub
│   ├── component_view.stub           # Edge template stub
│   └── form.stub                     # Form class stub
│
├── configure.ts                      # node ace configure adowire
├── index.ts                          # Package main entry point
├── package.json
├── tsconfig.json
├── eslint.config.js
├── PLAN.md                           # This file
└── README.md
```

---

## 4. How It Works (The Lifecycle)

### Initial Page Load (GET)

```
1. AdonisJS route handler renders an Edge template
2. Developer uses @adowire('component-name', props) tag in the template
3. Adowire instantiates the component, calls mount(props), renders it
4. HTML is wrapped with wire:id="<ulid>" and wire:snapshot="<json>"
5. Full page HTML is sent to the browser
6. Browser: adowire.js boots, Alpine.js initialises
7. Each wire:id element becomes a live Alpine-backed component
8. wire:cloak elements become visible, wire:init actions fire
```

### Subsequent Updates (AJAX)

```
1. User interacts (click, input, submit, poll, intersect, etc.)
2. Client collects pending updates and calls into one request:
   { snapshot, calls: [{ method, params }], updates: { prop: value } }
3. POST /adowire/message
4. Server runs full lifecycle (see Architecture section)
5. Response: { snapshot, effects: { html, redirect, dispatches, js, streams } }
6. Client: morphdom(currentEl, newHtml)
7. Client: process effects sequentially
```

### Snapshot Format

```json
{
  "state": {
    "count": 1,
    "title": "Hello",
    "createdAt": ["2024-01-01T00:00:00.000Z", { "s": "date" }],
    "items": [["a", "b"], { "s": "set" }]
  },
  "memo": {
    "name": "counter",
    "id": "01HXYZ1234567890ABCDEF",
    "children": {},
    "errors": {},
    "locale": "en",
    "path": "/counter",
    "method": "GET"
  },
  "checksum": "hmac-sha256-hex-signature"
}
```

---

## 5. Feature Checklist

### 🏗️ Core Engine

- [x] `WireComponent` base class
  - [x] `mount(props)` lifecycle hook — first request only
  - [x] `boot()` lifecycle hook — every request
  - [x] `hydrate()` lifecycle hook — subsequent requests only
  - [x] `dehydrate()` lifecycle hook — end of every request
  - [x] `updating(name, value)` hook — before property set
  - [x] `updated(name, value)` hook — after property set
  - [x] `updatedPropertyName(value)` shorthand hooks
  - [x] `updatingPropertyName(value)` shorthand hooks
  - [x] `updatedPropertyName(value, key)` for array properties
  - [x] `rendering(view, data)` hook — before render
  - [x] `rendered(view, html)` hook — after render
  - [x] `exception(e, stopPropagation)` hook
  - [x] `fill(data)` — bulk assign properties
  - [x] `reset(...props)` — reset to initial state
  - [x] `pull(...props)` — reset and retrieve value
  - [x] `only(...props)` — return subset of state
  - [x] `all()` — return all public state as object
  - [x] `$getPublicState()` — internal state collector
  - [x] `$isCallable(method)` — security guard; **improved**: lifecycle hooks always blocked; base-class utilities (`reset`, `fill`, `pull`, etc.) only blocked when inherited from `WireComponent` — if the concrete subclass defines a method with the same name it is treated as a user action and allowed
  - [x] Trait/mixin prefixed lifecycle hooks (`mountMyTrait()`, `bootMyTrait()`, etc.)

- [x] `SnapshotManager`
  - [x] `dehydrate(component)` → `WireSnapshot`
  - [x] `hydrate(component, snapshot)` → void
  - [x] HMAC-SHA256 checksum signing (using `APP_KEY`)
  - [x] Checksum verification (throw on tamper)
  - [x] Primitive type pass-through (string, number, boolean, null, array, plain object)
  - [x] Tuple format for complex types: `[data, { s: 'type' }]`
  - [x] Date synthesizer
  - [x] Map synthesizer
  - [x] Set synthesizer
  - [x] Custom `Synthesizer` interface (extensible by users)
  - [x] `Adowire.synthesizer(impl)` — register custom synthesizer

- [x] `ComponentRegistry`
  - [x] Auto-discover components from `app/adowire/` directory (recursive)
  - [x] Name resolution: file path → dot-notation name (`posts/create.ts` → `posts.create`)
  - [x] Namespace support (`pages::post.create`, `admin::users`)
  - [x] Manual registration: `Adowire.register(name, ComponentClass)`
  - [x] Component factory: `registry.make(name)` → new instance
  - [x] Namespace configuration in `config/adowire.ts`

- [x] `WireRequestHandler`
  - [x] Handle `POST /adowire/message`
  - [x] Support batched component updates (multiple components per request)
  - [x] Apply property updates with locked-property guard
  - [x] Call action methods with AdonisJS IoC container DI
  - [x] Run full lifecycle: boot → hydrate → update → action → dehydrate → render
  - [x] Catch VineJS `E_VALIDATION_ERROR` and populate `$errors`, re-render
  - [x] Catch `WireException` for component errors
  - [x] Return JSON response with effects

---

### 🎨 Components

- [x] Component class file: `app/adowire/counter.ts`
- [x] Component view file: `resources/views/adowire/counter.edge`
- [x] Page components with `@Layout` decorator
- [x] Props via `mount(props)` method
- [x] Auto-prop assignment — props whose keys match public property names are pre-assigned before `mount()` runs; works for both `@adowire()` tag embeds and `router.adowire()` page routes
- [x] `@Computed` decorator — memoized per-request computed values (`src/decorators/computed.ts`, hydration bug fixed: computed keys excluded from snapshot dehydration/hydration)
- [x] `render()` override — pass extra data to view
- [x] `$this.computedProp` access in Edge templates — computed values resolved fresh at render time and injected into template data
- [x] Component namespaces (`pages::`, `admin::`, custom)
- [x] `@adowire('component-name', { prop: value })` Edge tag
- [x] Dynamic components: `@adowire($dynamicName, props)` — component name is a plain JS expression; **fixed**: `adowireComponentTag.compile()` now runs the jsArg through `parser.utils.transformAst` so template-state identifiers (e.g. `activeTab`) are rewritten to `state.activeTab`; Edge.js v6 does NOT use `with(state)` — bare identifiers were undefined at runtime until this fix

**HTML-style component tag syntax** (`src/edge/adowire_html_processor.ts` — Edge.js `raw` preprocessor)

> **Bug fixed:** `registerAdowireTags()` was missing the `edge.processor.process('raw', adowireHtmlProcessor)` call in the compiled build (stale build — processor was added to source but package was never recompiled). All `<adowire:*>` tags rendered as empty until rebuilt.

- [x] `<adowire:counter />` — self-closing HTML tag; transforms to `@adowire('counter')\n@end` before Edge compilation
- [x] `<adowire:post.create />` — dot-notation names (maps to `post.create` component)
- [x] `<adowire:pages::dashboard />` — namespace syntax (maps to `pages::dashboard` component)
- [x] `<adowire:counter title="Hello" />` — static string props; `title="Hello"` → `title: 'Hello'`
- [x] `<adowire:counter :count="$count" />` — dynamic props; `:count="$count"` → `count: $count` (expression passed verbatim)
- [x] `<adowire:counter disabled />` — boolean props; `disabled` → `disabled: true`
- [x] `<adowire:counter initial-count="5" />` — kebab-case auto-converted to camelCase; `initial-count` → `initialCount`
- [x] `<adowire:dynamic-component :is="activeTab" />` — dynamic component via `:is`; the `:is` expression replaces the static tag name, stripped from props, and now correctly transformed through Edge.js AST rewriter (see dynamic component fix above)
- [x] Block form: `<adowire:counter title="Hi">...slot content...</adowire:counter>` — transforms to `@adowire('counter', { title: 'Hi' })\n...slot content...\n@end`; block tags expand iteratively so nested components of any depth work correctly
- [x] Fast-path: templates without `<adowire:` are skipped entirely (zero overhead)
- [x] Idempotent registration: `WeakSet` guard in `registerAdowireTags()` prevents the processor being registered twice when both direct `registerAdowireTags(edge)` and deferred `edge.use()` paths run
- [x] Debug `console.log` statements removed from `adowireHtmlProcessor` after confirming processor fires for file-based templates

- [ ] Recursive components
- [ ] Component slots — default slot via `{{{ await $slots.main() }}}`
- [ ] Named slots via `@adowire.slot('name')` / `$slots['name']`
- [ ] `$slots.has('name')` — check if slot provided
- [ ] `$attributes` — forward HTML attributes from parent
- [x] `adowire:key` — stable identity in loops
- [ ] Force re-render by changing `adowire:key`
- [ ] Child components are independent (skip re-render on parent update)

---

### 📋 Properties

- [x] Public class properties auto-synced between server ↔ client snapshot
- [x] Protected/private properties stay on server only (not in snapshot) — convention-based (`$`/`_` prefix filtering in `$getPublicState()`)
- [x] `fill(data)` — bulk assign from object/model
- [x] `reset('prop')` / `reset(['a','b'])` — reset to pre-mount value
- [x] `pull('prop')` / `pull(['a','b'])` — reset and return value
- [x] `only(['a','b'])` — subset of public state
- [x] `all()` — all public properties as plain object
- [x] Supported native types: `string`, `number`, `boolean`, `null`, `array`, `object`
- [x] `Date` auto-serialized via built-in synthesizer
- [ ] Custom `Wireable` interface — user-defined serializable types
- [x] `@Locked` — prevents client-side mutation (`src/decorators/locked.ts` fully implemented, runtime guard in request handler via `WIRE_LOCKED_KEY`)

---

### ✅ Validation (VineJS)

> Adowire uses **VineJS** (`@vinejs/vine`) as its sole validation engine.
> VineJS is already a dependency of AdonisJS — zero extra installs for consumers.

- [x] `@Validate(vine.string().minLength(3))` decorator — fully implemented in `src/decorators/validate.ts`; stores rule + options as reflect-metadata under `WIRE_VALIDATE_KEY`
- [x] `@Validate(vine.string().minLength(3), { message: 'Too short', as: 'title', onUpdate: false })` — all options (`message`, `as`, `onUpdate`) supported by decorator
- [ ] Multiple `@Validate` decorators on one property (stacked rules) — metadata is keyed by property name, so multiple decorators on the same property overwrite; stacking not supported
- [x] `onUpdate: false` — supported via `opts.onUpdate` in `@Validate`; `maybeValidateOnUpdate()` skips when `false`
- [x] `validate()` — fully implemented in `WireComponent`; reads `@Validate` rules via reflect-metadata, calls `WireValidator.validateProperties()`, populates `$errors`, throws `ValidationException` on failure
- [x] `validate({ title: vine.string().minLength(3) })` — inline schema override supported; explicit rules map passed to `validate(rules?)` takes priority over decorator rules
- [x] `validateUsing(compiledValidator)` — validate full component state against a pre-compiled `vine.compile(schema)` validator; coerced values written back to component properties; VineJS native errors caught and converted to `$errors`; typed return value
- [ ] `rules()` method — define full VineJS schema as object (not implemented)
- [ ] `messages()` method — custom error messages (not implemented)
- [ ] `validationAttributes()` method — custom field labels (not implemented)
- [x] Real-time validation on property update — `maybeValidateOnUpdate()` in request handler checks `@Validate` `onUpdate` flag
- [x] `addError(field, message)` — manually inject error
- [x] `resetValidation(field?)` — clear specific or all errors
- [ ] `getErrorBag()` — raw error bag access
- [ ] `withValidator(fn)` — hook into VineJS validator instance before validation runs
- [x] `@error('field')` / `@enderror` Edge tag — fully implemented as block tag with `{{ message }}` and `{{ messages }}`
- [ ] `@error('form.field')` — nested form object errors
- [ ] `$errors.has('field')` — client-side check (Alpine bridge does not expose `$errors`)
- [ ] `$errors.first('field')` — client-side first message
- [ ] `$errors.get('field')` — all messages for field
- [ ] `$errors.all()` — all errors flat object
- [ ] `$errors.clear('field?')` — clear errors client-side
- [ ] VineJS `E_VALIDATION_ERROR` caught by request handler — only internal `ValidationException` is caught, not VineJS's native error class

---

### 📝 Forms (WireForm)

> `src/concerns/` directory is empty — no `WireForm` base class or mixins exist yet.

- [ ] `WireForm` base class
  - [ ] `@Validate` decorators on form properties
  - [ ] `validate()` — run VineJS validation across form properties
  - [ ] `reset(...props)` — reset form fields
  - [ ] `pull(...props)` — pull and reset
  - [ ] `all()` — all form properties as object
  - [ ] `only([...props])` — subset of form properties
  - [ ] `setModel(model)` — fill form from a plain object/model
  - [ ] `updating(name, value)` / `updated(name, value)` hooks inside form
  - [ ] `updatedFieldName(value)` shorthand hooks inside form
- [ ] Form used as typed property on component: `public PostForm $form`
- [ ] `adowire:model="form.title"` — nested dot-notation binding
- [ ] `@error('form.title')` — nested error display
- [ ] `$this->form->validate()` — explicit form validation
- [ ] `node ace make:adowire:form PostForm` — scaffold form class

---

### 🔁 Lifecycle Hooks

- [x] `mount(props)` — first request only (like constructor)
- [x] `boot()` — every request, initial and subsequent
- [x] `hydrate()` — subsequent requests only (after boot)
- [x] `dehydrate()` — end of every request (before snapshot)
- [x] `updating(name, value)` — before any property is set from client
- [x] `updated(name, value)` — after property is set
- [x] `updatedPropertyName(value)` — targeted shorthand, e.g. `updatedTitle(val)`
- [x] `updatingPropertyName(value)` — targeted shorthand
- [x] `updatedPropertyName(value, arrayKey)` — for array element updates
- [x] `rendering(view, data)` — before Edge renders
- [x] `rendered(view, html)` — after Edge renders
- [x] `exception(error, stopPropagation)` — intercept any thrown error
- [x] Mixin/trait hooks: `mountHasPostForm()`, `bootHasPostForm()`, `dehydrateHasPostForm()`, etc.
- [ ] Form object `updating` / `updated` hooks run when form properties update (WireForm not implemented)

---

### ⚡ Actions

- [x] Public methods callable from template directives
- [x] Parameters from template: `wire:click="delete({{ id }})"` — client `click.ts` parses method + params
- [x] IoC DI: type-hinted non-primitive params resolved from AdonisJS container — `resolveMethodArgs()` in request handler
- [x] `$refresh` magic action — re-render without method call
- [x] `$set('prop', value)` magic action
- [x] `$toggle('prop')` magic action
- [x] `$dispatch('event', params)` magic action from template — handled in `callMagicAction()`
- [ ] `$parent.method(params)` — call parent method directly from child template (adowire:click="$parent.method()")
- [x] `skipRender()` — programmatic render skip
- [ ] `@Renderless` decorator — runtime consumer exists (`WIRE_RENDERLESS_KEY` checked in `callAction`), but decorator function missing
- [ ] `@Async` decorator — `$isAsync()` helper exists but request handler never checks it
- [ ] `wire:click.async` — inline async modifier (no modifier parsing in client)
- [ ] `wire:click.renderless` — inline renderless modifier
- [ ] `wire:click.preserve-scroll` — maintain scroll position
- [ ] `wire:confirm="Are you sure?"` — browser confirm dialog before action
- [ ] `wire:confirm.prompt="Type DELETE|DELETE"` — text prompt confirm
- [x] `$isCallable()` guard — blocks lifecycle hooks, `$`-prefixed, `_`-prefixed, and 20 hardcoded method names

---

### 📡 Events

- [x] `this.dispatch('event-name', { key: value })` — `$dispatch()` pushes to `$effects.dispatches`
- [ ] `this.dispatch('event').to(ComponentClass)` — chainable API not implemented (use `$dispatchTo` instead)
- [ ] `this.dispatch('event').self()` — chainable API not implemented (use `$dispatchSelf` instead)
- [x] `this.dispatchSelf('event', params)` — shorthand self
- [x] `this.dispatchTo('component-name', 'event', params)` — named target
- [ ] `@On('event-name')` decorator on action method (metadata key + `$getEventListeners()` consumer exist, decorator function missing)
- [ ] `@On('post-updated.{post.id}')` — dynamic event names using component state
- [x] `getListeners()` method — `$getEventListeners()` reads `WIRE_ON_KEY` metadata
- [ ] Child listener syntax in Edge: `@adowire('edit-post', {}, { '@saved': '$refresh' })`
- [ ] `$dispatch('event', params)` from Edge template (client-side, no request)
- [ ] `$dispatchTo('component', 'event', params)` from Edge template
- [ ] JS inside component: `this.$on('event', fn)`
- [ ] JS inside component: `this.$dispatch('event', data)`
- [ ] JS inside component: `this.$dispatchSelf('event')`
- [ ] Global JS: `Adowire.on('event', fn)` — returns cleanup function
- [x] Alpine: `x-on:event-name="..."` intercepts wire events — client emits `CustomEvent` on component element from `effects.dispatches`
- [x] Alpine: `x-on:event-name.window="..."` for global catch — `dispatch.self` flag emits on `window`

---

### 🧩 Nesting

- [x] `@adowire('component-name', { prop: value })` Edge tag
- [x] Props passed into child `mount(props)`
- [ ] Child components are independent — don't re-render on parent network request
- [ ] `adowire:key` on nested `@adowire` calls — required for stable identity in loops
- [ ] `@Reactive` decorator — prop re-syncs when parent updates (opt-in) (metadata key defined, no consumer or decorator)
- [ ] `@Modelable` decorator — expose child property for parent `adowire:model` (metadata key defined, no consumer or decorator)
- [ ] `adowire:model="childProp"` binding to `@Modelable` child property
- [ ] Slots: default slot `{{{ await $slots.main() }}}` — @adowire tag block body ignored in Phase 1
- [ ] Named slots: `@adowire.slot('actions')` / `$slots['actions']`
- [ ] `$slots.has('name')` conditional slot check
- [ ] `$attributes` — forwarded HTML attributes from parent tag
- [ ] `$parent.method()` from child template
- [ ] Dynamic: `@adowire($dynamicName, props)`
- [ ] Recursive nesting (with user-defined base case)
- [ ] Force re-render: change `adowire:key` value

---

### 🌊 Adowire Directives (HTML Attributes)

> **Note:** All directives use the `adowire:` prefix (not `wire:`). The rename from `wire:*` → `adowire:*`
> was applied across the entire codebase: Edge tags, client-side directive handlers, attribute names,
> and all example templates. The plan below uses the canonical `adowire:` prefix.

- [x] `adowire:model="prop"` — deferred binding (values read at form submit time via `serialiseFormUpdates()`)
- [x] `adowire:model.live="prop"` — real-time commit on every `input` event (client `directives/model.ts` with delegated listeners)
- [x] `adowire:model.live.blur="prop"` — sync on blur only (capture-phase `blur` listener)
- [x] `adowire:model.live.debounce.Xms="prop"` — debounced live (default 250ms, custom via `.Xms` modifier)
- [x] `adowire:model.live.throttle.Xms="prop"` — throttled live (leading+trailing edge strategy)
- [x] `adowire:click="method(param)"` — call action on click (full delegated handler with argument parsing)
- [ ] `adowire:click.async` — async modifier (no modifier parsing)
- [ ] `adowire:click.renderless` — renderless modifier
- [ ] `adowire:click.preserve-scroll` — preserve scroll
- [x] `adowire:submit="method"` — intercept form submit (full delegated handler, serialises `adowire:model` fields)
- [ ] `adowire:keydown="method"` — on keydown event
- [ ] `adowire:keydown.enter="method"` — specific key
- [ ] `adowire:keydown.shift.enter="method"` — key combination
- [ ] Key modifiers: `.enter`, `.tab`, `.escape`, `.space`, `.up`, `.down`, `.left`, `.right`, `.shift`, `.ctrl`, `.cmd`, `.meta`, `.alt`, `.caps-lock`, `.equal`, `.period`, `.slash`
- [ ] Event modifiers: `.prevent`, `.stop`, `.window`, `.document`, `.once`, `.self`, `.outside`, `.camel`, `.dot`, `.passive`, `.capture`
- [ ] Debounce/throttle on any event: `.debounce.Xms`, `.throttle.Xms`
- [x] `adowire:loading` — show element while any request in-flight (client `directives/loading.ts`)
- [x] `adowire:loading.class="class-name"` — add class while loading
- [x] `adowire:loading.class.remove="class-name"` — remove class while loading
- [x] `adowire:loading.attr="disabled"` — set attribute while loading
- [x] `adowire:loading.attr.remove="attr"` — remove attribute while loading
- [ ] `adowire:loading.delay` — delay before loading indicator shows
- [ ] `adowire:loading.delay.Xms` — custom delay
- [ ] `adowire:target="method"` — scope loading to specific action
- [ ] `adowire:target="propName"` — scope loading to property update
- [ ] `data-loading` attribute auto-set on component root during requests
- [ ] `adowire:navigate` on `<a>` — SPA navigation (no full reload)
- [ ] `adowire:navigate.hover` — prefetch page on hover
- [ ] `adowire:current` — add `aria-current="page"` to active links
- [x] `adowire:cloak` — hide until component boots (display:none removed post-boot) — server-side CSS via `@adowireStyles()`, client `directives/cloak.ts` with `uncloakComponent()`
- [x] `adowire:dirty` — show element when local state differs from server (client `directives/dirty.ts` with per-property tracking via `adowire:target`)
- [x] `adowire:dirty.class="class"` — add class when dirty
- [x] `adowire:dirty.class.remove="class"` — remove class when dirty
- [ ] `adowire:confirm="message"` — browser confirm() before action
- [ ] `adowire:confirm.prompt="label|expected"` — input prompt confirm
- [ ] `adowire:transition` — apply CSS transition on morph
- [ ] `adowire:transition.in.duration.Xms` / `adowire:transition.out.duration.Xms`
- [ ] `adowire:init="method"` — call action when component first boots on client
- [ ] `adowire:intersect="method"` — IntersectionObserver trigger
- [ ] `adowire:intersect.once` — fire only once
- [ ] `adowire:intersect.enter="method"` — on enter viewport
- [ ] `adowire:intersect.leave="method"` — on leave viewport
- [x] `adowire:poll` — auto `$refresh` every 2s (default) (client `directives/poll.ts` with visibility pause)
- [x] `adowire:poll.Xs` — custom interval
- [x] `adowire:poll.visible` — only poll when element is visible on screen
- [ ] `adowire:poll.keep-alive` — poll even when browser tab is hidden
- [ ] `adowire:offline` — show element when browser goes offline
- [x] `adowire:ignore` — never morph this element (preserve DOM subtree) — handled in `morph.ts`
- [ ] `adowire:ignore.self` — morph children but not the root element (not distinguished from `adowire:ignore`)
- [ ] `adowire:ref="name"` — expose element via `$wire.$refs.name`
- [ ] `adowire:replace` — replace children instead of morphing
- [x] `adowire:show="jsExpression"` — toggle visibility via CSS (no morph) — client `directives/show.ts` with `initShow()` + `applyShowState()`; uses `adowire:cloak` to prevent FOUC
- [ ] `adowire:sort` — drag-and-drop list sorting
- [ ] `adowire:sort.item` — mark sortable item
- [ ] `adowire:sort.handle` — drag handle within sortable item
- [x] `adowire:stream="name"` — real-time SSE streaming target element (server pushes chunks via `text/event-stream`, client appends in real-time)
- [x] `adowire:stream.replace` — replace mode (vs default append mode)
- [ ] `adowire:text="jsExpression"` — reactive text node (updates without morph)
- [ ] `adowire:bind:attr="jsExpression"` — reactive attribute binding

---

### 🏷️ TypeScript Decorators

> All 16 metadata keys and option interfaces are defined in `src/types.ts`.
> `src/decorators/` contains `@Computed`, `@Locked`, `@Validate`, `@Title`, and `@Layout` (all fully working).
> 9 of 16 decorators have runtime consumers in `component.ts` / `request_handler.ts` (Tier 1).
> 7 only have the metadata key defined (Tier 2).

- [x] `@Computed()` — method becomes a memoized computed property (Tier 1: decorator in `src/decorators/computed.ts`, runtime consumer in `$getPublicState`, `$resolveComputed`, hydration exclusion in `snapshot.ts`)
- [x] `@Locked()` — property cannot be updated from client (Tier 1: decorator in `src/decorators/locked.ts`, runtime guard in `applyUpdates` with `LockedPropertyException`)
- [x] `@Validate(vineSchema, opts?)` — VineJS schema applied to property (Tier 1: decorator in `src/decorators/validate.ts`, runtime in `maybeValidateOnUpdate`, engine in `src/validator.ts`)
- [x] `@Validate(vine.string().email(), { message: 'Bad email', as: 'email address', onUpdate: false })` — with options (message override, display label, onUpdate toggle)
- [ ] `@Url(opts?)` — sync property to URL query parameter (Tier 2: key only)
- [ ] `@Url({ as: 'q', history: 'push', except: '' })` — with options
- [ ] `@On('event-name')` — listen for dispatched event (Tier 1: runtime in `$getEventListeners`)
- [ ] `@On('post-updated.{post.id}')` — dynamic event name
- [ ] `@Reactive()` — prop is reactive from parent (Tier 2: key only)
- [ ] `@Modelable()` — expose property for parent `wire:model` (Tier 2: key only)
- [ ] `@Lazy(opts?)` — defer component initial render (Tier 2: key only)
- [ ] `@Session(opts?)` — persist property value in AdonisJS session (Tier 2: key only)
- [ ] `@Session({ key: 'custom_session_key' })`
- [ ] `@Async()` — action is fire-and-forget (Tier 1: `$isAsync()` helper exists but handler doesn't use it)
- [ ] `@Renderless()` — action skips template re-render (Tier 1: runtime in `callAction`)
- [ ] `@Defer()` — property update batched until next action call (Tier 2: key only)
- [ ] `@Isolate()` — action prevents event dispatches from bubbling up (Tier 2: key only)
- [ ] `@Json()` — action returns JSON directly to JS (Tier 1: `$isJson()` helper exists)
- [x] `@Title('Page Title')` — set browser `<title>` for page components (Tier 1: `$getTitle()` exists)
- [x] `@Layout('layouts/adowire')` — wrap page component output in layout (Tier 1: `$getLayout()` exists)
- [x] `@Layout('layouts/adowire', { slot: 'main' })` — custom slot name
---

### 🏝️ Islands

- [ ] `@island` / `@endisland` — marks a region for independent re-rendering
- [ ] `@island(name: 'stats')` — named island
- [ ] `@island(lazy: true)` — defer island render until after page load
- [ ] `@island(defer: true)` — render via explicit `wire:init` trigger
- [ ] `@placeholder` / `@endplaceholder` — shown while lazy island loads
- [ ] Islands share parent component state and methods
- [ ] Multiple named islands per component
- [ ] Islands re-render independently; parent render skips them

---

### 🦥 Lazy Loading

- [ ] `@Lazy` class decorator — defer component's initial render
- [ ] Server renders `@placeholder` content on initial load
- [ ] Component sends `wire:init` AJAX call after page loads
- [ ] `@island(lazy: true)` for island-level deferred render
- [ ] Progress / skeleton UI via `@placeholder`

---

### ⏳ Loading States

- [x] `adowire:loading` — show element while any request in-flight (client `directives/loading.ts`)
- [x] `adowire:loading.class` / `.class.remove` — class toggling
- [x] `adowire:loading.attr` / `.attr.remove` — attribute toggling
- [ ] `adowire:loading.remove` — hide element while loading (inverse of show)
- [ ] `adowire:loading.delay` / `adowire:loading.delay.Xms` — delay before indicator
- [ ] `adowire:target="actionName"` — scope to specific action
- [ ] `adowire:target="propName"` — scope to property update
- [ ] `data-loading` auto-attribute on component root during in-flight requests
- [ ] Tailwind variant support: `data-loading:opacity-50`, `not-data-loading:hidden`
- [ ] Auto-disable all `<input>` and `<button>` inside `adowire:submit` forms during request

---

### 📎 File Uploads

- [ ] `WithFileUploads` mixin applied to component
- [ ] `adowire:model="photo"` on `<input type="file">`
- [ ] `TemporaryUploadedFile` class with `.store(path)`, `.move(path)`, `.getSize()`, `.getMime()`
- [ ] VineJS validation: `@Validate(vine.file().maxSize(2 * 1024 * 1024).extnames(['jpg','png']))`
- [ ] Multiple file uploads: `wire:model="photos"` with `vine.file().array()`
- [ ] Upload progress events via `wire:loading` integration
- [ ] Client-side preview: `$wire.photo.temporaryUrl()`
- [ ] Temporary files cleaned up after request

---

### 📖 Pagination

- [ ] `WithPagination` mixin applied to component
- [ ] `this.page` property auto-managed
- [ ] `this.previousPage()` / `this.nextPage()` methods
- [ ] `this.gotoPage(n)` method
- [ ] `this.resetPage()` method
- [ ] `@Url` auto-applied to `page` property (page in URL)
- [ ] `@adowire/paginate` Edge tag for rendering pagination links

---

### 🔗 URL Query Parameters

- [ ] `@Url` decorator — syncs property to URL query string
- [ ] `@Url({ as: 'q' })` — custom query param name
- [ ] `@Url({ history: 'push' })` — push vs replace history entry
- [ ] `@Url({ except: '' })` — omit default value from URL
- [ ] Multiple `@Url` properties per component
- [ ] Changing URL param triggers component hydrate + update
- [ ] Back/forward browser navigation triggers component update

---

### 🧭 Navigate (SPA Mode)

- [ ] `adowire:navigate` on `<a>` — intercept click, fetch next page, morph full page DOM
- [ ] `adowire:navigate.hover` — prefetch page HTML on hover
- [ ] Browser `pushState` history management
- [ ] Scroll-to-top on navigation (configurable)
- [ ] `adowire:current` — auto-sets `aria-current="page"` on matching links
- [ ] `@persist('key')` / `@endpersist` — preserve DOM elements across navigations (audio players, etc.)
- [ ] Navigation lifecycle browser events:
  - `adowire:navigate` — before navigation starts
  - `adowire:navigated` — after DOM morph completes
- [ ] Back/forward button support via `popstate` listener
- [ ] Page scripts re-evaluated on navigate

---

### 🖥️ Teleport

- [ ] `@teleport('#target')` / `@endteleport` — render content into a different DOM node
- [ ] Useful for modals, toasts, drawers rendered into `<body>` or `#app`
- [ ] Multiple teleport targets per component

---

### 🌐 Alpine.js Bridge (`$wire`)

> The Alpine.js `$wire` magic is available inside any `x-data` scope that is a descendant of an
> `[adowire:id]` element. It proxies reads/writes to the component's snapshot state and method calls
> to `commit()`.

- [x] `$wire.property` — read component property value (Proxy `get` trap reads `snapshot.state[prop]`)
- [x] `$wire.property = value` — set property (Proxy `set` trap calls `comp.commit([], { [prop]: value })`)
- [x] `await $wire.method(params)` — call action, returns Promise (unknown state keys return `(...params) => comp.commit(...)`)
- [x] `$wire.set('prop', value)` — forwarded to `comp.$set` via `COMPONENT_METHODS`
- [ ] `$wire.set('prop', value, false)` — set without network request (third arg not handled)
- [ ] `$wire.get('prop')` — not explicitly implemented (can use `$wire.prop` instead)
- [x] `$wire.$refresh()` — forwarded to `comp.$refresh` via `COMPONENT_METHODS`
- [ ] `$wire.$toggle('prop')` — not in `COMPONENT_METHODS`, falls through to server call
- [ ] `$wire.$dispatch('event', params)` — not in `COMPONENT_METHODS`, falls through to server call
- [ ] `$wire.$errors` — not implemented (should read from `snapshot.memo.errors`)
- [ ] `$wire.$errors.has('field')`
- [ ] `$wire.$errors.first('field')`
- [ ] `$wire.$errors.get('field')` — all messages for field
- [ ] `$wire.$errors.all()`
- [ ] `$wire.$errors.clear('field?')`
- [ ] `$wire.$refs.name` — access `adowire:ref` elements
- [ ] `$wire.$js.actionName()` — call JavaScript actions defined in `<script>`
- [ ] `$wire.$upload('prop', file, onProgress, onError, onFinish)` — programmatic upload

---

### 🧪 Testing

> No test wrapper/harness exists yet. Unit tests in `tests/` exercise internals directly via Japa.

- [ ] `Adowire.test(ComponentClass)` — creates test wrapper
- [ ] `.mount({ prop: value })` — set mount props
- [ ] `.set('prop', value)` — set component property
- [ ] `.call('method', ...params)` — call action method
- [ ] `.dispatch('event-name', params)` — dispatch event to component
- [ ] `.assertSee('text')` — assert text present in rendered HTML
- [ ] `.assertDontSee('text')` — assert text not present
- [ ] `.assertSet('prop', value)` — assert property equals value
- [ ] `.assertNotSet('prop', value)` — assert property does not equal value
- [ ] `.assertHasErrors('field')` — assert validation error exists
- [ ] `.assertHasErrors({ field: [vineRule] })` — assert specific rule failed
- [ ] `.assertNoErrors()` — assert no validation errors
- [ ] `.assertDispatched('event-name')` — assert event was dispatched
- [ ] `.assertDispatched('event-name', params)` — with specific params
- [ ] `.assertNotDispatched('event-name')` — assert event was not dispatched
- [ ] `.assertRedirect('/url')` — assert redirect effect
- [ ] `.assertStatus(200)` — assert HTTP status of last response

---

### 🔧 AdonisJS Integration

- [x] `WireProvider` — AdonisJS Service Provider
  - [x] Register `POST /adowire/message` route (before user routes)
  - [x] Register `GET /adowire/adowire.js` static asset route
  - [ ] Register `GET /adowire/adowire.js.map` source map route
  - [x] Register Edge.js plugin (tags + globals) — `registerAdowireTags(edge)` + `edge.global('$adowire', ...)`
  - [x] Bind `Adowire` singleton to IoC container — `container.singleton(ADOWIRE_BINDING, ...)`
  - [x] Auto-discover components from configured path on boot — `registry.discover(appRootPath)`
  - [x] `router.adowire(path, componentName)` — page-component routing (Livewire-style direct route → component)
- [ ] `configure.ts` — `node ace configure adowire` (stub only — empty function body)
  - [ ] Publish `config/adowire.ts`
  - [ ] Register `WireProvider` in `adonisrc.ts`
  - [ ] Create `app/adowire/` directory
  - [ ] Create `resources/views/adowire/` directory
  - [ ] Create default layout stub at `resources/views/layouts/adowire.edge`
  - [ ] Show next-steps instructions in terminal
- [x] `config/adowire.ts` — config reading works (test app has config file)
  - [x] `prefix: '/adowire'` — URL prefix
  - [x] `componentsPath: 'app/adowire'` — component scan directory
  - [x] `viewPrefix: 'adowire'` — Edge view prefix
  - [x] `secret: env('APP_KEY')` — HMAC secret (handles AdonisJS Secret wrapper)
  - [x] `injectMorphMarkers: true` — config key accepted (but morph markers not yet injected)
  - [ ] `maxUploadSize: 12 * 1024 * 1024` — file upload limit (config key exists in types, no upload implementation)
  - [ ] `navigate.enabled: true` — enable SPA navigation (not implemented)
  - [ ] `navigate.prefetch: true` — prefetch on hover (not implemented)

---

### 🪄 Ace Commands

> 7 commands implemented. All stubs created. `commands/` directory fully wired into the Ace loader.

- [x] `node ace make:adowire counter` — scaffold `app/adowire/counter.ts` + `resources/views/adowire/counter.edge`
- [x] `node ace make:adowire posts/create` — nested: `app/adowire/posts/create.ts` + view
- [x] `node ace make:adowire pages/dashboard --page` — page component with `@Layout` and `@Title` decorators
- [ ] `node ace make:adowire:form PostForm` — scaffold `app/adowire/forms/post_form.ts` _(deferred — WireForm not yet implemented)_
- [x] `node ace adowire:list` — list all registered components with their names, view, and class path
- [x] `node ace adowire:layout` — scaffold default layout template
- [x] `node ace adowire:move <from> <to>` — rename/move component class + view, updates class name
- [x] `node ace adowire:delete <name>` — delete component class + view with confirmation prompt
- [x] `node ace adowire:stubs` — publish stubs to `stubs/vendor/adowire/` for user customization
- [x] `configure.ts` — full configure hook (publishes config, registers provider + commands in `adonisrc.ts`, creates scaffold dirs)
- [x] `stubs/make/component.stub` — basic WireComponent class
- [x] `stubs/make/page.stub` — page component with `@Layout` + `@Title`
- [x] `stubs/make/view.stub` — Edge.js template
- [x] `stubs/make/layout.stub` — default Adowire layout (written directly to avoid tempura/Edge conflict)
- [x] `stubs/config/adowire.stub` — `config/adowire.ts` published by configure hook
- [x] `commands/main.ts` — Ace loader (`getMetaData` / `getCommand`)
- [x] `commands/commands.json` — command metadata manifest
- [x] `package.json` — `./commands` subpath export + `stubs/main.ts` and `commands/main.ts` tsdown entries

#### Command Reference Table

| Command | Aliases | Flags | Description |
| ------- | ------- | ----- | ----------- |
| `make:adowire <name>` | — | `--page`/`-p`, `--class`/`-c`, `--view`/`-v` | Scaffold component class + view (default: both) |
| `adowire:list` | — | `--json`/`-j` | List all registered components in a table or as JSON |
| `adowire:layout` | — | `--name`/`-n`, `--force`/`-f` | Create `resources/views/layouts/adowire.edge` layout |
| `adowire:move <from> <to>` | — | — | Move/rename component class + view, updates class name |
| `adowire:delete <name>` | — | `--force`/`-f` | Delete component class + view (prompts unless `--force`) |
| `adowire:stubs` | — | `--force`/`-f` | Publish stubs to `stubs/vendor/adowire/` for customisation |
| `node ace configure adowire` | — | — | Publish config, register provider + commands in `adonisrc.ts` |

---

### 🔒 Security

- [x] HMAC-SHA256 snapshot checksum — `createHmac('sha256', secret)` in `snapshot.ts`, `timingSafeEqual` verification
- [x] `@Locked` properties — decorator in `src/decorators/locked.ts` fully implemented; runtime guard in `applyUpdates` throws `LockedPropertyException`
- [x] `$isCallable()` guard — blocks lifecycle hooks, `$`-prefixed, `_`-prefixed, and `ReservedMethodNames` set (20 names including `reset`, `fill`, `validate`, etc.)
- [x] `MethodNotCallableException` with clear error message when client attempts to call reserved/private methods
- [ ] Action parameters treated as untrusted user input — documentation/guidance only
- [x] CSRF protection — AdonisJS CSRF middleware; token injected via `@adowireScripts` meta tag, sent as `X-CSRF-TOKEN` header
- [x] Protected/private class members never included in snapshot — `$getPublicState()` filters `$`/`_` prefixed keys
- [ ] CSP nonce support for inline scripts injected by `@!adowireScripts()`

---

### 🧬 DOM Morphing

- [x] `morphdom` integration — surgical DOM diffing and patching (`morph.ts` wraps morphdom)
- [x] `adowire:key` attribute used as morph key for stable element identity (`getNodeKey` callback in `morph.ts`)
- [ ] Alpine.js state preserved during morph (no `__x_dataStack` / `_x_dataStack` preservation logic)
- [x] `adowire:ignore` — skip morphing subtree entirely (`onBeforeElUpdated` + `onBeforeNodeDiscarded`)
- [ ] `adowire:ignore.self` — morph children but not root element (not distinguished from `adowire:ignore`)
- [ ] `adowire:replace` — replace children wholesale instead of morphing
- [ ] Server-side morph marker injection around `@if` / `@each` Edge blocks:
  ```html
  <!--[if BLOCK]> <![endif]-->
  ...conditional content...
  <!--[if ENDBLOCK]> <![endif]-->
  ```
- [ ] Look-ahead algorithm in morphdom config — detects insertions vs replacements
- [ ] `injectMorphMarkers: false` config option to disable markers (config key accepted but no injection code)

---

### 🌍 Global JavaScript API

- [x] `Adowire.init()` — boot all components found on the page (called automatically on `DOMContentLoaded`)
- [ ] `Adowire.on('event', fn)` — global Livewire-style event listener, returns cleanup()
- [x] `Adowire.find(id)` — find component instance by `adowire:id` attribute value
- [ ] `Adowire.getByName('counter')` — find first component by registered name
- [ ] `Adowire.all()` — array of all active component instances on the page (`components` Map exists but no `.all()` helper)
- [ ] `Adowire.navigate(url)` — programmatic SPA navigation
- [ ] `Adowire.hook('request', fn)` — intercept all requests
- [ ] `Adowire.hook('response', fn)` — intercept all responses
- [ ] Browser events dispatched on `document`:
  - `adowire:init` — after all components boot
  - `adowire:request` — before each AJAX request
  - `adowire:response` — after each AJAX response
  - `adowire:error` — on AJAX or server error
  - `adowire:morph` — before morphdom runs
  - `adowire:morphed` — after morphdom completes
  - `adowire:navigate` — before SPA navigation
  - `adowire:navigated` — after SPA navigation DOM update

---

## 6. Build Phases

### Phase 1 — Core Engine 🏗️

> Goal: A counter with `wire:click="increment"` works end-to-end.

- [x] `src/types.ts`
- [x] `src/component.ts` — WireComponent base class with all lifecycle hooks
- [x] `src/snapshot.ts` — SnapshotManager (dehydrate/hydrate + HMAC)
- [x] `src/component_registry.ts`
- [x] `src/request_handler.ts`
- [x] `providers/wire_provider.ts`
- [x] `src/edge/plugin.ts`
- [x] `src/edge/tags/adowire_scripts.ts`
- [x] `src/edge/tags/adowire_styles.ts`
- [x] `src/edge/tags/adowire_component.ts`
- [x] `client/index.ts`
- [x] `client/connection.ts`
- [x] `client/morph.ts`
- [x] `client/alpine_bridge.ts`
- [x] `client/directives/click.ts`
- [x] `client/directives/submit.ts`

**Milestone:** Counter increments without page reload. ✅

---

### Phase 2 — Properties & Model 📋

> Goal: A todos list with `wire:model` live updates works.

- [x] `client/directives/model.ts` — deferred binding (submit-time serialisation)
- [x] `client/directives/loading.ts` — show/hide, class, attr toggling while in-flight
- [x] `client/directives/cloak.ts`
- [x] `client/directives/dirty.ts`
- [x] `src/decorators/locked.ts`
- [x] `src/decorators/computed.ts`
- [x] `fill()`, `reset()`, `pull()`, `only()`, `all()` on WireComponent

**Milestone:** Model-submit form with deferred binding works. Model live modifiers (live, blur, debounce, throttle) implemented. Loading states work. Bulk state helpers implemented. Cloak, dirty, @Locked, @Computed decorators implemented. ✅

---

### Phase 3 — Validation (VineJS) ✅

> Goal: Create-post form with real-time validation and `@error` display works.

- [x] `src/validator.ts` — `WireValidator` class with `validateProperty()` and `validateProperties()`, lazy dynamic VineJS import
- [x] `src/wire_exception.ts` — `ValidationException`, `LockedPropertyException`, `MethodNotCallableException`, `RenderException`
- [x] `src/decorators/validate.ts` — `@Validate(rule, opts?)` with `message`, `as`, `onUpdate` options
- [x] `src/edge/tags/error.ts` — `@error('field')` / `@enderror` block tag exposing `message` and `messages`
- [x] `validate()`, `addError()`, `resetValidation()` on component — `validate()` uses `WireValidator`, clears passing props, throws `ValidationException` on failure
- [x] `validateUsing(compiledValidator)` on component — runs a pre-compiled `vine.compile(schema)` validator against full public state; assigns coerced values back to properties; catches native VineJS errors and converts to `ValidationException`
- [ ] `withValidator()` on component — programmatic validator attachment (not yet implemented)
- [ ] `$errors` client-side object (has, first, get, all, clear) — client-side structured error API not yet built
- [x] VineJS `E_VALIDATION_ERROR` caught → errors in response → re-render (request handler `maybeValidateOnUpdate` runs per-property validation on update)

**Milestone:** Form with `@Validate(vine.string().minLength(3))`, real-time errors, `@error` tags. ✅

---

### Phase 4 — Forms 📝

> Goal: Reusable WireForm objects, used across create + edit pages.

- [ ] `src/form.ts`
- [ ] Form as typed property: `public PostForm $form`
- [ ] `wire:model="form.title"` nested binding
- [ ] `@error('form.field')` nested errors
- [ ] `node ace make:adowire:form PostForm`

**Milestone:** PostForm reusable across CreatePost and EditPost. ✅

---

### Phase 5 — Events & Nesting 📡🧩

> Goal: Parent/child communication, `@On`, `@Reactive`, slots all work.

- [ ] `dispatch()` and all variants
- [ ] `src/decorators/on.ts`
- [ ] `src/edge/tags/wire_component.ts` (fully working with children)
- [ ] Child independent re-render logic
- [ ] `src/decorators/reactive.ts`
- [ ] `src/decorators/modelable.ts`
- [ ] Slots (default + named)
- [ ] `$attributes` forwarding
- [ ] `$parent.method()` template support

**Milestone:** Todos parent + TodoItem child with `$parent`, events, reactive count. ✅

---

### Phase 6 — Decorators & Directives 🏷️

> Goal: Full directive set, URL sync, polling, intersection, session, etc.

- [ ] `src/decorators/url.ts`
- [ ] `src/decorators/session.ts`
- [ ] `src/decorators/async.ts`
- [ ] `src/decorators/renderless.ts`
- [ ] `src/decorators/defer.ts`
- [ ] `src/decorators/isolate.ts`
- [ ] `src/decorators/json.ts`
- [x] `src/decorators/title.ts`
- [x] `src/decorators/layout.ts`
- [x] `client/directives/poll.ts` — interval + visibility pause
- [ ] `client/directives/intersect.ts`
- [ ] `client/directives/confirm.ts`
- [ ] `client/directives/init.ts`
- [ ] `client/directives/offline.ts`
- [ ] `client/directives/ref.ts`
- [x] `client/directives/ignore.ts` — handled via `morph.ts` callback
- [ ] `client/directives/replace.ts`
- [x] `client/directives/show.ts` — `initShow()` + `applyShowState()` with expression evaluation against snapshot
- [ ] `client/directives/text.ts`
- [ ] `client/directives/current.ts`
- [ ] `client/directives/transition.ts`
- [ ] `client/directives/bind.ts`

**Milestone (partial):** @Title, @Layout, poll, ignore directives working. Remaining decorators & directives pending.

---

### Phase 7 — Islands & Lazy 🏝️🦥

- [ ] `src/edge/tags/island.ts`
- [ ] `src/edge/tags/placeholder.ts`
- [ ] Island independent re-rendering
- [ ] `src/decorators/lazy.ts`

**Milestone:** Islands and lazy-loaded components work. ✅

---

### Phase 8 — Navigate & Teleport 🧭🖥️

- [ ] `client/directives/navigate.ts`
- [ ] SPA page morphing + history management
- [ ] `wire:navigate.hover` prefetch
- [ ] `src/edge/tags/persist.ts`
- [ ] `src/edge/tags/teleport.ts`
- [ ] Navigation browser events

**Milestone:** Full app SPA navigation with back/forward, persisted elements. ✅

---

### Phase 9 — File Uploads & Pagination 📎📖

- [ ] `src/concerns/with_file_uploads.ts`
- [ ] `TemporaryUploadedFile` + VineJS file schema integration
- [ ] `src/concerns/with_pagination.ts`
- [ ] Pagination Edge component
- [ ] `client/directives/sort.ts`

**Milestone:** File upload with progress, pagination with URL sync, drag-drop sort. ✅

---

### Phase 10 — Streaming 🌊

- [x] `$stream(name, content, replace?)` on WireComponent — with `$streamWriter` callback for real-time push
- [x] Client-side stream handling in `component.ts` `_applyStreamChunk()` + `_applyResponse()`
- [x] SSE streaming over `text/event-stream` response — request handler detects `Accept: text/event-stream`, opens SSE connection, pushes `event: stream` per chunk, sends `event: response` at end
- [x] Client `Connection.requestStreaming()` — parses SSE ReadableStream, dispatches chunks in real-time
- [x] Automatic SSE mode: client sends `Accept: text/event-stream` when action calls are present; server falls back to JSON for non-streaming actions

**Milestone:** AI/LLM streaming text into `wire:stream` element — words appear in real-time. ✅

---

### Phase 11 — Testing & CLI 🧪🪄

**CLI — ✅ Complete**

- [x] `commands/make_adowire.ts` — `node ace make:adowire <name> [--page] [--class] [--view]`
- [x] `commands/adowire_list.ts` — `node ace adowire:list [--json]`
- [x] `commands/adowire_layout.ts` — `node ace adowire:layout [--name] [--force]`
- [x] `commands/adowire_move.ts` — `node ace adowire:move <from> <to>`
- [x] `commands/adowire_delete.ts` — `node ace adowire:delete <name> [--force]`
- [x] `commands/adowire_stubs.ts` — `node ace adowire:stubs [--force]`
- [x] `commands/main.ts` — Ace loader (`getMetaData` / `getCommand`)
- [x] `commands/commands.json` — command metadata manifest
- [x] `configure.ts` — full configure hook (config stub, `rcFile.addProvider`, `rcFile.addCommand`, scaffold dirs)
- [x] `stubs/make/component.stub`
- [x] `stubs/make/page.stub`
- [x] `stubs/make/view.stub`
- [x] `stubs/make/layout.stub`
- [x] `stubs/config/adowire.stub`
- [x] `stubs/main.ts` added as own tsdown entry (fixes `stubsRoot` path in build)
- [x] `package.json` `./commands` subpath export

**Testing — ⏳ Pending**

- [ ] `src/testing/wire_test.ts`
- [ ] All `assert*` methods
- [ ] `commands/make_adowire_form.ts` _(blocked on WireForm)_

**Milestone:** `node ace make:adowire` scaffolds correctly ✅ — full Japa test suite pending.

---

### Phase 12 — Polish & Publish 📦

- [x] `src/synthesizers/` — Date, Set, Map synthesizers (with custom `Synthesizer` interface)
- [x] `Adowire.synthesizer(impl)` — user-extensible
- [ ] `README.md` — full developer documentation
- [ ] All CI checks passing (lint, typecheck, tests)
- [ ] npm publish with provenance

**Milestone:** v1.0.0 published to npm. ✅

---

### New: Dev-Mode Template Safety 🛡️

> Added outside original phases — provides runtime + compile-time type safety for Edge templates.

- [x] `src/dev_proxy.ts` — development-mode `Proxy` wrapper for template data
  - [x] Top-level undefined variable warnings (`{{ naem }}` → warns with available keys)
  - [x] Deep recursive proxying for nested objects (`{{ submittedData.naem }}` → warns with full dotted path)
  - [x] `$`-prefixed framework objects excluded from deep proxy (`$errors.name` no false positive)
  - [x] `WeakMap` proxy cache — no duplicate proxies on repeated access
  - [x] `SILENT_PROPS` set — suppresses warnings for JS internals, Edge.js internals, Symbols
  - [x] `flushDevWarnings()` — collect warnings for testing
  - [x] `isDevProxyEnabled(config)` — resolves from config or `NODE_ENV`
  - [x] `maybeDevProxy(data, name, enabled)` — conditional wrapper
- [x] Integrated into `WireComponent.render()` — automatic in dev mode
- [x] Integrated into `@adowire` SSR tag — initial page renders also covered
- [x] `devProxy` config option in `AdowireConfig` (defaults to `NODE_ENV !== 'production'`)
- [x] `ViewData<T>` utility type — extracts template data shape from any WireComponent subclass
  - [x] Filters out `$`-prefixed internals, `_`-prefixed privates, and methods
  - [x] Includes `$errors` and `$component` framework injections
  - [x] Exported from package entrypoint for IDE hover/documentation

### New: Example Demo Pages 🎓

> Working example components in `adowire-test/` demo app exercising each directive.

- [x] `examples/click_demo` — `adowire:click` counter
- [x] `examples/model_submit` — `adowire:model` + `adowire:submit` form with validation, typed `ContactFormData` interface
- [x] `examples/loading_demo` — `adowire:loading` show/hide + attr toggling
- [x] `examples/poll_demo` — `adowire:poll` with visibility pause
- [x] `examples/stream_demo` — `adowire:stream` real-time SSE word-by-word streaming
- [x] `examples/ignore_demo` — `adowire:ignore` DOM preservation
- [x] `examples/key_demo` — `adowire:key` stable identity in loops
- [x] `examples/model_live_demo` — `adowire:model.live` with all modifiers (live, blur, debounce, debounce.500ms, throttle) + search filtering + update counter
- [x] `examples/validate_demo` — `@Validate` decorator with VineJS rules, `@error` tags, real-time validation via `adowire:model.live.debounce`, `onUpdate: false` demo
- [x] `examples/html_components_demo` — full showcase of `<adowire:*>` HTML tag syntax vs `@adowire()` Edge tag syntax; static/dynamic/boolean/kebab-case props; `:is` dynamic component with tab switching; auto-prop assignment flow diagram; `examples/components/counter` and `examples/components/info_card` child components
- [x] Home page with links to all examples
- [x] `router.adowire()` page routing for all examples

---

## 7. API Design (Developer-Facing)

### Component Class

```typescript
// app/adowire/counter.ts
import { WireComponent } from 'adowire'
import { Computed, Locked, Validate, On } from 'adowire/decorators'
import vine from '@vinejs/vine'

export default class Counter extends WireComponent {
  count = 0

  @Locked()
  userId!: number

  @Validate(vine.number().min(1).max(100))
  limit = 10

  async mount({ initialCount = 0 }: { initialCount?: number }) {
    this.count = initialCount
    this.userId = this.$ctx.auth.user!.id
  }

  increment() {
    this.count++
  }

  decrement() {
    if (this.count > 0) this.count--
  }

  @Computed()
  get doubled() {
    return this.count * 2
  }

  @On('count-reset')
  resetCount() {
    this.count = 0
  }
}
```

### Edge Template

```edge
{{-- resources/views/adowire/counter.edge --}}
<div>
  <h1>
    Count: {{ count }}
  </h1>
  <h2>
    Doubled: {{ await $this.doubled }}
  </h2>

  <button wire:click="decrement">-</button>
  <button wire:click="increment">+</button>
  <button wire:click="$refresh">Refresh</button>
  <button wire:click="$toggle('showDetails')">Toggle</button>

  @if(showDetails)
    <p wire:transition>
      Details here
    </p>
  @end
  
  <span wire:loading>Updating...</span>
</div>
```

### Layout Template

```edge
{{-- resources/views/layouts/adowire.edge --}}
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>
      My App
    </title>
    @!wireStyles()
  </head>
  <body>
    {{{ await $slots.main() }}}
    @!wireScripts()
  </body>
</html>
```

### Form Object

```typescript
// app/adowire/forms/post_form.ts
import { WireForm } from 'adowire'
import { Validate } from 'adowire/decorators'
import vine from '@vinejs/vine'

export default class PostForm extends WireForm {
  @Validate(vine.string().minLength(3).maxLength(255))
  title = ''

  @Validate(vine.string().minLength(10))
  content = ''

  async store() {
    await this.validate()
    // save to DB ...
    this.reset()
  }

  async update(post: Post) {
    await this.validate()
    await post.merge(this.only(['title', 'content'])).save()
    this.reset()
  }
}
```

### Component Using Form

```typescript
// app/adowire/posts/create.ts
import { WireComponent } from 'adowire'
import { Layout, Title } from 'adowire/decorators'
import PostForm from '#wire/forms/post_form'

@Title('Create Post')
@Layout('layouts/adowire')
export default class CreatePost extends WireComponent {
  declare form: PostForm

  async mount() {
    this.form = new PostForm(this)
  }

  async save() {
    await this.form.store()
    this.$redirect('/posts')
  }
}
```

### Route Registration

```typescript
// start/routes.ts
import router from '@adonisjs/core/services/router'

// Regular page — component embedded inside a view
router.get('/dashboard', async ({ view }) => {
  return view.render('pages/dashboard')
})

// Wire page routes — component IS the page
router.wire('/posts/create', 'posts.create')
router.wire('/posts/:id/edit', 'posts.edit')
```

---

## 8. VineJS Validation Design

### How `@Validate` Works

The `@Validate` decorator accepts a **VineJS schema type** directly — not a string rule like `'required|min:3'`. This is the key difference from Livewire's PHP attribute approach.

```typescript
import vine from '@vinejs/vine'
import { Validate } from 'adowire/decorators'

// Simple rule
@Validate(vine.string().minLength(3))
title = ''

// With options
@Validate(vine.string().email(), {
  message: 'Please enter a valid email address',
  as: 'email address',   // replaces field name in default messages
  onUpdate: true,        // default: validate on every property update
})
email = ''

// Stacked rules (multiple decorators)
@Validate(vine.string().minLength(3), { message: 'Title is too short' })
@Validate(vine.string().maxLength(255), { message: 'Title is too long' })
title = ''
```

### How `validate()` Works Internally

When `this.validate()` is called, adowire:

1. Collects all `@Validate` decorated properties and their VineJS schemas
2. Builds a `vine.object({ title: vine.string()..., content: vine.string()... })`
3. Pre-compiles it with `vine.create(schema)`
4. Applies the `SimpleMessagesProvider` with any custom messages from options
5. Calls `validator.validate(this.all())`
6. On `E_VALIDATION_ERROR`: populates `this.$errors` from `error.messages`, throws `ValidationException`
7. On success: returns validated+typed data

### Using `rules()` for Complex VineJS Scenarios

For scenarios requiring VineJS's full power (unions, conditional groups, cross-field validation):

```typescript
export default class RegisterUser extends WireComponent {
  username = ''
  email = ''
  password = ''
  passwordConfirmation = ''
  isBusinessAccount = false
  companyName = ''

  // Override rules() for complex VineJS schemas
  protected rules() {
    const base = vine.object({
      username: vine.string().minLength(3).alphaNumeric(),
      email: vine.string().email().normalizeEmail(),
      password: vine.string().minLength(8).confirmed(),
    })

    // Conditional group — companyName required for business accounts
    const businessGroup = vine.group([
      vine.group.if((data) => vine.helpers.isTrue(data.isBusinessAccount), {
        isBusinessAccount: vine.literal(true),
        companyName: vine.string().minLength(2),
      }),
      vine.group.else({
        isBusinessAccount: vine.literal(false),
      }),
    ])

    return base.merge(businessGroup)
  }

  protected messages() {
    return {
      'username.minLength': 'Username must be at least {{ min }} characters',
      'email.required': 'Please enter your email address',
      'password.confirmed': 'Passwords do not match',
      'companyName.required': 'Company name is required for business accounts',
    }
  }

  protected validationAttributes() {
    return {
      passwordConfirmation: 'password confirmation',
      companyName: 'company name',
    }
  }

  async register() {
    await this.validate()
    // ...
  }
}
```

### Real-Time Validation

When `wire:model.live` or `wire:model.blur` is used, adowire runs the `@Validate` schema for only the updated property on each server round-trip:

```edge
<input type="text" wire:model.live.blur="title" />
@error('title')
  <p class="text-red-500">
    {{ message }}
  </p>
@enderror
```

```typescript
@Validate(vine.string().minLength(3).maxLength(255))
title = ''
```

Adowire validates `title` alone (not the whole form) on every blur event. The full `validate()` is still called on submit.

### `$errors` Client-Side (via Alpine `$wire`)

```edge
<input wire:model="email" type="email" />
<div wire:show="$wire.$errors.has('email')" class="text-red-500">
  <span wire:text="$wire.$errors.first('email')"></span>
</div>
```

---

## 9. Edge.js Template API

### Tags

| Tag                                     | Description                                        |
| --------------------------------------- | -------------------------------------------------- |
| `@!wireStyles()`                        | Inject adowire CSS (placeholder, future use)       |
| `@!wireScripts()`                       | Inject Alpine.js + adowire `wire.js` client bundle |
| `@adowire('name', props?)`                 | Render a nested wire component                     |
| `@adowire($dynamicName, props?)`           | Dynamic component rendering                        |
| `@adowire.slot('name')`                    | Named slot content passed to child                 |
| `@island` / `@endisland`                | Independent re-render region                       |
| `@island(name: 'x', lazy: true)`        | Named + lazy island                                |
| `@placeholder` / `@endplaceholder`      | Shown while lazy component/island loads            |
| `@persist('key')` / `@endpersist`       | Preserve element across SPA navigations            |
| `@teleport('#target')` / `@endteleport` | Render into different DOM node                     |
| `@error('field')` / `@enderror`         | Show first validation error for field              |

### Globals Available in Wire Templates

| Variable      | Type               | Description                                 |
| ------------- | ------------------ | ------------------------------------------- |
| `$this`       | Component instance | Access computed properties                  |
| `$errors`     | ErrorBag           | Server-side validation errors               |
| `$slots`      | SlotsBag           | Named slots from parent                     |
| `$attributes` | AttributesBag      | HTML attributes forwarded from parent       |
| `$wire`       | AlpineBridge       | Client-side wire bridge (for inline Alpine) |

---

## 10. Client-Side Directives

| Directive         | Key Modifiers                                                 | Description                                  |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `wire:model`      | `.live`, `.blur`, `.debounce.Xms`, `.throttle.Xms`            | Two-way binding                              |
| `wire:click`      | `.async`, `.renderless`, `.preserve-scroll` + event modifiers | Server action                                |
| `wire:submit`     | event modifiers                                               | Form submit interception                     |
| `wire:keydown`    | key modifiers + event modifiers                               | Keyboard action                              |
| `wire:loading`    | `.class`, `.attr`, `.remove`, `.delay`, `.delay.Xms`          | Loading state                                |
| `wire:target`     | —                                                             | Scope `wire:loading` to specific action/prop |
| `wire:navigate`   | `.hover`                                                      | SPA navigation                               |
| `wire:current`    | —                                                             | Active link marker                           |
| `wire:poll`       | `.Xs`, `.visible`, `.keep-alive`                              | Auto-refresh                                 |
| `wire:intersect`  | `.once`, `.enter`, `.leave`                                   | Viewport trigger                             |
| `wire:init`       | —                                                             | On component client-boot                     |
| `wire:confirm`    | `.prompt`                                                     | Confirmation dialog                          |
| `wire:transition` | `.in`, `.out`, `.duration.Xms`                                | CSS transitions                              |
| `wire:offline`    | —                                                             | Show when offline                            |
| `wire:dirty`      | `.class`, `.class.remove`                                     | Dirty state                                  |
| `wire:cloak`      | —                                                             | Hide until component boots                   |
| `wire:ignore`     | `.self`                                                       | Prevent morphdom touching element            |
| `wire:replace`    | —                                                             | Replace children wholesale                   |
| `wire:ref`        | —                                                             | Named element reference                      |
| `wire:show`       | —                                                             | Reactive CSS visibility                      |
| `wire:text`       | —                                                             | Reactive text node                           |
| `wire:bind:attr`  | —                                                             | Reactive attribute                           |
| `wire:sort`       | `.item`, `.handle`                                            | Drag-drop sorting                            |
| `wire:stream`     | `.replace`                                                    | Streaming text target                        |

---

## 11. TypeScript Decorators

| Decorator                      | Target          | Description                                                    |
| ------------------------------ | --------------- | -------------------------------------------------------------- |
| `@Computed()`                  | Method (getter) | Memoize result per request; accessible as `$this.prop` in Edge |
| `@Locked()`                    | Property        | Block all client-side mutation attempts                        |
| `@Validate(vineSchema, opts?)` | Property        | VineJS schema rule on property                                 |
| `@Url(opts?)`                  | Property        | Sync to URL query parameter                                    |
| `@On('event')`                 | Method          | Listen for dispatched component event                          |
| `@On('event.{prop.id}')`       | Method          | Dynamic event name with component state                        |
| `@Reactive()`                  | Property        | Re-sync from parent on every parent update                     |
| `@Modelable()`                 | Property        | Expose for parent `wire:model` binding                         |
| `@Lazy(opts?)`                 | Class           | Defer initial render until after page load                     |
| `@Session(opts?)`              | Property        | Persist value in AdonisJS session store                        |
| `@Async()`                     | Method          | Fire-and-forget; does not block request queue                  |
| `@Renderless()`                | Method          | Action executes but skips re-render                            |
| `@Defer()`                     | Property        | Batch update until next explicit action                        |
| `@Isolate()`                   | Method          | Prevents dispatched events from bubbling                       |
| `@Json()`                      | Method          | Returns JSON directly for JS consumption (skips re-render)     |
| `@Title('text')`               | Class           | Sets `<title>` tag for page components                         |
| `@Layout('view', opts?)`       | Class           | Wraps page component in a layout view                          |

---

## 12. Security Model

| Threat                                     | Mitigation                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Snapshot state tampering                   | HMAC-SHA256 on every snapshot; verified before hydration                  |
| Injecting values into `@Locked` properties | Server throws `E_LOCKED_PROPERTY` before hydration                        |
| Calling private/protected methods          | `$isCallable()` guard — only callable public methods                      |
| Calling lifecycle hooks directly           | All hook names explicitly blocked in `$isCallable()`                      |
| Action parameter forgery                   | Documented: treat as untrusted input, always validate/authorize           |
| CSRF attacks                               | AdonisJS CSRF middleware; token sent in `X-CSRF-TOKEN` header on all AJAX |
| Sensitive data leakage to client           | Protected/private properties excluded from snapshot                       |
| Type coercion attacks on properties        | VineJS schema types enforce strict casting                                |

---

## 13. Testing Strategy

### Unit Tests (Japa)

- `SnapshotManager` — dehydrate/hydrate round-trips for all types
- HMAC checksum signing and tamper detection
- `ComponentRegistry` — name resolution, namespace handling
- Decorator metadata — `@Validate`, `@Locked`, `@On`, `@Computed` etc.
- `WireValidator` — VineJS schema composition from `@Validate` decorators
- `morph_markers` — correct injection around `@if`/`@each` blocks

### Integration Tests (Japa)

- Full request lifecycle: mount → dehydrate → AJAX → hydrate → action → dehydrate → render
- VineJS `E_VALIDATION_ERROR` caught and re-rendered with errors
- Events dispatched and received by `@On` listeners
- `@Locked` properties throw on mutation
- Redirect effects in response
- Nested component rendering and independence
- `@Reactive` prop re-sync

### E2E Tests (Japa + Playwright — Phase 12)

- `wire:model.live` two-way binding in browser
- `wire:click` action call and DOM update
- `wire:submit` with VineJS validation errors shown
- `wire:loading` visibility during request
- DOM morphing correctness with `wire:key`
- SPA navigation with `wire:navigate`

---

## 14. Ace Commands Reference

> **Status: ✅ Implemented** — 7 commands, all tested in `adowire-test`.

### Full Command Table

| Command | Short flags | Description |
| ------- | ----------- | ----------- |
| `make:adowire <name>` | `--page`/`-p` `--class`/`-c` `--view`/`-v` | Scaffold component class + Edge view. Default: both. |
| `adowire:list` | `--json`/`-j` | Pretty-print table of all registered components (name, view, class path). |
| `adowire:layout` | `--name`/`-n` `--force`/`-f` | Create `resources/views/layouts/adowire.edge` (or custom name). |
| `adowire:move <from> <to>` | — | Rename/move class + view; rewrites the class declaration to match the new name. |
| `adowire:delete <name>` | `--force`/`-f` | Delete class + view with confirmation prompt (skip with `--force`). |
| `adowire:stubs` | `--force`/`-f` | Publish all stubs to `stubs/vendor/adowire/` for customisation. Skips existing unless `--force`. |
| `configure adowire` | — | Publish `config/adowire.ts`, register provider + commands in `adonisrc.ts`, create scaffold dirs. |

---

### `node ace make:adowire <name>`

Scaffolds a wire component class and its Edge.js view template.

```bash
# Basic component — creates BOTH class and view (default)
node ace make:adowire counter
# → app/adowire/counter.ts
# → resources/views/adowire/counter.edge

# Nested path
node ace make:adowire posts/create
# → app/adowire/posts/create.ts
# → resources/views/adowire/posts/create.edge

# Page component (adds @Layout + @Title decorators)
node ace make:adowire pages/dashboard --page
# → app/adowire/pages/dashboard.ts   ← with @Title('Dashboard') @Layout('layouts/adowire')
# → resources/views/adowire/pages/dashboard.edge

# Class only — no view
node ace make:adowire widgets/badge --class
# → app/adowire/widgets/badge.ts

# View only — no class
node ace make:adowire widgets/badge --view
# → resources/views/adowire/widgets/badge.edge

# --class and --view together = same as default (both)
node ace make:adowire widgets/badge --class --view
# → app/adowire/widgets/badge.ts
# → resources/views/adowire/widgets/badge.edge
```

| Flag | Alias | Description |
| ---- | ----- | ----------- |
| `--page` | `-p` | Page variant: adds `@Title` and `@Layout('layouts/adowire')` decorators to the class |
| `--class` | `-c` | Generate class file only; skip the Edge view |
| `--view` | `-v` | Generate Edge view only; skip the class file |

> **Note:** AdonisJS generators singularise names (`stats` → `stat`, `posts` → `post`). This matches the same behaviour as `make:model`.

---

### `node ace adowire:list`

Lists all auto-discovered and manually registered components.

```bash
node ace adowire:list
# ┌─────────────────┬─────────────────────────────┬─────────────────────────────────────────┐
# │ Name            │ View                        │ Class Path                              │
# ├─────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
# │ counter         │ adowire/counter             │ .../app/adowire/counter.ts              │
# │ posts.create    │ adowire/posts/create        │ .../app/adowire/posts/create.ts         │
# │ pages.dashboard │ adowire/pages/dashboard     │ .../app/adowire/pages/dashboard.ts      │
# └─────────────────┴─────────────────────────────┴─────────────────────────────────────────┘
#   Total: 3 component(s)

node ace adowire:list --json
# [{ "name": "counter", "classPath": "...", "viewName": "adowire/counter" }, ...]
```

| Flag | Alias | Description |
| ---- | ----- | ----------- |
| `--json` | `-j` | Output component list as a JSON array instead of a table |

---

### `node ace adowire:layout`

Creates the default Adowire layout template. Writes the file directly (not through tempura) so Edge.js expressions like `{{ $title }}` and `{{{ $body }}}` are preserved verbatim.

```bash
# Create resources/views/layouts/adowire.edge  (default name)
node ace adowire:layout

# Create with a custom name
node ace adowire:layout --name app

# Overwrite if already exists
node ace adowire:layout --force
```

Generated output (`resources/views/layouts/adowire.edge`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ $title ?? 'App' }}</title>
  @adowireStyles
</head>
<body>
  {{{ $body }}}
  @adowireScripts
</body>
</html>
```

| Flag | Alias | Description |
| ---- | ----- | ----------- |
| `--name` | `-n` | Layout filename without `.edge` extension (default: `adowire`) |
| `--force` | `-f` | Overwrite the file if it already exists |

---

### `node ace adowire:move <from> <to>`

Renames or moves a component. Moves both the class file and the view file, and rewrites the class declaration inside the class file to match the new name.

```bash
# Rename a flat component
node ace adowire:move counter widgets/counter
# DONE: move .../app/adowire/counter.ts → .../app/adowire/widgets/counter.ts
# DONE: move .../resources/views/adowire/counter.edge → .../resources/views/adowire/widgets/counter.edge
# (class renamed Counter → Counter — same in this case)

# Rename across paths, class name changes
node ace adowire:move posts/create forms/post_create
# class PostCreate → class PostCreate  (etc.)
```

> Files that don't exist are skipped with a warning rather than causing an error.

---

### `node ace adowire:delete <name>`

Deletes a component class and its view. Prompts for confirmation unless `--force` is given.

```bash
# With confirmation prompt
node ace adowire:delete counter
# ? Delete component "counter" and its view? This cannot be undone. (y/N)

# Skip prompt
node ace adowire:delete counter --force
# DONE: delete .../app/adowire/counter.ts
# DONE: delete .../resources/views/adowire/counter.edge
```

| Flag | Alias | Description |
| ---- | ----- | ----------- |
| `--force` | `-f` | Skip the confirmation prompt |

---

### `node ace adowire:stubs`

Publishes the package's built-in stubs to `stubs/vendor/adowire/` so developers can customise the scaffolding templates. AdonisJS automatically prefers stubs found in the app's own `stubs/` directory over package defaults.

```bash
# Publish (skips files that already exist)
node ace adowire:stubs
# DONE: create stubs/vendor/adowire/make/component.stub
# DONE: create stubs/vendor/adowire/make/page.stub
# DONE: create stubs/vendor/adowire/make/view.stub
# DONE: create stubs/vendor/adowire/make/layout.stub
# DONE: create stubs/vendor/adowire/config/adowire.stub

# Overwrite existing stubs
node ace adowire:stubs --force
```

| Flag | Alias | Description |
| ---- | ----- | ----------- |
| `--force` | `-f` | Overwrite stubs that already exist in the destination |

**Published stubs:**

| Stub file | Used by |
| --------- | ------- |
| `make/component.stub` | `make:adowire` (basic class) |
| `make/page.stub` | `make:adowire --page` |
| `make/view.stub` | `make:adowire` (Edge template) |
| `make/layout.stub` | _(reference only — `adowire:layout` writes directly)_ |
| `config/adowire.stub` | `node ace configure adowire` |

---

### `node ace configure adowire`

Run once after installing the package. Uses AdonisJS codemods to:

1. Publish `config/adowire.ts` (via `stubs/config/adowire.stub`)
2. Register `adowire/wire_provider` in `adonisrc.ts` providers
3. Register `adowire/commands` in `adonisrc.ts` commands
4. Create `app/adowire/` and `resources/views/adowire/` scaffold directories

```bash
node ace configure adowire
# ✔ Adowire configured successfully!
#
#   Next steps:
#     node ace make:adowire counter             # basic component
#     node ace make:adowire dashboard --page    # page component
#     node ace adowire:list                     # list all components
```

---

### `node ace make:adowire:form <name>` _(planned)_

> ⚠️ **Not yet implemented** — blocked on `WireForm` (Phase 4).

Will scaffold a `WireForm` class alongside or independently of a component.

```bash
node ace make:adowire:form PostForm
# → app/adowire/forms/post_form.ts
```

---

## 15. Package Publishing

> **Status:** Publishable as alpha `0.x.x`. Not ready for stable `1.0.0` yet.

### Subpath Exports (actual `package.json`)

```json
{
  "exports": {
    ".": "./build/index.js",
    "./types": "./build/src/types.js",
    "./wire_provider": "./build/providers/wire_provider.js",
    "./client": "./build/adowire.js",
    "./commands": "./build/commands/main.js"
  }
}
```

| Subpath | Resolves to | Purpose |
| ------- | ----------- | ------- |
| `.` | `build/index.js` | Main entry — exports `WireComponent`, decorators, types, Edge plugin, etc. |
| `./types` | `build/src/types.js` | `AdowireConfig`, `WireSnapshot`, `ComponentDefinition`, etc. |
| `./wire_provider` | `build/providers/wire_provider.js` | AdonisJS service provider (registered in `adonisrc.ts`) |
| `./client` | `build/adowire.js` | Browser-side IIFE bundle (morphdom, directives, connection) |
| `./commands` | `build/commands/main.js` | Ace loader — `getMetaData()` / `getCommand()` for all 7 commands |

**Planned (not yet implemented):**

| Subpath | Purpose | Blocked on |
| ------- | ------- | ---------- |
| `./decorators` | Standalone decorator imports | — |
| `./concerns` | Reusable trait/concern mixins | Phase 5 |
| `./testing` | `WireTest` test utilities | Phase 11 testing |

### What Gets Published

```
build/
  index.js + index.d.ts            ← main entry (server-side exports)
  configure.js + configure.d.ts    ← node ace configure adowire
  adowire.js                       ← client-side IIFE bundle (27 KB)
  chunk-*.js                       ← shared chunk (reflect-metadata re-export)
  wire_provider-*.js               ← provider chunk (95 KB — component registry, snapshot, Edge plugin, request handler)
  dev_proxy-*.js                   ← dev-mode template proxy chunk
  stubs/
    main.js + main.d.ts            ← stubsRoot = import.meta.dirname
    make/component.stub             ← basic WireComponent class
    make/page.stub                  ← page component (@Layout + @Title)
    make/view.stub                  ← Edge.js template with {{-- comment --}}
    make/layout.stub                ← layout reference (adowire:layout writes directly)
    config/adowire.stub             ← config/adowire.ts published by configure hook
  commands/
    main.js + main.d.ts            ← Ace loader (getMetaData / getCommand + all 7 commands bundled)
    commands.json                   ← command metadata manifest
    *.d.ts                          ← declaration files for each command
  providers/
    wire_provider.js + .d.ts        ← re-export entry for the provider
  src/
    *.d.ts                          ← all server-side type declarations
  client/
    *.d.ts                          ← client-side type declarations
```

**Excluded from the tarball** (via `"files"` in `package.json`):

- `build/bin/` — test runner
- `build/tests/` — test spec declarations

**Tarball size:** ~86 KB compressed, ~289 KB unpacked.

### How to Publish

```bash
# 1. Log in to npm (one-time)
npm login

# 2. Publish via release-it (recommended — builds, tags, publishes, creates GitHub release)
npx release-it          # prompts for version bump
npx release-it patch    # 0.1.0 → 0.1.1
npx release-it minor    # 0.1.0 → 0.2.0

# Or manually:
npm run build
npm publish
```

### Do consumers need to reinstall after each build?

- **Symlinked dev (`file:../adowire`)**: No. The symlink always points at the live `build/` directory. Just `npm run compile` in the adowire folder and restart the dev server.
- **Published package (`npm install adowire`)**: Yes — consumers run `npm update adowire` to get the new version.

### Publishability Checklist

| Item | Status |
| ---- | ------ |
| `package.json` name, version, description | ✅ |
| `package.json` author, repository, bugs, homepage | ✅ |
| `package.json` license (MIT) | ✅ |
| `package.json` exports (5 subpaths) | ✅ |
| `package.json` files (excludes tests/bin) | ✅ |
| `package.json` engines (`>=24.0.0`) | ✅ |
| `package.json` peerDependencies (`@adonisjs/core ^7`, `edge.js ^6`) | ✅ |
| `publishConfig` (public, provenance) | ✅ |
| `release-it` config (git tags, GitHub release, conventional changelog) | ✅ |
| `prepublishOnly` script (auto-builds) | ✅ |
| Build output clean (no test/bin leaks) | ✅ |
| Type declarations (`.d.ts`) generated | ✅ |
| README.md | ⚠️ Needs alpha warning + basic usage docs |
| CI (GitHub Actions) | ❌ Not set up yet |
| Test suite | ❌ No automated tests (testing harness is Phase 11) |

### Feature Completion Summary (for README)

| Area | Status | Completion |
| ---- | ------ | ---------- |
| Core Engine (snapshot, hydration, morphing) | ✅ Ship-ready | 100% |
| Properties & Model binding | ✅ Ship-ready | 90% |
| Lifecycle Hooks | ✅ Ship-ready | 92% |
| Streaming (`$stream`, `adowire:stream`) | ✅ Ship-ready | 100% |
| CLI / Ace Commands (7 commands) | ✅ Ship-ready | 94% |
| Dev-Mode Template Safety | ✅ Ship-ready | 100% |
| AdonisJS Integration (provider, Edge, router.adowire) | 🟡 Partial | 54% |
| Validation (VineJS) | 🟡 Partial | 43% |
| Directives (HTML attributes) | 🟡 Partial | 38% |
| Actions | 🟡 Partial | 52% |
| Decorators | 🟡 Partial | 33% |
| Security (HMAC, CSRF, callable guard) | 🟡 Partial | 75% |
| Forms (WireForm) | ❌ Not started | 0% |
| Events & Nesting | ❌ Not started | 0% |
| Islands & Lazy Loading | ❌ Not started | 0% |
| File Uploads | ❌ Not started | 0% |
| Pagination | ❌ Not started | 0% |
| URL Query Parameters | ❌ Not started | 0% |
| Navigate (SPA Mode) | ❌ Not started | 0% |
| Teleport | ❌ Not started | 0% |
| Testing Harness | ❌ Not started | 0% |

### Versioning

- Semantic Versioning (semver)
- Conventional commits → auto-changelog via `@release-it/conventional-changelog`
- Pre-release: `0.x.x` during active development
- Stable `1.0.0` after Phases 1–9 features complete and tested (Forms, Events, Nesting, Directives, Islands, Navigate, File Uploads, Pagination)
- CI: GitHub Actions — lint + typecheck + tests on Ubuntu + Windows, Node.js 24+

---

_Adowire Build Plan v1.1_
