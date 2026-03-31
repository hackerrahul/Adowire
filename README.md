# Adowire

> ⚠️ **Alpha Software** — Adowire is in active development (`0.x.x`). APIs may change between minor versions. Not recommended for production use yet.

A full-stack reactive component system for **AdonisJS v7** and **Edge.js v6** — inspired by Laravel Livewire. Build dynamic, interactive UIs using server-side TypeScript classes and Edge templates. No frontend framework required.

## What It Does

You write a TypeScript class with public properties and methods, pair it with an Edge template, and Adowire handles everything else — state serialization, AJAX roundtrips, DOM diffing, two-way binding, validation, streaming, and more.

```/dev/null/example.ts#L1-L2
// No React. No Vue. No manual fetch calls.
// Just TypeScript + Edge templates = reactive UI.
```

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Components](#components)
- [Rendering Components](#rendering-components)
- [Page Components & Routing](#page-components--routing)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Decorators](#decorators)
- [Client-Side Directives](#client-side-directives)
- [Validation](#validation)
- [Streaming](#streaming)
- [Alpine.js Integration](#alpinejs-integration)
- [CLI Commands](#cli-commands)
- [Configuration](#configuration)
- [Security](#security)
- [What Works & What's Coming](#what-works--whats-coming)
- [License](#license)

---

## Requirements

| Dependency | Version |
| --- | --- |
| Node.js | `>= 24.0.0` |
| AdonisJS | `^7.0.0` |
| Edge.js | `^6.0.0` |
| @adonisjs/assembler *(optional, for CLI commands)* | `^8.0.0` |

---

## Installation

Install the package from npm:

```/dev/null/sh#L1
npm install adowire
```

Then configure it using the Ace CLI:

```/dev/null/sh#L1
node ace configure adowire
```

This will:

1. Publish `config/adowire.ts` to your project
2. Register the provider (`adowire/wire_provider`) and commands (`adowire/commands`) in `adonisrc.ts`
3. Create the scaffold directories: `app/adowire/` and `resources/views/adowire/`

### Add Tags to Your Layout

In your main layout template (e.g. `resources/views/layouts/main.edge`), add the Adowire style and script tags:

```/dev/null/layout.edge#L1-L12
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ $title ?? 'My App' }}</title>
  @adowireStyles
</head>
<body>
  {{{ await $slots.main() }}}
  @adowireScripts
</body>
</html>
```

- `@adowireStyles` — injects the `[adowire:cloak]` CSS rule to prevent FOUC
- `@adowireScripts` — injects the client-side JavaScript bundle and CSRF meta tag

---

## Quick Start

### 1. Create a Component

```/dev/null/sh#L1
node ace make:adowire counter
```

This generates two files:

- `app/adowire/counter.ts` — the component class
- `resources/views/adowire/counter.edge` — the template

### 2. Write the Component Class

```/dev/null/app/adowire/counter.ts#L1-L18
import { WireComponent } from 'adowire'

export default class Counter extends WireComponent {
  count = 0

  increment() {
    this.count++
  }

  decrement() {
    this.count--
  }

  reset() {
    this.count = 0
  }
}
```

### 3. Write the Template

```/dev/null/resources/views/adowire/counter.edge#L1-L8
<div>
  <h2>Count: {{ count }}</h2>

  <button adowire:click="increment">+</button>
  <button adowire:click="decrement">−</button>
  <button adowire:click="reset">Reset</button>
</div>
```

### 4. Use It in Any Page

```/dev/null/resources/views/pages/home.edge#L1-L5
@layout('layouts/main')

@section('content')
  @adowire('counter')
  @end
@endsection
```

Or use the HTML-style syntax:

```/dev/null/resources/views/pages/home.edge#L1
<adowire:counter />
```

---

## Components

A component is a TypeScript class that extends `WireComponent`. Public properties become reactive state. Public methods become callable actions.

```/dev/null/app/adowire/todo_list.ts#L1-L23
import { WireComponent } from 'adowire'

export default class TodoList extends WireComponent {
  // Reactive state — automatically synced with the client
  items: string[] = []
  newItem = ''

  // Actions — callable from the template
  add() {
    if (this.newItem.trim()) {
      this.items.push(this.newItem.trim())
      this.newItem = ''
    }
  }

  remove(index: number) {
    this.items.splice(index, 1)
  }
}
```

### State Helpers

Every component has built-in methods for managing state:

| Method | Description |
| --- | --- |
| `fill(data)` | Bulk-assign properties from an object |
| `reset(...props)` | Reset properties to their initial values (all if no args) |
| `pull(...props)` | Reset and return the old values |
| `only(...props)` | Return a subset of public state |
| `all()` | Return all public state as a plain object |

### Magic Actions

These methods trigger special effects on the client:

| Method | Description |
| --- | --- |
| `$refresh()` | Re-render the component without calling any action |
| `$set(prop, value)` | Set a public property from the server |
| `$toggle(prop)` | Toggle a boolean property |
| `$redirect(url)` | Redirect the browser after the response |
| `$dispatch(event, params)` | Dispatch a browser event |
| `$stream(name, content, replace?)` | Stream content to a `adowire:stream` target |
| `$download(name, url)` | Trigger a file download |
| `js(expression)` | Execute a JavaScript expression on the client |
| `skipRender()` | Skip re-rendering for the current request |

---

## Rendering Components

### Edge Tag Syntax

```/dev/null/example.edge#L1-L5
{{-- Basic --}}
@adowire('counter')
@end

{{-- With props --}}
@adowire('counter', { initialCount: 10 })
@end
```

### HTML-Style Syntax

The HTML preprocessor transforms `<adowire:...>` tags at compile time:

```/dev/null/example.edge#L1-L14
{{-- Self-closing --}}
<adowire:counter />

{{-- With props --}}
<adowire:counter title="My Counter" />

{{-- Dynamic props (prefixed with :) --}}
<adowire:counter :count="someVariable" />

{{-- Boolean props --}}
<adowire:counter disabled />

{{-- Nested components (dot notation) --}}
<adowire:posts.create />

{{-- Kebab-case auto-converts to camelCase --}}
<adowire:counter initial-count="5" />

{{-- Dynamic component name --}}
<adowire:dynamic-component :is="activeTab" />
```

---

## Page Components & Routing

Page components are full-page Adowire components that replace traditional controller + view pairs. Use the `router.adowire()` macro in your routes file:

```/dev/null/start/routes.ts#L1-L8
import router from '@adonisjs/core/services/router'

// Simple page
router.adowire('/dashboard', 'dashboard')

// With route params — passed to mount()
router.adowire('/posts/:id', 'posts.show')
```

Scaffold a page component with the `--page` flag:

```/dev/null/sh#L1
node ace make:adowire dashboard --page
```

This generates a component with `@Layout` and `@Title` decorators:

```/dev/null/app/adowire/dashboard.ts#L1-L12
import { WireComponent, Layout, Title } from 'adowire'

@Layout('layouts/adowire')
@Title('Dashboard')
export default class Dashboard extends WireComponent {
  // Route params are passed to mount()
  mount(params: Record<string, any>) {
    // ...
  }
}
```

---

## Lifecycle Hooks

| Hook | When It Runs | Request Type |
| --- | --- | --- |
| `mount(props)` | First request only (component initialization) | Initial |
| `boot()` | Every request, before hydration | All |
| `hydrate()` | After boot, on subsequent requests only | AJAX |
| `rendering(view, data)` | Before Edge renders — can mutate data | All |
| `rendered(view, html)` | After Edge renders — can mutate HTML string | All |
| `dehydrate()` | End of every request, before snapshot | All |
| `updating(name, value)` | Before a property is set from the client | AJAX |
| `updated(name, value)` | After a property is set from the client | AJAX |
| `exception(error, stop)` | On unhandled exception | All |

### Property-Specific Hooks

You can define hooks that target a specific property by name:

```/dev/null/example.ts#L1-L7
// Called when 'search' is about to change
updatingSearch(value: string) {
  console.log('Search changing to:', value)
}

// Called after 'search' has changed
updatedSearch(value: string) {
  console.log('Search changed to:', value)
}
```

---

## Decorators

### `@Computed()`

Memoized per-request computed property. Accessible in templates like a regular property.

```/dev/null/example.ts#L1-L8
import { WireComponent, Computed } from 'adowire'

export default class Cart extends WireComponent {
  items: { price: number }[] = []

  @Computed()
  get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0)
  }
}
```

```/dev/null/example.edge#L1
<p>Total: ${{ total }}</p>
```

### `@Locked()`

Prevents a property from being modified by the client. Throws `LockedPropertyException` if tampered with.

```/dev/null/example.ts#L1-L5
import { WireComponent, Locked } from 'adowire'

export default class Payment extends WireComponent {
  @Locked()
  price = 99.99  // Client cannot change this
}
```

### `@Validate(rule, options?)`

Attaches a VineJS validation rule to a property. Validated automatically on update or manually via `this.validate()`.

```/dev/null/example.ts#L1-L11
import { WireComponent, Validate } from 'adowire'
import vine from '@vinejs/vine'

export default class Registration extends WireComponent {
  @Validate(vine.string().email(), { message: 'Please enter a valid email' })
  email = ''

  @Validate(vine.string().minLength(8))
  password = ''
}
```

### `@Title(text)`

Sets the browser's `<title>` for page components.

```/dev/null/example.ts#L1-L2
@Title('Settings')
export default class Settings extends WireComponent { /* ... */ }
```

### `@Layout(name, options?)`

Wraps a page component in a layout template.

```/dev/null/example.ts#L1-L2
@Layout('layouts/adowire', { slot: 'main' })
export default class Dashboard extends WireComponent { /* ... */ }
```

---

## Client-Side Directives

Directives are HTML attributes that wire up client-side behavior. All prefixed with `adowire:`.

### `adowire:click`

Call a server-side method when the element is clicked.

```/dev/null/example.edge#L1-L5
<button adowire:click="increment">+1</button>

{{-- With arguments --}}
<button adowire:click="remove({{ id }})">Delete</button>
```

### `adowire:model`

Two-way data binding between an input and a component property.

```/dev/null/example.edge#L1-L11
{{-- Deferred (synced on form submit) --}}
<input adowire:model="name" />

{{-- Live (syncs on every keystroke) --}}
<input adowire:model.live="search" />

{{-- Blur (syncs when the input loses focus) --}}
<input adowire:model.live.blur="email" />

{{-- Debounced (waits 500ms after the last keystroke) --}}
<input adowire:model.live.debounce.500ms="query" />

{{-- Throttled (at most once per second) --}}
<input adowire:model.live.throttle.1000ms="filter" />
```

### `adowire:submit`

Intercept form submission and call a server-side method. Automatically collects `adowire:model` fields.

```/dev/null/example.edge#L1-L5
<form adowire:submit="save">
  <input adowire:model="title" />
  <textarea adowire:model="body"></textarea>
  <button type="submit">Save</button>
</form>
```

### `adowire:loading`

Show, hide, or modify elements during server requests.

```/dev/null/example.edge#L1-L14
{{-- Show while loading (hidden at rest) --}}
<div adowire:loading>Loading...</div>

{{-- Hide while loading (visible at rest) --}}
<div adowire:loading.remove>Content loaded.</div>

{{-- Add a CSS class while loading --}}
<button adowire:loading.class="opacity-50">Submit</button>

{{-- Remove a CSS class while loading --}}
<div adowire:loading.class.remove="opacity-100">Content</div>

{{-- Set an attribute while loading --}}
<button adowire:loading.attr="disabled">Submit</button>
```

### `adowire:poll`

Automatically refresh the component at an interval.

```/dev/null/example.edge#L1-L5
{{-- Poll every 2 seconds (default) --}}
<div adowire:poll>{{ timestamp }}</div>

{{-- Custom interval --}}
<div adowire:poll.5s>{{ notifications }}</div>

{{-- Only poll when the element is visible --}}
<div adowire:poll.10s.visible>{{ feed }}</div>
```

### `adowire:dirty`

Show changes in the UI when local state differs from server state.

```/dev/null/example.edge#L1-L5
{{-- Show element when input is dirty --}}
<span adowire:dirty>Unsaved changes</span>

{{-- Add a class when dirty --}}
<input adowire:model.live="name" adowire:dirty.class="border-yellow-500" />
```

### `adowire:show`

Toggle element visibility based on a JavaScript expression (no server roundtrip).

```/dev/null/example.edge#L1
<div adowire:show="isOpen">Dropdown content</div>
```

### `adowire:cloak`

Hide the element until the component has fully initialized. Prevents flash of unstyled content (FOUC).

```/dev/null/example.edge#L1
<div adowire:cloak>This won't flash on load</div>
```

### `adowire:stream`

Target element for real-time SSE streaming via `$stream()`.

```/dev/null/example.edge#L1-L5
{{-- Append streamed content --}}
<div adowire:stream="response"></div>

{{-- Replace content instead of appending --}}
<div adowire:stream.replace="status"></div>
```

### `adowire:ignore`

Exclude an element from DOM morphing. Useful for third-party widgets.

```/dev/null/example.edge#L1
<div adowire:ignore>This content won't be touched by morphdom</div>
```

### `adowire:key`

Provide a stable identity for morphdom diffing (like `key` in React/Vue).

```/dev/null/example.edge#L1-L3
@each(item in items)
  <div adowire:key="{{ item.id }}">{{ item.name }}</div>
@end
```

---

## Validation

Adowire integrates with [VineJS](https://vinejs.dev/) for server-side validation.

### Using Decorators

```/dev/null/app/adowire/contact_form.ts#L1-L23
import { WireComponent, Validate } from 'adowire'
import vine from '@vinejs/vine'

export default class ContactForm extends WireComponent {
  @Validate(vine.string().minLength(2))
  name = ''

  @Validate(vine.string().email())
  email = ''

  @Validate(vine.string().minLength(10))
  message = ''

  async submit() {
    await this.validate() // Throws on failure, populates $errors
    // If we get here, all fields are valid
  }
}
```

### Using a Compiled Validator

```/dev/null/example.ts#L1-L14
import vine from '@vinejs/vine'

const validator = vine.compile(
  vine.object({
    name: vine.string(),
    email: vine.string().email(),
  })
)

export default class MyForm extends WireComponent {
  name = ''
  email = ''

  async submit() {
    const data = await this.validateUsing(validator)
    // data is fully typed
  }
}
```

### Displaying Errors in Templates

```/dev/null/example.edge#L1-L7
<input adowire:model.live="email" />

@error('email')
  <span class="text-red-500">{{ message }}</span>
@enderror
```

---

## Streaming

Send real-time content to the browser using Server-Sent Events:

```/dev/null/app/adowire/chat.ts#L1-L11
export default class Chat extends WireComponent {
  prompt = ''

  async ask() {
    for await (const chunk of getAIResponse(this.prompt)) {
      this.$stream('answer', chunk)
    }
  }
}
```

```/dev/null/resources/views/adowire/chat.edge#L1-L4
<form adowire:submit="ask">
  <input adowire:model="prompt" />
  <button type="submit">Ask</button>
</form>
<div adowire:stream="answer"></div>
```

---

## Alpine.js Integration

Adowire provides a `$wire` magic proxy for Alpine.js interop:

```/dev/null/example.edge#L1-L10
<div x-data>
  {{-- Read state --}}
  <span x-text="$wire.count"></span>

  {{-- Set state --}}
  <button @click="$wire.count = 0">Reset</button>

  {{-- Call actions --}}
  <button @click="await $wire.increment()">+1</button>
</div>
```

---

## CLI Commands

Adowire ships with **7 Ace commands** for scaffolding and managing components.

### `make:adowire`

Scaffold a new component class and/or Edge template.

```/dev/null/sh#L1-L11
# Component class + view
node ace make:adowire counter

# Nested component
node ace make:adowire posts/create

# Page component (adds @Layout + @Title decorators)
node ace make:adowire dashboard --page

# Class only (no view)
node ace make:adowire counter --class

# View only (no class)
node ace make:adowire counter --view
```

| Flag | Short | Description |
| --- | --- | --- |
| `--page` | `-p` | Scaffold as a page component with `@Layout` and `@Title` |
| `--class` | `-c` | Generate only the TypeScript class |
| `--view` | `-v` | Generate only the Edge template |

### `adowire:list`

List all registered components.

```/dev/null/sh#L1-L4
node ace adowire:list

# Output as JSON
node ace adowire:list --json
```

| Flag | Short | Description |
| --- | --- | --- |
| `--json` | `-j` | Output the component list as JSON |

### `adowire:layout`

Create a default Adowire layout template.

```/dev/null/sh#L1-L4
node ace adowire:layout

# Custom name
node ace adowire:layout --name app
```

| Flag | Short | Description |
| --- | --- | --- |
| `--name` | `-n` | Layout file name (default: `adowire`) |
| `--force` | `-f` | Overwrite if the file already exists |

### `adowire:move`

Rename or move a component (both class and view), automatically updating the class name.

```/dev/null/sh#L1
node ace adowire:move posts/create posts/entry
```

### `adowire:delete`

Delete a component's class and view files.

```/dev/null/sh#L1-L4
node ace adowire:delete counter

# Skip confirmation prompt
node ace adowire:delete counter --force
```

| Flag | Short | Description |
| --- | --- | --- |
| `--force` | `-f` | Skip the confirmation prompt |

### `adowire:stubs`

Publish Adowire's stub templates to your project for customization.

```/dev/null/sh#L1
node ace adowire:stubs
```

Stubs are published to `stubs/vendor/adowire/`.

| Flag | Short | Description |
| --- | --- | --- |
| `--force` | `-f` | Overwrite existing stubs |

### `configure adowire`

Initial setup command (run once after installation).

```/dev/null/sh#L1
node ace configure adowire
```

---

## Configuration

After running `node ace configure adowire`, you'll find `config/adowire.ts` in your project:

```/dev/null/config/adowire.ts#L1-L17
import { defineConfig } from 'adowire'

export default defineConfig({
  // URL prefix for the Adowire message endpoint
  prefix: '/adowire',

  // Directory where component classes live
  componentsPath: 'app/adowire',

  // Edge.js view prefix for component templates
  viewPrefix: 'adowire',

  // Default layout for page components
  defaultLayout: 'layouts/adowire',

  // Enable dev-mode template variable proxy (warns on undefined access)
  devProxy: true,
})
```

### All Options

| Option | Default | Description |
| --- | --- | --- |
| `prefix` | `'/adowire'` | URL prefix for the message endpoint |
| `componentsPath` | `'app/adowire'` | Where component classes live |
| `viewPrefix` | `'adowire'` | Edge.js view prefix |
| `secret` | `process.env.APP_KEY` | HMAC signing secret for snapshots |
| `namespaces` | — | Named namespace → directory mappings |
| `defaultLayout` | — | Fallback layout for `router.adowire()` pages |
| `devProxy` | `true` in dev | Warns on undefined template variable access |
| `injectMorphMarkers` | `true` | Morph markers around `@if`/`@each` blocks |

---

## Security

Adowire includes multiple layers of protection:

| Threat | Mitigation |
| --- | --- |
| Snapshot tampering | HMAC-SHA256 checksum on every snapshot, verified with `timingSafeEqual` |
| Locked property mutation | `@Locked()` throws `LockedPropertyException` before hydration |
| Calling private methods | `$isCallable()` blocks `$`/`_` prefixed methods, lifecycle hooks, and reserved names |
| CSRF attacks | AdonisJS CSRF middleware; token sent via `X-CSRF-TOKEN` header |
| Sensitive data leakage | Protected/private properties are excluded from the client snapshot |

---

## What Works & What's Coming

### ✅ Implemented

- Core reactive engine (snapshot, hydration, dehydration, DOM morphing)
- Public properties & two-way model binding
- Server-side actions callable from templates
- Full lifecycle hook system
- Real-time streaming (`$stream` + SSE)
- 5 decorators (`@Computed`, `@Locked`, `@Validate`, `@Title`, `@Layout`)
- 10+ client-side directives (click, model, submit, loading, poll, dirty, show, cloak, stream, ignore, key)
- HTML-style component tags (`<adowire:counter />`)
- Page components with `router.adowire()` macro
- Alpine.js `$wire` bridge
- 7 Ace CLI commands
- VineJS validation integration
- Dev-mode template safety proxy
- HMAC snapshot security

### 🚧 Coming Soon

- **WireForm** — dedicated form component with file uploads
- **Events & Nesting** — `$dispatch`, `@On` decorator, parent/child communication
- **Islands & Lazy Loading** — partial hydration, `@Lazy` decorator
- **SPA Navigation** — `adowire:navigate` for seamless page transitions
- **File Uploads** — direct upload support with progress tracking
- **Pagination** — automatic cursor/offset pagination helpers
- **URL State** — `@Url` decorator for query string binding
- **Teleport** — render component output into a different DOM location
- **Testing Utilities** — `WireTest` harness for Japa

---

## Contributing

Contributions are welcome! Since the project is in alpha, please open an issue first to discuss what you'd like to change.

```/dev/null/sh#L1-L6
# Clone & install
git clone https://github.com/hackerrahul/adowire.git
cd adowire && npm install

# Build
npm run build

# Lint
npm run lint
```

---

## License

MIT License © [Rahul Gangotri](https://github.com/hackerrahul)
