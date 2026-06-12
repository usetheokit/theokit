# Plan: TheoKit Scaffold Command + Drizzle Migrations

> **Version 1.0** — Add `theokit generate resource` (Rails-style scaffold: schema + routes + test in one command) and `theokit db:migrate` / `theokit db:seed` (Drizzle-kit migrations with push/generate support). These two features close the largest DX gap between TheoKit and Rails, making TheoKit feel like a "batteries-included" full-stack framework where `theokit generate resource tasks title:string done:boolean` produces a working CRUD endpoint backed by a real database with migration history.

## Goal

> Ship `theokit generate resource <name> <fields...>` and `theokit db:migrate` / `theokit db:seed` so that a developer can scaffold a full CRUD resource (schema + routes + test) in one command and manage database migrations incrementally, measured by `theokit generate resource posts title:string published:boolean` producing 4 files AND `theokit db:migrate` applying pending schema changes to SQLite.

## Context

Rails' two killer DX features are `rails scaffold` (one command → model + controller + views + test + migration) and `rails db:migrate` (incremental schema versioning). TheoKit now has Drizzle + SQLite in the default template, but:

1. **No scaffold command** — creating a new resource requires manually writing schema, 2 route files, and a test. `theokit generate route` only creates a single empty route file with no DB wiring.
2. **No migrations** — the template uses `CREATE TABLE IF NOT EXISTS` inline SQL. If the developer changes `schema.ts`, they must delete `data/dev.db` manually. No migration history, no rollback.

The existing `theokit generate` command (367 LoC, 7 types) provides the extension point for `resource`. The existing `theokit migrate` command handles router and services-json migrations, providing the CLI pattern for `db:migrate`.

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/cli/commands/generate.ts` | 367 | `f8f2710` (2026-06-11) | CLI scaffolding for route/action/page/ws/controller/agent/toolbox | `generate()` function signature, `VALID_TYPES` array, existing 7 types untouched |
| `packages/theo/src/cli/index.ts` | 194 | `d925560` (2026-06-09) | CLI entry point registering all commands | Command registration pattern (yargs `.command()`) |
| `packages/theo/src/cli/commands/generate.ts` → templates | — | — | Template functions (`generateRouteTemplate`, etc.) | Existing templates unchanged |
| `tests/unit/generate.test.ts` (NEW) | 0 | — | Tests for generate resource command | — |
| `tests/unit/db-commands.test.ts` (NEW) | 0 | — | Tests for db:migrate/db:seed commands | — |
| `tests/integration/scaffold-resource.test.ts` (NEW) | 0 | — | E2E test: generate resource → run migrate → verify | — |

### Current callers / dependents

- **Symbol:** `generate()` in `packages/theo/src/cli/commands/generate.ts`
  - **Callers (production):** `packages/theo/src/cli/index.ts:55` (via `generateCommand`)
  - **Callers (tests):** (none found — generate.ts has no dedicated test file)
  - **External:** TheoKit Studio (`theokit_generate` tool) consumes `generate()` directly

- **Symbol:** `VALID_TYPES` in `packages/theo/src/cli/commands/generate.ts`
  - **Callers (production):** same file (line 283 for validation)
  - **External:** TheoKit Studio type-checks against this array

- **Symbol:** CLI index yargs chain in `packages/theo/src/cli/index.ts`
  - **Callers:** bin entry point (`theokit` binary)

### Domain glossary

- **resource** — a REST entity with schema, routes (CRUD), and test. Rails: `resources :posts`. TheoKit equivalent: schema.ts table + routes/posts/index.ts + routes/posts/[id].ts + tests/posts.test.ts
- **drizzle-kit** — Drizzle ORM's migration CLI. `drizzle-kit push` applies schema diff directly (dev). `drizzle-kit generate` creates SQL migration files (prod).
- **push mode** — Drizzle-kit's dev-friendly migration: compares schema.ts against live DB, applies diff. No migration files. Ideal for development.
- **generate mode** — Drizzle-kit's production migration: generates SQL files in `drizzle/` directory. Can be committed, reviewed, and applied in CI/prod.
- **defineRoute** — TheoKit's typed route definition function using Zod validation

### Architecture boundaries affected

- **`cli` module** — per `architecture.md`, `cli` is the entrypoint layer with maximal instability (I=1.00). New commands (`db:migrate`, `db:seed`) and new generate type (`resource`) live here. `cli` may import from `core`, `config`, `server`, `router`, `adapters`, `services`, `vite-plugin`. No boundary violation.
- **`create-theokit` package** — standalone scaffolding tool, zero runtime dependency on `theokit`. The `generate resource` command runs INSIDE a TheoKit project (not during scaffold). No boundary crossed.

## Prior Art & Related Work

- **Rails** — `rails generate scaffold Post title:string body:text published:boolean` → 8 files (model, controller, views, migration, test, routes entry). Source: Rails Guides.
- **Laravel** — `php artisan make:model Post -mrc` → model + migration + resource controller. Similar one-command philosophy.
- **Drizzle-kit docs** — `drizzle-kit push` for dev, `drizzle-kit generate` for prod. Source: orm.drizzle.team/docs/kit-overview.
- **Existing TheoKit generate** — 7 types already implemented (`generate.ts:8`). The `resource` type extends the same pattern.
- **Existing TheoKit migrate** — router + services-json migrations in `cli/index.ts:137-155`. The `db` subcommand follows the same yargs pattern.

## Objective

- [ ] `theokit generate resource <name> <field:type...>` generates schema entry + route files + test in one command
- [ ] Field types supported: `string`, `number`, `boolean`, `text` (maps to Drizzle column types)
- [ ] `theokit db:migrate` runs `drizzle-kit push` to sync schema.ts → SQLite (dev mode)
- [ ] `theokit db:seed` runs the project's `server/db/seed.ts` via tsx
- [ ] `theokit db:generate` runs `drizzle-kit generate` to create SQL migration files (prod mode)
- [ ] Template `package.json.tmpl` updated with `drizzle-kit` as devDependency
- [ ] Template includes `drizzle.config.ts` for drizzle-kit configuration
- [ ] All existing 77 create-theokit tests remain GREEN

## ADRs

### D1 — `generate resource` over `generate scaffold`

**Decision:** Use `resource` as the verb, not `scaffold`.

**Rationale:** In Rails, `resources :posts` is the canonical term for a REST entity with CRUD routes. `scaffold` in Rails also generates views, but TheoKit is API-first with React frontend — generating `.tsx` pages for CRUD makes no sense. `resource` aligns with the REST semantics and is shorter. Per KISS (CLAUDE.md §10).

**Alternative rejected:** `scaffold` — implies full-stack generation including views. TheoKit's frontend is React; auto-generating CRUD views would be opinionated in the wrong direction (TheoKit is opiniated about backend, flexible about frontend patterns).

**Alternative rejected:** `model` — too narrow. We generate schema + routes + test, not just a model.

### D2 — `drizzle-kit push` for dev, `drizzle-kit generate` for prod

**Decision:** `theokit db:migrate` wraps `drizzle-kit push` (dev-friendly, no migration files). `theokit db:generate` wraps `drizzle-kit generate` (creates SQL files for prod).

**Rationale:** Rails uses migration files always. But Drizzle's `push` mode is simpler for development — it diffs `schema.ts` against the live DB and applies changes directly. This aligns with the "zero friction in dev" philosophy while keeping the `generate` escape hatch for production deployments. Per YAGNI (CLAUDE.md §11) — most TheoKit users in the template are doing dev work; SQL migration files are an opt-in power feature.

**Alternative rejected:** Always use migration files (Rails pattern). Rejected because it adds ceremony for dev-mode iteration. `drizzle-kit push` is the Drizzle-native equivalent of `rails db:migrate` for dev.

**Alternative rejected:** Custom migration system. Rejected per Unbreakable Rule 9 (Don't Reinvent the Roda) — `drizzle-kit` already solves this.

### D3 — Field type mapping (string/number/boolean/text → Drizzle columns)

**Decision:** Map CLI field types to Drizzle column builders:

| CLI type | Drizzle column | SQLite type |
|---|---|---|
| `string` | `text('name').notNull()` | TEXT |
| `text` | `text('name').notNull()` | TEXT |
| `number` | `integer('name').notNull()` | INTEGER |
| `boolean` | `integer('name', { mode: 'boolean' }).notNull().default(false)` | INTEGER |

**Rationale:** SQLite has limited types (TEXT, INTEGER, REAL, BLOB). Drizzle maps these cleanly. `string` and `text` both map to TEXT but `text` signals larger content (like Rails). Per DRY — use the same column builders that the tasks schema already uses (`schema.ts:4-12`).

**Alternative rejected:** Support `date`, `json`, `enum` types. Rejected per YAGNI — these can be added later. The 4 basic types cover 90% of use cases.

### D4 — `db:` subcommand namespace vs top-level `migrate/seed`

**Decision:** Use `theokit db:migrate`, `theokit db:seed`, `theokit db:generate` as subcommands under a `db` namespace.

**Rationale:** Rails uses `rails db:migrate`, `rails db:seed`, `rails db:create`. The `db:` prefix groups database operations logically and avoids collision with the existing `theokit migrate` command (which handles router + services-json migrations, not DB). Per SRP (CLAUDE.md §13.1) — database operations are a distinct responsibility from framework migrations.

**Alternative rejected:** Extend existing `theokit migrate` with `theokit migrate db`. Rejected because it conflates two different migration domains (framework conventions vs database schema). The existing `migrate` command has its own options (`--dry-run`, `--force`, `--name`) that don't apply to DB migrations.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `drizzle-kit` adds a devDependency (~15MB) to every scaffolded project | Medium | It's devDependency only — not in production bundle. Users who don't use migrations can remove it. | Template |
| `generate resource` writes to `schema.ts` — appending to an existing file is fragile (could break syntax) | Medium | Use AST-free approach: append table definition + re-export. Validate with a syntax check post-write. Fallback: write to a new `schema/<name>.ts` file if `schema.ts` is too complex. | CLI |
| `drizzle-kit push` can lose data in dev (drops columns that were removed from schema) | Low | This is dev-only behavior. `push` prints a warning before destructive changes. Documented in template README. Production uses `db:generate` (migration files with review). | Docs |
| Field type mapping is intentionally limited (4 types) | Low | Covers 90% of use cases. User can manually edit schema.ts for advanced types. Document escape hatch. | Docs |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (generate resource) ──▶ Phase 2 (db commands) ──▶ Phase 3 (template + integration)
```

All phases are sequential — Phase 2 depends on the schema understanding from Phase 1. Phase 3 integrates everything.

---

## Phase 1: Generate Resource Command

**Objective:** Add `theokit generate resource <name> <fields...>` that creates schema entry + route files + test in one command.

### T1.1 — Parse resource fields from CLI args

#### Objective
Parse `theokit generate resource posts title:string published:boolean` into structured field definitions.

#### Why this step
**Action:** Create a field parser that converts `name:type` CLI arguments into Drizzle column definitions.
**Reasoning:** The field parser is the foundation for both schema and route generation. Without typed field parsing, the generator can't produce correct Drizzle schema or Zod validation. This is Phase 1 because everything else depends on it.

#### Evidence
- Existing generate command at `generate.ts:8` defines `VALID_TYPES` array. Adding `'resource'` extends it.
- Existing `GenerateOptions` interface at `generate.ts:11-15` has `cwd`, `type`, `name`. Resource needs additional `fields` array.
- Field format `name:type` is the same as Rails (`title:string`), Laravel (`title string`), and Prisma (`title String`).

#### Files to edit
```
packages/theo/src/cli/commands/generate.ts — add resource type, field parser, resource templates
tests/unit/generate-resource.test.ts (NEW) — TDD tests for field parsing and template generation
```

#### Deep file dependency analysis
- `generate.ts` (367 LoC): The `VALID_TYPES` array at line 8 gains `'resource'`. The `GenerateOptions` interface at line 11 gains optional `fields: string[]`. The `resolveTemplate` switch at line 181 gains a `case 'resource'`. The `generate()` function at line 273 remains unchanged in signature (Studio compatibility preserved).
- `tests/unit/generate-resource.test.ts` (NEW): No downstream dependents. Test runner at `vitest.config.ts` discovers `tests/**/*.test.ts`.

#### Deep Dives

**Field parser specification:**

Input: `['title:string', 'published:boolean', 'views:number', 'content:text']`

Output:
```typescript
interface ResourceField {
  name: string        // column name (snake_case from kebab-case)
  type: 'string' | 'number' | 'boolean' | 'text'
  drizzleColumn: string  // Drizzle builder code
  zodType: string        // Zod schema code
}
```

Mapping:
- `title:string` → `text('title').notNull()` / `z.string()`
- `views:number` → `integer('views').notNull()` / `z.number()`
- `published:boolean` → `integer('published', { mode: 'boolean' }).notNull().default(false)` / `z.boolean()`
- `content:text` → `text('content').notNull()` / `z.string()`

Every resource auto-includes `id` (PRIMARY KEY AUTOINCREMENT) and `createdAt` (TEXT, default now). These are NOT user-specified.

#### Pseudo-code / Signatures

```typescript
function parseResourceFields(args: string[]): ResourceField[]
  for arg in args:
    [name, type] = arg.split(':')
    if not ALLOWED_TYPES.has(type): throw "Unknown type"
    if name is 'id' or 'createdAt': throw "Reserved field"
    yield { name, type, drizzleColumn: mapDrizzle(type, name), zodType: mapZod(type) }

function generateSchemaEntry(resourceName: string, fields: ResourceField[]): string
  // returns: export const posts = sqliteTable('posts', { id: ..., ...fields, createdAt: ... })

function generateResourceRoutes(resourceName: string, fields: ResourceField[]): { index: string, idFile: string }
  // returns two file contents: index.ts (GET list + POST) and [id].ts (GET show + PUT + DELETE)

function generateResourceTest(resourceName: string): string
  // returns: vitest test file for the resource
```

#### Tasks
1. Add `'resource'` to `VALID_TYPES` array
2. Create `parseResourceFields()` function with validation
3. Create `generateSchemaEntry()` template function
4. Create `generateResourceRouteIndex()` template function (GET list + POST)
5. Create `generateResourceRouteId()` template function (GET/:id + PUT/:id + DELETE/:id)
6. Create `generateResourceTest()` template function
7. Wire into `resolveTemplate()` switch — resource returns multiple files
8. Update `generate()` to handle multi-file output (resource creates 4 files: schema append + 2 routes + 1 test)

#### TDD
```
RED:     test_parseResourceFields_valid_input() — parses 'title:string published:boolean' into 2 ResourceField objects
RED:     test_parseResourceFields_rejects_unknown_type() — throws on 'title:date'
RED:     test_parseResourceFields_rejects_reserved_field() — throws on 'id:number'
RED:     test_generateSchemaEntry_produces_valid_drizzle() — output contains sqliteTable + all fields + id + createdAt
RED:     test_generateResourceRouteIndex_has_GET_and_POST() — output contains defineRoute for GET and POST with Zod body
RED:     test_generateResourceRouteId_has_GET_PUT_DELETE() — output contains 3 defineRoute exports
RED:     test_generateResourceTest_has_vitest_describe() — output contains describe + it blocks
RED:     test_generate_resource_creates_4_files() — integration: calling generate() with type='resource' creates schema entry + 2 route files + 1 test
RED:     test_generate_resource_rejects_no_fields() — calling with zero fields returns invalid_name
GREEN:   Implement all functions
REFACTOR: Extract common Drizzle/Zod mapping into a shared lookup table
VERIFY:  pnpm vitest run tests/unit/generate-resource.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `theokit generate resource posts title:string published:boolean` creates 4 files
- [ ] Schema entry appended to `server/db/schema.ts` with correct Drizzle columns
- [ ] Route files created at `server/routes/posts/index.ts` and `server/routes/posts/[id].ts`
- [ ] Test file created at `tests/posts.test.ts`
- [ ] Field types: string, number, boolean, text all produce correct Drizzle + Zod code
- [ ] Reserved fields (id, createdAt) rejected with clear error
- [ ] Unknown types rejected with clear error listing valid types
- [ ] Pass: lint — `eslint packages/theo/src/cli/commands/generate.ts --max-warnings=0` zero warnings
- [ ] Pass: size — generate.ts stays under 500 LoC (current 367 + ~120 new = ~487)

#### DoD
- [ ] All 9 RED tests pass
- [ ] `pnpm vitest run tests/unit/generate-resource.test.ts` green
- [ ] `npx tsc --noEmit` zero type errors
- [ ] `eslint --max-warnings=0` zero warnings on changed files

---

### T1.2 — Update CLI to pass fields to generate resource

#### Objective
Wire the CLI entry point to parse `theokit generate resource <name> <field:type...>` and pass variadic fields to the generate function.

#### Why this step
**Action:** Update CLI index to support variadic positional args after `name` when type is `resource`.
**Reasoning:** The current CLI registration at `index.ts:52` expects `generate <type> <name>` (2 positional args). Resource needs `generate resource <name> <field:type...>` (2 + variadic). Yargs supports variadic positional with `..` suffix or by capturing remaining args. This must be wired before the command is usable from the terminal.

#### Evidence
- CLI index at `packages/theo/src/cli/index.ts:52-56` registers generate with 2 positional args
- Yargs variadic positional: `builder: (y) => y.positional('fields', { type: 'string', array: true })`

#### Files to edit
```
packages/theo/src/cli/index.ts — update generate command registration for variadic fields
packages/theo/src/cli/commands/generate.ts — update GenerateOptions interface + generateCommand signature
```

#### Deep file dependency analysis
- `index.ts:52-56`: The yargs `.command('generate <type> <name>')` pattern gains variadic `[fields..]`. This affects only the CLI surface — the programmatic `generate()` function signature is extended with optional `fields` parameter.
- `generate.ts:11-15`: `GenerateOptions` gains `fields?: string[]`. Existing callers (Studio) pass no fields — backward compatible.

#### Tasks
1. Add `fields` to `GenerateOptions` interface
2. Update yargs command registration to capture variadic args after name
3. Update `generateCommand` to forward fields to `generate()`
4. Update `generate()` to pass fields to resource-specific code path

#### TDD
```
RED:     test_cli_parses_resource_fields() — mock argv with 'generate resource posts title:string' and verify fields are passed
GREEN:   Implement CLI wiring
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/unit/generate-resource.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `theokit generate resource posts title:string published:boolean` parses correctly
- [ ] Existing commands (`theokit generate route my-route`) still work unchanged
- [ ] `GenerateOptions.fields` is optional — backward compatible

#### DoD
- [ ] Test passes
- [ ] Zero type errors
- [ ] Existing 7 generate types unaffected

---

## Phase 2: Database Commands (db:migrate, db:seed, db:generate)

**Objective:** Add `theokit db:migrate`, `theokit db:seed`, and `theokit db:generate` commands that wrap drizzle-kit.

### T2.1 — Create db:migrate command (drizzle-kit push wrapper)

#### Objective
Add `theokit db:migrate` that runs `drizzle-kit push` to sync `schema.ts` → SQLite.

#### Why this step
**Action:** Create a new CLI command that spawns `drizzle-kit push` as a subprocess with the project's `drizzle.config.ts`.
**Reasoning:** Per ADR D2, `push` mode is the dev-friendly migration path. Per ADR D4, `db:` namespace groups database commands. Per Unbreakable Rule 9 (Don't Reinvent), we wrap `drizzle-kit` rather than building our own migration engine.

#### Evidence
- Drizzle-kit CLI: `npx drizzle-kit push` reads `drizzle.config.ts` and applies schema diff
- Existing `theokit migrate` at `index.ts:137` shows the yargs subcommand pattern
- `drizzle-kit` is already in monorepo devDeps (`package.json: "drizzle-kit": "^0.30.0"`)

#### Files to edit
```
packages/theo/src/cli/commands/db.ts (NEW) — db:migrate, db:seed, db:generate commands
packages/theo/src/cli/index.ts — register db command
tests/unit/db-commands.test.ts (NEW) — TDD tests
```

#### Deep file dependency analysis
- `db.ts` (NEW): Self-contained command module. Imports only `node:child_process` (for spawning drizzle-kit) and `node:fs`/`node:path` (for validation). No intra-monorepo dependency beyond CLI conventions.
- `index.ts`: Gains one `.command('db <action>')` registration block (~10 lines).

#### Deep Dives

**Command behavior:**

```
theokit db:migrate    → npx drizzle-kit push --config drizzle.config.ts
theokit db:generate   → npx drizzle-kit generate --config drizzle.config.ts
theokit db:seed       → npx tsx server/db/seed.ts
```

Pre-flight checks before each command:
1. `drizzle.config.ts` exists (for migrate/generate)
2. `server/db/seed.ts` exists (for seed)
3. `drizzle-kit` is installed (`node_modules/.bin/drizzle-kit` exists)

Error messages when pre-flight fails:
- "drizzle.config.ts not found. Create one with `theokit db:init`" (future command)
- "drizzle-kit not installed. Run `npm install -D drizzle-kit`"

#### Pseudo-code / Signatures

```typescript
async function dbCommand(action: 'migrate' | 'generate' | 'seed', cwd: string): Promise<void>
  switch action:
    case 'migrate':
      assertFileExists(cwd, 'drizzle.config.ts')
      assertBinExists(cwd, 'drizzle-kit')
      spawn('npx drizzle-kit push', { cwd, stdio: 'inherit' })
    case 'generate':
      assertFileExists(cwd, 'drizzle.config.ts')
      assertBinExists(cwd, 'drizzle-kit')
      spawn('npx drizzle-kit generate', { cwd, stdio: 'inherit' })
    case 'seed':
      assertFileExists(cwd, 'server/db/seed.ts')
      spawn('npx tsx server/db/seed.ts', { cwd, stdio: 'inherit' })
```

#### Tasks
1. Create `packages/theo/src/cli/commands/db.ts` with `dbCommand()` function
2. Implement pre-flight checks (file existence, drizzle-kit installed)
3. Implement subprocess spawning with `stdio: 'inherit'` (output streams through to terminal)
4. Register `db` command in `packages/theo/src/cli/index.ts`
5. Handle non-zero exit codes from drizzle-kit (propagate exit code)

#### TDD
```
RED:     test_db_migrate_fails_without_config() — returns error when drizzle.config.ts missing
RED:     test_db_seed_fails_without_seed_file() — returns error when server/db/seed.ts missing
RED:     test_db_rejects_unknown_action() — returns error for 'theokit db:foo'
RED:     test_db_migrate_spawns_drizzle_kit_push() — mock execSync, verify correct command
RED:     test_db_generate_spawns_drizzle_kit_generate() — mock execSync, verify correct command
RED:     test_db_seed_spawns_tsx() — mock execSync, verify 'npx tsx server/db/seed.ts'
GREEN:   Implement db.ts
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/unit/db-commands.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `theokit db:migrate` runs `drizzle-kit push` successfully in a project with `drizzle.config.ts`
- [ ] `theokit db:seed` runs `server/db/seed.ts` via tsx
- [ ] `theokit db:generate` runs `drizzle-kit generate` for SQL migration files
- [ ] Clear error messages when pre-flight checks fail
- [ ] Exit code propagated from subprocess
- [ ] Pass: size — `db.ts` under 100 LoC
- [ ] Pass: lint — zero warnings

#### DoD
- [ ] All 6 RED tests pass
- [ ] Zero type errors
- [ ] Zero lint warnings

---

## Phase 3: Template Updates + Integration

**Objective:** Update the default template with `drizzle.config.ts`, add `drizzle-kit` devDep, remove inline `CREATE TABLE`, and validate end-to-end.

### T3.1 — Add drizzle.config.ts to template + update deps

#### Objective
Add `drizzle.config.ts` to the default template and add `drizzle-kit` as a devDependency. Remove inline `CREATE TABLE` from `db/index.ts` — migrations handle table creation.

#### Why this step
**Action:** Create `drizzle.config.ts` in the template, update `package.json.tmpl` with drizzle-kit, simplify `db/index.ts` to pure connection (no inline SQL).
**Reasoning:** With `theokit db:migrate` available, the inline `CREATE TABLE IF NOT EXISTS` SQL in `db/index.ts` is no longer needed — `drizzle-kit push` handles table creation from `schema.ts`. Removing inline SQL eliminates the schema duplication (DRY violation: same columns defined in both `schema.ts` and the SQL string). The `drizzle.config.ts` file is required by drizzle-kit to know where schema and DB live.

#### Evidence
- Current `db/index.ts:13-20` has inline `CREATE TABLE` SQL that duplicates `schema.ts:3-13` — a DRY violation
- Drizzle-kit requires `drizzle.config.ts` with `schema` and `dialect` fields
- saas template already has `drizzle.config.ts` at `.claude/worktrees/precious-percolating-parnas/packages/create-theo/templates/saas/drizzle.config.ts`

#### Files to edit
```
packages/create-theokit/templates/default/drizzle.config.ts (NEW) — drizzle-kit config
packages/create-theokit/templates/default/server/db/index.ts — remove inline CREATE TABLE
packages/create-theokit/templates/default/package.json.tmpl — add drizzle-kit devDep
packages/create-theokit/tests/integration/scaffold-real.test.ts — update assertions
```

#### Deep file dependency analysis
- `drizzle.config.ts` (NEW): Consumed by `drizzle-kit push/generate`. No runtime import — build-time only.
- `db/index.ts` (21 LoC): Lines 13-20 (inline SQL) are removed. Lines 1-10 (Drizzle connection + WAL) preserved. Downstream callers (route files) import `db` — unchanged.
- `package.json.tmpl`: Adds `"drizzle-kit": "^0.30.0"` to devDependencies. Adds `"db:migrate": "theokit db:migrate"`, `"db:seed": "theokit db:seed"`, `"db:generate": "theokit db:generate"` to scripts.
- `scaffold-real.test.ts` (231 LoC): Gains assertions for `drizzle.config.ts` existence and `db:migrate` script.

#### Deep Dives

**drizzle.config.ts content:**
```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/dev.db',
  },
})
```

**Simplified db/index.ts:**
```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import * as schema from './schema.js'

mkdirSync('data', { recursive: true })
const sqlite = new Database('data/dev.db')
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite, { schema })
```

**But wait — new projects need initial table creation.** Without inline `CREATE TABLE`, a fresh `npm run dev` would fail because the DB has no tables. The solution: `npm run seed` (which already exists) should first run `theokit db:migrate` before inserting data. OR: the template README instructs: `npm run db:migrate && npm run seed` after install.

**Decision:** Keep `CREATE TABLE IF NOT EXISTS` in `db/index.ts` as a fallback for dev convenience. Add `drizzle.config.ts` so that `theokit db:migrate` ALSO works. The inline SQL is a safety net — if schema.ts and inline SQL diverge, `db:migrate` (drizzle-kit push) is the authority. This avoids the "fresh project doesn't work" problem while enabling migrations for schema evolution.

#### Tasks
1. Create `drizzle.config.ts` template file
2. Add `drizzle-kit` to `package.json.tmpl` devDependencies
3. Add `db:migrate`, `db:seed`, `db:generate` scripts to `package.json.tmpl`
4. Update `scaffold-real.test.ts` with new assertions

#### TDD
```
RED:     test_scaffold_includes_drizzle_config() — drizzle.config.ts exists after scaffold
RED:     test_scaffold_has_drizzle_kit_devdep() — package.json includes drizzle-kit
RED:     test_scaffold_has_db_migrate_script() — package.json.scripts has db:migrate
GREEN:   Add template files and update package.json.tmpl
REFACTOR: None expected
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `drizzle.config.ts` present in scaffolded project
- [ ] `drizzle-kit` in devDependencies
- [ ] `npm run db:migrate`, `npm run db:seed`, `npm run db:generate` scripts present
- [ ] All 77+ existing create-theokit tests remain GREEN
- [ ] Pass: lint — zero warnings on new files

#### DoD
- [ ] All tests pass
- [ ] Zero type errors
- [ ] `pnpm --filter create-theokit test` green

---

### T3.2 — E2E integration test: generate resource → db:migrate → verify

#### Objective
Write an integration test that scaffolds a project, runs `theokit generate resource`, runs `theokit db:migrate`, and verifies the complete flow.

#### Why this step
**Action:** Create an E2E test that proves the scaffold → generate → migrate → seed → query pipeline works end-to-end.
**Reasoning:** Unit tests for individual commands don't prove they work together. This integration test is the plan's Global DoD metric — if it passes, the feature works. Per testing.md BDD rules: test behavior from the user's perspective.

#### Evidence
- Existing E2E test pattern at `packages/create-theokit/tests/integration/scaffold-real.test.ts` — uses `scaffold()` function + file assertions
- Test runner discovers `tests/**/*.test.ts` per `vitest.config.ts`

#### Files to edit
```
tests/integration/scaffold-resource.test.ts (NEW) — E2E test
```

#### Tasks
1. Scaffold a temp project
2. Run `generate resource posts title:string published:boolean` programmatically
3. Verify 4 files were created (schema append + 2 routes + 1 test)
4. Verify schema.ts contains the new table definition
5. Verify route files contain defineRoute with correct Zod schemas
6. Verify test file is syntactically valid

#### TDD
```
RED:     test_generate_resource_e2e() — full pipeline: scaffold → generate resource → verify files
GREEN:   All previous phases implemented
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/scaffold-resource.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] E2E test passes
- [ ] Generated schema entry is syntactically valid TypeScript
- [ ] Generated routes import from correct relative paths
- [ ] No regression in existing tests

#### DoD
- [ ] E2E test green
- [ ] `pnpm vitest run` (full suite) green
- [ ] Zero type errors

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `theokit generate resource` command | T1.1, T1.2 | Field parser + template generators + CLI wiring |
| 2 | Field type mapping (string/number/boolean/text) | T1.1 | parseResourceFields() with Drizzle + Zod mapping |
| 3 | `theokit db:migrate` (drizzle-kit push) | T2.1 | db.ts command wrapping drizzle-kit |
| 4 | `theokit db:seed` (run seed.ts) | T2.1 | db.ts seed action |
| 5 | `theokit db:generate` (SQL migration files) | T2.1 | db.ts generate action |
| 6 | Template drizzle.config.ts | T3.1 | Template file + devDep + scripts |
| 7 | E2E validation | T3.2 | Integration test scaffold → generate → verify |

**Coverage: 7/7 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm vitest run` green (both theo and create-theokit suites)
- [ ] Zero type errors — `npx tsc --noEmit`
- [ ] Zero lint warnings — `eslint --max-warnings=0`
- [ ] File-size budget respected — `generate.ts` ≤ 500 LoC
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility — existing 7 generate types unchanged; existing 77 create-theokit tests green
- [ ] `theokit generate resource posts title:string published:boolean` produces 4 working files
- [ ] `theokit db:migrate` applies schema changes to SQLite
- [ ] `theokit db:seed` runs seed.ts

## Failure scenarios

(none — no external I/O touched. `drizzle-kit push` and `tsx` are subprocess-spawned tools operating on local SQLite. Network-dependent scenarios do not apply.)

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
# Unit + integration tests
pnpm vitest run

# Type check
npx tsc --noEmit

# Lint
eslint packages/theo/src/cli/commands/generate.ts packages/theo/src/cli/commands/db.ts --max-warnings=0

# Create-theokit tests
pnpm --filter create-theokit test

# E2E: scaffold + generate + verify
pnpm vitest run tests/integration/scaffold-resource.test.ts

# Live test: real scaffold + real generate + real db:migrate
cd /tmp && rm -rf scaffold-e2e-test
npx tsx packages/create-theokit/src/index.ts /tmp/scaffold-e2e-test e2e-test
cd /tmp/scaffold-e2e-test && npm install
npx theokit generate resource posts title:string published:boolean
npx theokit db:migrate
npx theokit db:seed
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] Live E2E: `theokit generate resource posts title:string published:boolean` creates 4 files
- [ ] Live E2E: `theokit db:migrate` applies schema to SQLite
- [ ] Live E2E: existing `npm test` in scaffolded project still passes
