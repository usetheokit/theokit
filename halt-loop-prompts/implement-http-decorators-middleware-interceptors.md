# Implementation Driver — http-decorators-middleware-interceptors

Plan: `.claude/knowledge-base/plans/http-decorators-middleware-interceptors-plan.md` v1.1

## Status

- Phase 1 (T1.1 + T1.2): DONE — committed `af73cd7`
- Phase 2 (T2.1 + T2.2): IN PROGRESS
- Phase 3 (T3.1): PENDING

## Current iteration objective

Complete the NEXT unfinished task in order: T2.1 → T2.2 → T3.1.

For each task, follow strict TDD:

1. **RED**: Write the failing test(s) from the plan's TDD section
2. **GREEN**: Write minimal production code to pass
3. **REFACTOR**: Clean up, ensure SOLID/DRY
4. **VERIFY**: Run `cd packages/http-decorators && npx vitest run` — ALL tests must pass
5. **COMMIT**: Atomic commit on `develop` with `feat(http-decorators): <description>`

## Task details

### T2.1 — Middleware types + MiddlewareConsumer builder

File `packages/http-decorators/src/bridge/middleware-consumer.ts` already has NestMiddleware interface, MiddlewareConsumerImpl, and runMiddleware. Need to:
- Export from `packages/http-decorators/src/bridge/index.ts`
- Write unit tests at `packages/http-decorators/tests/unit/middleware-consumer.test.ts`
- Tests: consumer apply class, apply functional, forRoutes, exclude, chain, route matching

### T2.2 — Wire middleware into request pipeline

- Add `configure` option to `HttpDecoratorsPluginOptions` and `CreateDecoratorServerOptions`
- At registration time, call `configure(consumer)` to collect middleware entries
- In request handlers (create-server.ts, theokit-plugin.ts), run `runMiddleware()` BEFORE `runGuards()`
- Write integration tests at `packages/http-decorators/tests/integration/middleware-roundtrip.test.ts`

### T3.1 — Fixture integration

- Create `fixtures/decorator-fullstack/server/interceptors/timing.interceptor.ts`
- Create `fixtures/decorator-fullstack/server/middleware/logger.middleware.ts`
- Add `@UseInterceptors(TimingInterceptor)` to TasksController
- Wire LoggerMiddleware via `configure(consumer)` in theo.config.ts
- Update frontend `app/page.tsx` to display X-Response-Time header

## Rules

- Never commit to `main` — work on `develop`
- Never use `git checkout` or `git revert`
- Run full test suite after each task
- Update CHANGELOG.md under [Unreleased] when done

## Completion

When ALL 3 tasks are committed and tests pass, emit:

<promise>IMPLEMENTATION_COMPLETE</promise>
