# Contributing to Adowire

Thank you for your interest in contributing to **Adowire** — a reactive component system for AdonisJS v7 + Edge.js v6. Every contribution matters, whether it's fixing a typo, reporting a bug, or building an entire feature.

> **Adowire is in alpha (`0.x.x`).** The API surface is still evolving, so please **open an issue before starting work on large features** so we can discuss the approach and avoid duplicated effort.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Code of Conduct](#code-of-conduct)
- [Questions](#questions)

---

## Getting Started

1. **Fork** the repository on GitHub:
   [https://github.com/hackerrahul/adowire](https://github.com/hackerrahul/adowire)

2. **Clone** your fork locally:

   ```sh
   git clone https://github.com/<your-username>/adowire.git
   cd adowire
   ```

3. **Add the upstream remote** so you can pull future changes:

   ```sh
   git remote add upstream https://github.com/hackerrahul/adowire.git
   ```

4. **Keep your fork updated** before starting new work:

   ```sh
   git checkout main
   git pull upstream main
   git push origin main
   ```

---

## Development Setup

### Prerequisites

| Requirement | Minimum Version |
| ----------- | --------------- |
| Node.js     | **>= 24.0.0**  |
| npm         | Ships with Node |

### Install dependencies

```sh
npm install
```

### Available scripts

| Script               | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `npm run build`      | Full production build (lint → compile → client bundle) |
| `npm run compile`    | Compile server + client, emit declarations, copy stubs |
| `npm run lint`       | Run ESLint across the entire project                  |
| `npm run typecheck`  | Run `tsc --noEmit` to verify types without emitting   |
| `npm test`           | Lint first, then run tests with c8 coverage           |
| `npm run quick:test` | Run tests only (skip lint), useful while iterating    |
| `npm run format`     | Format all files with Prettier                        |

A typical development loop looks like:

```sh
# 1. Make your changes
# 2. Type-check
npm run typecheck
# 3. Run tests
npm run quick:test
# 4. Lint
npm run lint
```

---

## Making Changes

1. **Create a feature branch** from `main`:

   ```sh
   git checkout -b feat/my-new-feature
   ```

2. **Use a descriptive branch name** with one of these prefixes:

   | Prefix      | Purpose                            |
   | ----------- | ---------------------------------- |
   | `feat/`     | New feature                        |
   | `fix/`      | Bug fix                            |
   | `docs/`     | Documentation only                 |
   | `refactor/` | Code restructuring (no new feature / no bug fix) |
   | `test/`     | Adding or updating tests           |
   | `chore/`    | Tooling, CI, dependencies, etc.    |

3. **Make your changes.** Keep each commit focused on a single logical change.

4. **Run the checks** before pushing:

   ```sh
   npm run typecheck
   npm test
   ```

5. **Push your branch** to your fork:

   ```sh
   git push origin feat/my-new-feature
   ```

6. **Open a Pull Request** against `main` on the upstream repository.

---

## Commit Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This keeps the git history readable and powers automated changelogs via `release-it`.

### Format

```
<type>(<optional scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | A new feature                                           |
| `fix`      | A bug fix                                               |
| `docs`     | Documentation changes only                              |
| `style`    | Formatting, missing semicolons, etc. (no logic changes) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                                 |
| `test`     | Adding or correcting tests                              |
| `chore`    | Build process, CI, dependency bumps, tooling            |

### Scopes (optional but encouraged)

| Scope        | Area                                           |
| ------------ | ---------------------------------------------- |
| `client`     | Client-side runtime (`client/`)                |
| `core`       | Server-side core engine (`src/`)               |
| `cli`        | Ace commands (`commands/`)                      |
| `directives` | Client-side directives (`client/directives/`)  |
| `decorators` | TypeScript decorators (`src/decorators/`)      |
| `edge`       | Edge.js integration (`src/edge/`)              |
| `docs`       | Documentation and guides                       |

### Examples

```
feat(directives): add wire:transition directive

fix(core): prevent double-mount on nested components

docs: add examples for @Validate decorator

chore(cli): update commands.json schema

test(core): add snapshot round-trip tests
```

### Breaking changes

If your change introduces a breaking API change, add a `BREAKING CHANGE:` footer:

```
feat(core)!: rename WireComponent#$refresh to WireComponent#$commit

BREAKING CHANGE: `$refresh()` has been renamed to `$commit()`.
Update all component classes that call `this.$refresh()`.
```

---

## Pull Request Process

### PR title

Use the same Conventional Commits format for the PR title (e.g. `feat(client): add morph key diffing`). The PR will be **squash-merged**, so the title becomes the final commit message.

### PR description

Please fill in the following template when opening a PR:

```markdown
## What
<!-- What does this PR do? -->

## Why
<!-- Why is this change needed? Link to an issue if one exists. -->

## How
<!-- Brief explanation of the approach / implementation. -->

## Testing
<!-- How did you verify this works? New tests? Manual steps? -->

## Related Issues
<!-- e.g. Closes #42, Relates to #15 -->
```

### What happens after you open a PR

1. **CI runs automatically** — lint, typecheck, and tests must all pass on Ubuntu and Windows with Node 24.
2. **All review conversations must be resolved** before merging.
3. **Your branch must be up to date with `main`.**
4. A maintainer will review your code and may request changes.
5. Once approved, the PR is **squash-merged** into `main`.

### If CI fails

Check the failing job's logs in the GitHub Actions tab. Common fixes:

- **Lint failures** → run `npm run lint` locally and fix the reported issues, or run `npm run format` for style-only problems.
- **Typecheck failures** → run `npm run typecheck` and resolve any TypeScript errors.
- **Test failures** → run `npm run quick:test` to reproduce locally.

### Updating your PR

If `main` has moved ahead, rebase your branch instead of merging:

```sh
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin feat/my-new-feature
```

---

## Coding Standards

### TypeScript

- **Strict TypeScript** — the project extends `@adonisjs/tsconfig/tsconfig.package.json` with strict checks. Do not use `any` unless absolutely unavoidable (and leave a comment explaining why).
- Use `emitDecoratorMetadata` patterns where needed — the project relies on `reflect-metadata`.

### Naming conventions

| Element               | Convention    | Example                     |
| --------------------- | ------------- | --------------------------- |
| Files & directories   | `snake_case`  | `component_registry.ts`     |
| Variables & functions | `camelCase`   | `handleRequest`             |
| Classes               | `PascalCase`  | `WireComponent`             |
| Internal / private    | `$` prefix    | `$snapshot`, `$commit`      |
| Constants (metadata)  | `UPPER_SNAKE` | `WIRE_COMPUTED_KEY`          |

### Edge templates

- Adowire Edge tags (`@adowire`, `@wireScripts`, `@wireStyles`, `@error` / `@enderror`) live in `src/edge/tags/`. Follow the existing tag registration pattern when adding new ones.
- Template stubs for scaffolding live in `stubs/`. If you change the generated output, update the corresponding `.stub` file.

### Tests

- Tests use [Japa](https://japa.dev/) (v5) with the `@japa/assert` plugin.
- Test files live in `tests/` and must end with `.spec.ts`.
- Run the full suite with `npm test` (includes lint) or `npm run quick:test` (tests only).
- Aim for meaningful coverage — focus on behaviour, not line counts.

### Linting & formatting

- ESLint config: `@adonisjs/eslint-config` (see `eslint.config.js`).
- Prettier config: `@adonisjs/prettier-config` (configured in `package.json`).
- Run `npm run format` to auto-format before committing.

---

## Project Structure

```
adowire/
├── client/                     # Client-side runtime (bundled to adowire.js)
│   ├── directives/             #   wire:model, wire:click, wire:poll, etc.
│   ├── alpine_bridge.ts        #   Alpine.js $wire bridge
│   ├── component.ts            #   Client-side component class
│   ├── connection.ts           #   AJAX transport layer
│   ├── morph.ts                #   DOM morphing (morphdom wrapper)
│   └── index.ts                #   Client entrypoint
│
├── commands/                   # Ace CLI commands
│   ├── make_adowire.ts         #   node ace make:adowire
│   ├── adowire_list.ts         #   node ace adowire:list
│   ├── adowire_layout.ts       #   node ace adowire:layout
│   ├── adowire_move.ts         #   node ace adowire:move
│   ├── adowire_delete.ts       #   node ace adowire:delete
│   ├── adowire_stubs.ts        #   node ace adowire:stubs
│   └── main.ts                 #   Command loader
│
├── providers/
│   └── wire_provider.ts        # AdonisJS service provider
│
├── src/                        # Server-side core
│   ├── concerns/               #   Mixins / shared concerns
│   ├── decorators/             #   @Computed, @Locked, @Layout, @Title, @Validate
│   ├── edge/                   #   Edge.js plugin + tags (@adowire, @wireScripts, etc.)
│   │   └── tags/               #     Individual tag implementations
│   ├── synthesizers/           #   Date, Map, Set serialisation for snapshots
│   ├── component.ts            #   WireComponent base class
│   ├── component_registry.ts   #   Component discovery & registry
│   ├── request_handler.ts      #   AJAX request handler
│   ├── snapshot.ts             #   Snapshot / checksum logic
│   ├── types.ts                #   Shared TypeScript types & metadata keys
│   ├── validator.ts            #   VineJS validation integration
│   └── wire_exception.ts       #   Custom exception classes
│
├── stubs/                      # Scaffold stubs (config, make)
├── tests/                      # Japa test suite
├── configure.ts                # `node ace configure adowire` hook
├── index.ts                    # Package entrypoint (re-exports)
├── package.json
├── tsconfig.json
└── PLAN.md                     # Full build plan & feature roadmap
```

### Key areas to contribute

| Area                | What to look at                       | Good for                         |
| ------------------- | ------------------------------------- | -------------------------------- |
| **Directives**      | `client/directives/`                  | Adding new `wire:*` attributes   |
| **Decorators**      | `src/decorators/`                     | New TypeScript property decorators |
| **Core engine**     | `src/component.ts`, `src/snapshot.ts` | Lifecycle, state, rendering      |
| **CLI commands**    | `commands/`                           | Improving scaffolding & DX       |
| **Bug fixes**       | `src/`, `client/`                     | Squashing reported issues        |
| **Documentation**   | `README.md`, doc comments             | Guides, examples, JSDoc          |
| **Tests**           | `tests/`                              | Increasing coverage              |

---

## Reporting Bugs

Open an issue at [github.com/hackerrahul/adowire/issues](https://github.com/hackerrahul/adowire/issues) and include:

1. **Adowire version** (`npm ls adowire`)
2. **Node.js version** (`node -v`)
3. **AdonisJS and Edge.js versions** (`npm ls @adonisjs/core edge.js`)
4. **Steps to reproduce** — minimal code or a repository link is ideal
5. **Expected behaviour** — what you expected to happen
6. **Actual behaviour** — what actually happened
7. **Stack trace / error output** — paste the full error if applicable

The more detail you provide, the faster we can fix it.

---

## Suggesting Features

Before opening a feature request, **check [`PLAN.md`](./PLAN.md)** — the feature may already be planned for a future build phase.

If the feature is not listed (or you have a different take on it), open an issue and include:

1. **Problem** — What limitation or pain point are you experiencing?
2. **Proposed solution** — How do you envision this working?
3. **Alternatives considered** — What other approaches did you think about?
4. **Examples** — Code snippets, mockups, or links to similar features in other frameworks.

> **Reminder:** Adowire is in alpha. Please open an issue to discuss large features _before_ investing significant time in implementation. This helps us coordinate and ensures your work aligns with the project direction.

---

## Code of Conduct

Be respectful. We are building this together.

- Treat every contributor with kindness and professionalism.
- Provide constructive feedback — critique the code, not the person.
- Welcome newcomers and help them get started.
- No harassment, trolling, or discriminatory language of any kind.

We reserve the right to remove anyone who violates these principles from the project.

---

## Questions

- **General questions & discussions** — use [GitHub Discussions](https://github.com/hackerrahul/adowire/discussions).
- **Bug reports & feature requests** — use [GitHub Issues](https://github.com/hackerrahul/adowire/issues).

Thank you for helping make Adowire better! 🚀