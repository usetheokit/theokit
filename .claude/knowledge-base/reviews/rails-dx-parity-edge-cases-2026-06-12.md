# Edge Case Review — rails-dx-parity

Date: 2026-06-12
Tasks analyzed: 5 (T1.1, T2.1, T2.2, T3.1, T3.2)
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Dynamic route requires [id] file, not inline :id — tasks need directory structure
- **Affected task:** T2.1
- **Family:** Integration
- **Scenario:** The plan says `server/routes/tasks.ts` with 5 REST routes. But TheoKit's route scanner maps files to URLs: `server/routes/tasks.ts` → `GET /api/tasks`. For `GET /api/tasks/:id`, the file must be at `server/routes/tasks/[id].ts`. A single `tasks.ts` file can only export one HTTP method per verb (GET, POST). Multiple GETs (list vs show) need separate files.
- **Impact:** `GET /api/tasks/:id` won't work if everything is in one file. Only `GET /api/tasks` (list) would match.
- **Suggested fix:** Use directory structure like Next.js:
  ```
  server/routes/tasks/index.ts  → GET /api/tasks (list) + POST /api/tasks (create)
  server/routes/tasks/[id].ts   → GET /api/tasks/:id + PUT + DELETE
  ```

### EC-2: Removing @Controller breaks agent toolbox — TaskTools imports from store.ts
- **Affected task:** T2.1, T3.2
- **Family:** State
- **Scenario:** `server/toolboxes/task.tools.ts` imports `taskStore` from `../store.js`. The plan deletes `store.ts`. Also, `server/agents/assistant.agent.ts` uses `@Mixin(TaskTools)`. If we delete controllers + store + guards + interceptors + filters, the agent + toolbox files break too.
- **Impact:** `theokit dev` crashes because agent imports are unresolved.
- **Suggested fix:** T2.1 must also update `task.tools.ts` to import from `../db/index.js` instead of `../store.js`. OR remove agents/toolboxes entirely (they don't work in theokit dev mode anyway per EC-2 from prior plan).

## SHOULD TEST

### EC-3: Seed idempotency with auto-increment IDs
- **Affected task:** T2.2
- **Suggested test:** `test_seed_twice_no_duplicates()` — run seed, count rows, run seed again, count should be same. Use `INSERT OR IGNORE` or `ON CONFLICT DO NOTHING` to prevent duplicates.

### EC-4: SQLite file permissions on different OS
- **Affected task:** T1.1
- **Suggested test:** `test_db_creates_data_directory()` — verify `data/` directory is auto-created if it doesn't exist. Use `mkdirSync(dir, { recursive: true })` before SQLite open.

## DOCUMENT

### EC-5: better-sqlite3 native compilation may fail on some systems
- **Accepted risk:** `better-sqlite3` requires `node-gyp` + C++ compiler. On most systems (Mac/Linux/WSL with build-essential) this works. On minimal Docker images or Windows without VS Build Tools, it fails. Mitigation: template README should include "Requires: Node.js 22+, C++ compiler (build-essential on Ubuntu, Xcode CLI on Mac)".

### EC-6: Removing @Controller pattern from default template
- **Accepted risk:** ADR D2 moves the default template from `@Controller` to `defineRoute`. Devs who learned TheoKit via the controller pattern will find a different template. This is intentional — `defineRoute` is simpler. `@Controller` docs stay in README/docs. The `theokit generate controller` command still works for devs who want it.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 1 |
| T2.1 | 2 | 2 | 0 | 0 |
| T2.2 | 1 | 0 | 1 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 0 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT
