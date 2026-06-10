# Implementation Driver — http-decorators-exception-filters

Plan: `.claude/knowledge-base/plans/http-decorators-exception-filters-plan.md` v1.1

## Status

- Phase 1 T1.1: IN PROGRESS (files created, needs tests + export + commit)
- Phase 2 T2.1 + T2.2: PENDING
- Phase 3 T3.1 + T3.2: PENDING

## Per-task TDD discipline

1. Write failing test
2. Write minimal production code to pass
3. Run `cd packages/http-decorators && npx vitest run` — ALL tests pass
4. Commit atomically on develop

## Tasks

### T1.1 — HttpException hierarchy (files exist, need tests + barrel export)
- `src/exceptions/http-exception.ts` CREATED — 18 subclasses
- `src/exceptions/index.ts` CREATED — barrel
- Need: add `export * from './exceptions/index.js'` to `src/index.ts`
- Need: write `tests/unit/http-exception.test.ts`
- Commit when GREEN

### T2.1 — @Catch + @UseFilters decorators
- Add USE_FILTERS + CATCH_EXCEPTIONS to metadata/keys.ts
- Add @Catch and @UseFilters to decorators/middleware.ts
- Update walk-metadata.ts WalkResult with filters field
- Write tests/unit/exception-filter-decorators.test.ts

### T2.2 — ExceptionFilter interface + runExceptionFilters chain
- Create src/bridge/exception-filter-chain.ts
- ExceptionFilter interface + ArgumentsHost + runExceptionFilters()
- EC-1: recursion guard (filter that throws falls to global)
- EC-2: check res.headersSent before writing
- Write tests/unit/exception-filter-chain.test.ts

### T3.1 — Wire into all 3 handlers
- Replace catch blocks in create-server.ts, theokit-plugin.ts, app.ts
- Write tests/integration/exception-filter-roundtrip.test.ts

### T3.2 — Fixture NotFoundException demo
- Update tasks.controller.ts to throw NotFoundException
- Update app/page.tsx for 404 handling

## Completion

When ALL tasks committed and `npx vitest run` passes with 163+ tests:

<promise>IMPLEMENTATION_COMPLETE</promise>
