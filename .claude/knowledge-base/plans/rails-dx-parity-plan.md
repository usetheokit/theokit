# Plan: Rails DX Parity — Tests, Resources Routing, DB, Seeds

> **Version 1.0** — Add 4 Rails-inspired features to the default template: test file example, `resources()` route helper, database integration (Drizzle + SQLite), and seeds file. Each makes TheoKit feel more "batteries-included" like Rails.

## Goal

> Ship tests, resources routing, DB integration, and seeds in the default template so that `npx create-theokit my-app` generates a project with a passing test, typed DB schema, seed data, and organized REST routes, measured by `theokit dev` serving tasks from SQLite AND `npm test` passing.

## Context

Rails `rails new` generates tests, DB config (SQLite default), seeds, and `resources :articles` for organized routing. TheoKit's template has none of these. The current `store.ts` uses in-memory arrays — data is lost on restart. Adding these features aligns with the "batteries-included" Rails philosophy.

## Baseline Context

### Files that will be touched

| File | LoC today | Why it exists | Action |
|---|---|---|---|
| `templates/default/server/store.ts` | ~50 | In-memory data store | REPLACE with Drizzle + SQLite |
| `templates/default/server/routes/health.ts` | ~10 | defineRoute example | Keep |
| `templates/default/server/routes/tasks.ts` (NEW) | 0 | Resources-style REST routes via defineRoute | Create |
| `templates/default/server/db/schema.ts` (NEW) | 0 | Drizzle schema definition | Create |
| `templates/default/server/db/index.ts` (NEW) | 0 | DB connection (SQLite default) | Create |
| `templates/default/server/db/seed.ts` (NEW) | 0 | Seed data (like Rails db/seeds.rb) | Create |
| `templates/default/tests/tasks.test.ts` (NEW) | 0 | Example test for tasks API | Create |
| `templates/default/package.json.tmpl` | ~30 | Template deps | Add drizzle, better-sqlite3, vitest |
| `templates/default/theo.config.ts` | ~10 | Framework config | Add DB config if needed |

### Domain glossary

- **Resources routing** — REST convention: one declaration generates GET/POST/PUT/DELETE routes for a resource (Rails: `resources :tasks`)
- **Seeds** — initial data loaded into DB for development (Rails: `db/seeds.rb`, run with `rails db:seed`)
- **Drizzle** — TypeScript ORM, type-safe, lightweight (TheoKit's opiniated choice over Prisma)
- **defineRoute** — TheoKit's typed route definition function

## Prior Art

- **Rails** — `rails new` generates `test/`, `db/seeds.rb`, `db/migrate/`, `config/routes.rb` with `resources`
- **Next.js** — no DB, no seeds, no tests in template (TheoKit goes beyond Next.js here)
- **Remix** — no DB in default template, but has loader/action pattern

## Objective

- [ ] `tests/tasks.test.ts` — example test that runs with `npm test`
- [ ] `server/routes/tasks.ts` — REST routes organized as resources (GET list, GET :id, POST, PUT :id, DELETE :id)
- [ ] `server/db/schema.ts` — Drizzle schema for tasks table
- [ ] `server/db/index.ts` — SQLite connection via Drizzle
- [ ] `server/db/seed.ts` — seed data (4 initial tasks)
- [ ] `package.json` — add drizzle-orm, better-sqlite3, vitest
- [ ] `npm test` passes on scaffolded project
- [ ] Data persists across server restarts (SQLite file)

## ADRs

### D1 — Drizzle over Prisma for default ORM

**Decision:** Use `drizzle-orm` + `better-sqlite3` as the default DB stack.

**Rationale:** Drizzle is TypeScript-native (schema-as-code), lightweight (no binary, no codegen), and aligns with TheoKit's "Zod is SSoT" philosophy — schema defined in TS, types inferred. Prisma requires a DSL file + codegen step.

**Alternative rejected:** Prisma. Rejected: requires `prisma generate` build step, separate `.prisma` DSL file, heavy binary. Rails-style "just works" needs zero build steps for DB.

**Alternative rejected:** No DB (current state). Rejected: data lost on restart, not realistic for demo/dogfood.

### D2 — defineRoute for resources, not @Controller

**Decision:** Template REST routes use `defineRoute` in `server/routes/tasks.ts`, not `@Controller` in `server/controllers/tasks.controller.ts`.

**Rationale:** The `@Controller` pattern requires `@swc/core` for parameter decorators. `defineRoute` works with zero build tools — simpler for the default template. Keep `@Controller` as the advanced pattern shown in the feature cards.

**Alternative rejected:** Both patterns for the same resource. Rejected: confusing — two files serving `/api/tasks` would conflict.

### D3 — SQLite as default DB (like Rails)

**Decision:** SQLite via `better-sqlite3` as default. DB file at `./data/dev.db`.

**Rationale:** Rails uses SQLite as default. Zero server setup, zero config, file-based persistence. Dev can switch to Postgres by changing the connector — Drizzle supports both with same schema.

**Alternative rejected:** Postgres as default. Rejected: requires running Postgres server — violates "3 commands to running app".

### D4 — Vitest for template tests

**Decision:** `vitest` as test runner in the template.

**Rationale:** Already used by TheoKit framework (700+ tests). `npm test` → `vitest run`. Zero config (vitest auto-discovers `.test.ts` files).

**Alternative rejected:** Bun test. Rejected: Bun doesn't support `emitDecoratorMetadata` — tests with decorators would fail.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `better-sqlite3` requires native compilation | Medium | Already optional peerDep; template adds it explicitly | Template |
| Drizzle adds learning curve | Low | Schema-as-code is intuitive for TS devs; single file | Template |
| SQLite not for production multi-instance | Low | Template README says "switch to Postgres for production" | Docs |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (DB schema + connection) ──▶ Phase 2 (routes + seeds) ──▶ Phase 3 (tests + cleanup)
```

---

## Phase 1: Database Integration

**Objective:** Add Drizzle + SQLite to the template with a tasks schema.

### T1.1 — Create DB schema and connection

#### Objective
Add `server/db/schema.ts` (Drizzle table definition) and `server/db/index.ts` (SQLite connection).

#### Files to edit
```
templates/default/server/db/schema.ts (NEW) — tasks table schema
templates/default/server/db/index.ts (NEW) — SQLite connection + auto-migrate
templates/default/package.json.tmpl — add drizzle-orm, better-sqlite3
```

#### TDD
```
RED:     test_db_connection_creates_file() — SQLite file created on connect
RED:     test_schema_has_tasks_table() — tasks table exists after migrate
GREEN:   Implement schema.ts + index.ts
VERIFY:  npm test in scaffolded project
```

#### Acceptance Criteria
- [ ] `server/db/schema.ts` defines tasks table (id, title, priority, done, createdAt)
- [ ] `server/db/index.ts` connects to `./data/dev.db` and auto-creates tables
- [ ] `data/` added to `.gitignore` template (DB files are local)
- [ ] `drizzle-orm` and `better-sqlite3` in template dependencies

---

## Phase 2: Resources Routes + Seeds

**Objective:** Replace in-memory store with DB-backed routes, add seed data.

### T2.1 — Resources-style REST routes via defineRoute

#### Objective
Create `server/routes/tasks.ts` with 5 REST routes using `defineRoute`, backed by Drizzle queries. Remove `server/controllers/tasks.controller.ts` and `server/store.ts`.

#### Files to edit
```
templates/default/server/routes/tasks.ts (NEW) — GET list, GET :id, POST, PUT :id, DELETE :id
templates/default/server/controllers/tasks.controller.ts — DELETE
templates/default/server/store.ts — DELETE
templates/default/server/index.ts — update barrel
templates/default/theo.config.ts — remove httpDecoratorsPlugin (no more controllers)
```

#### Acceptance Criteria
- [ ] `GET /api/tasks` returns all tasks from SQLite
- [ ] `GET /api/tasks/:id` returns one task
- [ ] `POST /api/tasks` creates task with Zod validation
- [ ] `PUT /api/tasks/:id` updates task
- [ ] `DELETE /api/tasks/:id` deletes task
- [ ] `server/controllers/` directory removed (defineRoute only)
- [ ] `server/store.ts` removed (DB replaces in-memory)
- [ ] `theo.config.ts` simplified (no httpDecoratorsPlugin needed)

---

### T2.2 — Seed data

#### Objective
Create `server/db/seed.ts` that inserts initial tasks. Add `npm run seed` script.

#### Files to edit
```
templates/default/server/db/seed.ts (NEW) — insert 4 initial tasks
templates/default/package.json.tmpl — add "seed": "npx tsx server/db/seed.ts"
```

#### Acceptance Criteria
- [ ] `npm run seed` inserts 4 tasks into SQLite
- [ ] Seed is idempotent (running twice doesn't duplicate)
- [ ] Seed data matches current store.ts tasks

---

## Phase 3: Tests + Cleanup

**Objective:** Add example test and clean up removed files.

### T3.1 — Example test for tasks API

#### Objective
Create `tests/tasks.test.ts` that tests the tasks REST API. Add `npm test` script.

#### Files to edit
```
templates/default/tests/tasks.test.ts (NEW) — API tests
templates/default/package.json.tmpl — add "test": "vitest run", vitest devDep
```

#### Acceptance Criteria
- [ ] `tests/tasks.test.ts` tests GET /api/tasks (returns array)
- [ ] Test uses fetch against running server or direct route handler
- [ ] `npm test` passes on scaffolded project
- [ ] `vitest` in devDependencies

---

### T3.2 — Clean up removed files and update page.tsx

#### Objective
Update `page.tsx` feature cards, remove references to `@Controller` and `store.ts`.

#### Files to edit
```
templates/default/app/page.tsx — update feature cards
templates/default/server/guards/ — remove (no controllers = no guards needed)
templates/default/server/interceptors/ — remove
templates/default/server/filters/ — remove
templates/default/server/middleware/ — remove
```

#### Acceptance Criteria
- [ ] Feature cards updated to reflect defineRoute + Drizzle
- [ ] No references to removed files
- [ ] Template structure is clean

---

## Coverage Matrix

| # | Feature | Task(s) | Resolution |
|---|---|---|---|
| 1 | DB integration (Drizzle + SQLite) | T1.1 | schema.ts + index.ts + deps |
| 2 | Resources routing (defineRoute) | T2.1 | server/routes/tasks.ts (5 REST endpoints) |
| 3 | Seeds file | T2.2 | server/db/seed.ts + npm run seed |
| 4 | Test in template | T3.1 | tests/tasks.test.ts + npm test |

**Coverage: 4/4 features covered (100%)**

## Global Definition of Done

- [ ] `npx create-theokit my-app && npm install && npm run seed && npm run dev` works
- [ ] `GET /api/tasks` returns seeded data from SQLite
- [ ] Data persists across server restarts
- [ ] `npm test` passes
- [ ] `pnpm --filter create-theokit test` green
- [ ] Zero `@Controller` / `@swc/core` dependency in template

## Failure scenarios

(none — no external I/O; SQLite is local file)

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter create-theokit test
# Scaffold + run E2E
npx create-theokit test-app --yes
cd test-app && npm install && npm run seed && npm run dev
# Verify: curl http://localhost:3000/api/tasks
```
