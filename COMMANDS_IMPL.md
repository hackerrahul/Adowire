# Adowire — Ace Commands & Stubs Implementation Reference

> Use this document when starting a fresh context to implement Phase 11 CLI scaffolding.

---

## Current State (what exists)

| File | Status |
|------|--------|
| `configure.ts` | Empty stub — function body is `{}` |
| `stubs/main.ts` | Only exports `stubsRoot = import.meta.dirname` |
| `stubs/` | No `.stub` files exist at all |
| `commands/` | Directory does not exist |
| `package.json` `exports` | No `./commands` subpath entry |
| `package.json` `tsdown.entry` | Only `index.ts`, `configure.ts`, `providers/wire_provider.ts` |
| `adonisrc.ts` (test app) | No `adowire/commands` in `commands` array |

---

## How AdonisJS v7 Ace Commands Work (researched)

### Pattern from `@adonisjs/core` source

Commands extend `BaseCommand` and use exactly this pattern:

```typescript
import { BaseCommand, args, flags } from '@adonisjs/core/ace'

export default class MakeController extends BaseCommand {
  static commandName = 'make:controller'
  static description = '...'
  static options = { allowUnknownFlags: true }

  @args.string({ description: 'The name' })
  declare name: string

  @flags.boolean({ alias: 'r' })
  declare resource: boolean

  async run() {
    await (await this.createCodemods()).makeUsingStub(stubsRoot, 'make/controller/main.stub', {
      flags: this.parsed.flags,
      entity: this.app.generators.createEntity(this.name),
    })
  }
}
```

### `generators.createEntity(name)` shape

For input `'posts/create'`:
```
entity.name = 'create'   // just the basename
entity.path = 'posts'    // directory portion only
```

For flat input `'counter'`:
```
entity.name = 'counter'
entity.path = ''          // empty string
```

For deeply nested `'examples/components/counter'`:
```
entity.name = 'counter'
entity.path = 'examples/components'
```

### Generator methods available in stubs

```
generators.modelName(entity.name)       → PascalCase  e.g. 'counter' → 'Counter'
generators.modelFileName(entity.name)   → snake_case  e.g. 'myCounter' → 'my_counter'
generators.controllerName(name)         → PascalCase + 'Controller'
generators.middlewareName(name)         → PascalCase + 'Middleware'
```

For adowire we use `modelName` and `modelFileName` (no suffix needed).

### App path helpers available in stubs

Confirmed from `@adonisjs/shield` config stub source:
```
app.configPath('shield.ts')             → config/shield.ts (absolute)
app.makePath('app/adowire', path, file) → absolute path joined
app.httpControllersPath(path, file)     → app/controllers/...
app.middlewarePath(path, file)          → app/middleware/...
app.modelsPath(path, file)              → app/models/...
app.validatorsPath(path, file)          → app/validators/...
```

### Stub file syntax

```
{{#var componentName = generators.modelName(entity.name)}}
{{#var componentFileName = generators.modelFileName(entity.name)}}
{{{
  exports({
    to: app.makePath('app/adowire', entity.path, componentFileName + '.ts')
  })
}}}
import { WireComponent } from 'adowire'

export default class {{ componentName }} extends WireComponent {
  async mount() {}
}
```

- `{{#var name = expr}}` — compute a variable (pure JS expression)
- `{{{ exports({ to: absolutePath }) }}}` — set the output file path
- `{{ varName }}` — interpolate a variable into the output

### `configure.ts` hook pattern

Confirmed from `@adonisjs/shield` source (`index.js`):

```typescript
import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  // 1. Generate config file using stub
  await codemods.makeUsingStub(stubsRoot, 'config/adowire.stub', {})

  // 2. Register provider + commands in adonisrc.ts
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('adowire/wire_provider')
    rcFile.addCommand('adowire/commands')
  })
}
```

### How commands are registered in consuming app

In `adonisrc.ts` of the consuming app:
```typescript
commands: [
  () => import('@adonisjs/core/commands'),
  () => import('@adonisjs/lucid/commands'),
  () => import('adowire/commands'),   // ← configure hook adds this
],
```

The `adowire/commands` subpath resolves to `build/commands/main.js` via package.json exports.

---

## Files to Create

### 1. `stubs/make/component.stub`

Basic wire component class.

Variables passed:
- `entity` from `generators.createEntity(name)`
- Computed: `componentName` (PascalCase), `componentFileName` (snake_case)
- Computed: `wireName` = dot-notation name (e.g. `posts.create`)

Output path: `app/adowire/{entity.path}/{componentFileName}.ts`

Content template:
```
{{#var componentName = generators.modelName(entity.name)}}
{{#var componentFileName = generators.modelFileName(entity.name)}}
{{#var wireName = [entity.path, entity.name].filter(Boolean).join('/').replace(/\//g, '.')}}
{{{
  exports({
    to: app.makePath('app/adowire', entity.path, componentFileName + '.ts')
  })
}}}
import { WireComponent } from 'adowire'

/**
 * Wire component: {{ wireName }}
 *
 * @see resources/views/adowire/{{ wireName.replace(/\./g, '/') }}.edge
 */
export default class {{ componentName }} extends WireComponent {
  // ── Public properties (auto-synced with client snapshot) ─────────────────

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async mount() {}

  // ── Actions ──────────────────────────────────────────────────────────────
}
```

### 2. `stubs/make/page.stub`

Page component with `@Layout` and `@Title` decorators.

Output path: same as component stub.

Content template:
```
{{#var componentName = generators.modelName(entity.name)}}
{{#var componentFileName = generators.modelFileName(entity.name)}}
{{#var wireName = [entity.path, entity.name].filter(Boolean).join('/').replace(/\//g, '.')}}
{{{
  exports({
    to: app.makePath('app/adowire', entity.path, componentFileName + '.ts')
  })
}}}
import { WireComponent, Layout, Title } from 'adowire'

@Title('{{ componentName }}')
@Layout('layouts/adowire')
export default class {{ componentName }} extends WireComponent {
  // ── Public properties (auto-synced with client snapshot) ─────────────────

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async mount() {}

  // ── Actions ──────────────────────────────────────────────────────────────
}
```

### 3. `stubs/make/view.stub`

Edge.js template for the component.

Output path: `resources/views/adowire/{entity.path}/{componentFileName}.edge`

Content template:
```
{{#var componentFileName = generators.modelFileName(entity.name)}}
{{#var wireName = [entity.path, entity.name].filter(Boolean).join('/').replace(/\//g, '.')}}
{{{
  exports({
    to: app.makePath('resources/views/adowire', entity.path, componentFileName + '.edge')
  })
}}}
<div>
  {{-- Wire component: {{ wireName }} --}}
</div>
```

### 4. `stubs/config/adowire.stub`

Config file created by `node ace configure adowire`.

Output path: `config/adowire.ts`

Content template:
```
{{{
  exports({
    to: app.configPath('adowire.ts')
  })
}}}
import type { AdowireConfig } from 'adowire/types'

const adowireConfig: AdowireConfig = {
  /**
   * URL prefix for the Adowire message endpoint.
   * The route POST /adowire/message is registered automatically.
   */
  prefix: '/adowire',

  /**
   * Directory (relative to app root) where wire component classes live.
   */
  componentsPath: 'app/adowire',

  /**
   * Edge.js view prefix. Component 'counter' renders 'adowire/counter.edge'.
   */
  viewPrefix: 'adowire',

  /**
   * Secret used to sign snapshots. Defaults to APP_KEY.
   */
  secret: process.env.APP_KEY,
}

export default adowireConfig
```

### 5. `commands/main.ts`

Re-exports all commands so AdonisJS can discover them via `() => import('adowire/commands')`.

```typescript
export { default as MakeAdowire } from './make_adowire.js'
export { default as AdowireList } from './adowire_list.js'
```

### 6. `commands/make_adowire.ts`

The `node ace make:adowire <name>` command.

```typescript
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { stubsRoot } from '../stubs/main.js'

export default class MakeAdowire extends BaseCommand {
  static commandName = 'make:adowire'
  static description =
    'Create a new Adowire wire component class and its Edge.js view template'
  static options = { allowUnknownFlags: false }

  @args.string({ description: 'Component name (e.g. counter, posts/create)' })
  declare name: string

  @flags.boolean({
    description: 'Generate a page component with @Layout and @Title decorators',
    alias: 'p',
  })
  declare page: boolean

  @flags.boolean({
    description: 'Skip creating the Edge.js view template',
  })
  declare noView: boolean

  async run() {
    const codemods = await this.createCodemods()
    const entity = this.app.generators.createEntity(this.name)

    // 1. Generate the component class
    const stubPath = this.page ? 'make/page.stub' : 'make/component.stub'
    await codemods.makeUsingStub(stubsRoot, stubPath, { entity })

    // 2. Generate the Edge view (unless --no-view)
    if (!this.noView) {
      await codemods.makeUsingStub(stubsRoot, 'make/view.stub', { entity })
    }
  }
}
```

### 7. `commands/adowire_list.ts`

The `node ace adowire:list` command.

```typescript
import { BaseCommand, flags } from '@adonisjs/core/ace'

export default class AdowireList extends BaseCommand {
  static commandName = 'adowire:list'
  static description = 'List all registered Adowire wire components'

  @flags.boolean({ description: 'Output as JSON', alias: 'j' })
  declare json: boolean

  async run() {
    // Resolve the adowire binding — registry is populated during provider boot
    const { registry } = await this.app.container.make('adowire')
    const components = registry.all()   // returns Map<name, ComponentClass> or similar

    if (this.json) {
      this.logger.log(JSON.stringify(components, null, 2))
      return
    }

    if (components.length === 0) {
      this.logger.warning('No wire components found. Run node ace make:adowire <name> to create one.')
      return
    }

    // Pretty table output
    this.logger.log('')
    const table = this.ui.table()
    table.head(['Name', 'Class', 'Path'])
    for (const [name, { file }] of Object.entries(components)) {
      table.row([name, name, file ?? ''])
    }
    table.render()
    this.logger.log('')
  }
}
```

> ⚠️ **Note:** The `registry.all()` method may not exist yet — check `ComponentRegistry` in
> `src/component_registry.ts` and add it if missing. It should return something iterable
> (an array of `{ name, path }` objects or a `Map<string, ComponentDefinition>`).

### 8. Updated `configure.ts`

```typescript
import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  // 1. Publish config/adowire.ts
  await codemods.makeUsingStub(stubsRoot, 'config/adowire.stub', {})

  // 2. Register provider + commands in adonisrc.ts
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('adowire/wire_provider')
    rcFile.addCommand('adowire/commands')
  })

  // 3. Ensure scaffold directories exist
  const appRoot = fileURLToPath(command.app.appRoot)
  await mkdir(join(appRoot, 'app/adowire'), { recursive: true })
  await mkdir(join(appRoot, 'resources/views/adowire'), { recursive: true })

  // 4. Print next steps
  command.logger.success('Adowire configured successfully!')
  command.logger.log('')
  command.logger.log('  Next steps:')
  command.logger.log('    node ace make:adowire counter          # basic component')
  command.logger.log('    node ace make:adowire dashboard --page # page component')
  command.logger.log('    node ace adowire:list                  # list all components')
  command.logger.log('')
}
```

---

## Package.json Changes Required

### Add `./commands` subpath export

```json
"exports": {
  ".":             "./build/index.js",
  "./types":       "./build/src/types.js",
  "./wire_provider": "./build/providers/wire_provider.js",
  "./client":      "./build/adowire.js",
  "./commands":    "./build/commands/main.js"
}
```

### Add `commands/main.ts` to tsdown entry

```json
"tsdown": {
  "entry": [
    "./index.ts",
    "./configure.ts",
    "./providers/wire_provider.ts",
    "./commands/main.ts"
  ],
  ...
}
```

---

## Test App `adonisrc.ts` Change

After running `node ace configure adowire` the configure hook will auto-add this, but
for the test app (`adowire-test`) add it manually since `configure` isn't wired up yet:

```typescript
commands: [
  () => import('@adonisjs/core/commands'),
  () => import('@adonisjs/lucid/commands'),
  () => import('@adonisjs/session/commands'),
  () => import('adowire/commands'),   // ← add this
],
```

---

## ComponentRegistry — Check if `all()` method exists

Before implementing `adowire_list.ts`, check `src/component_registry.ts` for a method
that returns all registered components with their names and file paths.

If it does not exist, add:

```typescript
/**
 * Returns all registered components as an array of { name, path } objects.
 */
all(): Array<{ name: string; path: string }> {
  return Array.from(this.components.entries()).map(([name, def]) => ({
    name,
    path: def.path ?? '',
  }))
}
```

The internal `components` map key type and value shape need to match whatever is
already stored in `ComponentRegistry`. Read the file before adding.

---

## Build Order

1. Create all stub files in `stubs/make/` and `stubs/config/`
2. Create `commands/` directory with `main.ts`, `make_adowire.ts`, `adowire_list.ts`
3. Update `configure.ts`
4. Update `package.json` (exports + tsdown entry)
5. Check `ComponentRegistry.all()` — add if missing
6. Run `npm run compile` in `adowire/`
7. Restart the dev server
8. Test: `node ace make:adowire examples/components/my_test`
9. Test: `node ace adowire:list`
10. Test: `node ace configure adowire` in a fresh AdonisJS project

---

## Key File Paths

```
adokit/adowire/
├── commands/
│   ├── main.ts                  ← re-exports all commands
│   ├── make_adowire.ts          ← node ace make:adowire
│   └── adowire_list.ts          ← node ace adowire:list
├── stubs/
│   ├── main.ts                  ← already exists (exports stubsRoot)
│   ├── config/
│   │   └── adowire.stub         ← config/adowire.ts output
│   └── make/
│       ├── component.stub       ← basic component class
│       ├── page.stub            ← page component (@Layout @Title)
│       └── view.stub            ← edge template
├── configure.ts                 ← node ace configure adowire
├── package.json                 ← needs ./commands export + tsdown entry
└── src/
    └── component_registry.ts   ← may need all() method added
```

---

## Stub Variable Reference

All variables available inside every stub:

| Variable | Type | Description |
|----------|------|-------------|
| `entity.name` | `string` | Basename portion of the input name |
| `entity.path` | `string` | Directory portion (empty string for flat names) |
| `generators` | `object` | AdonisJS name-format helpers |
| `app` | `Application` | AdonisJS app instance (for path resolution) |
| `flags` | `object` | CLI flags passed to the command |

Computed in the stub itself using `{{#var}}`:
| Expression | Result for `posts/create` |
|------------|--------------------------|
| `generators.modelName(entity.name)` | `Create` |
| `generators.modelFileName(entity.name)` | `create` |
| `[entity.path, entity.name].filter(Boolean).join('/').replace(/\//g, '.')` | `posts.create` |

---

## Notes & Gotchas

- Stubs use **Edge.js template syntax** but are processed by the AdonisJS codemods engine,
  not the Edge.js renderer. The `{{{ }}}` triple-braces are for the `exports()` call only.
- `generators.modelFileName` produces `snake_case` without any suffix (unlike
  `controllerFileName` which appends `_controller`). This is correct for adowire.
- The `entity.path` for a flat name like `counter` is `''` (empty string), not `'.'`.
  `app.makePath('app/adowire', '', 'counter.ts')` resolves correctly.
- `app.configPath('adowire.ts')` returns the absolute path to `config/adowire.ts`.
  This was confirmed from `@adonisjs/shield`'s stub source.
- After rebuilding, the chunk filename hash changes (e.g. `wire_provider-DDssbH0U.js`
  becomes something new). The test app will pick up the new file automatically via the
  stable `build/providers/wire_provider.js` re-export.
- Commands built into `build/commands/main.js` by tsdown. Make sure tsdown `external`
  list includes `@adonisjs/core` so it doesn't bundle AdonisJS internals.