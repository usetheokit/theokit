# Halt-loop driver — decorator-file-based-parity (#122)

Follow the FULL TDD halt-loop protocol in `.claude/skills/implement/prompts/implementation-prompt.md` for THIS iteration, with these substitutions:

- `{PLAN_SLUG}` = `decorator-file-based-parity`
- `{PLAN_PATH}` = `.claude/knowledge-base/plans/decorator-file-based-parity-plan.md`
- `{IMPLEMENTATION_PATH}` = `.claude/knowledge-base/implementations/decorator-file-based-parity-implementation.md`
- `{DATE}` = `2026-07-13`
- Progress file = `.claude/knowledge-base/implementations/.progress-decorator-file-based-parity.json`
- SEPA agent file = `.claude/agents/implement-decorator-file-based-parity-2026-07-13/sepa.md`

**SEPA invocation:** use the FALLBACK path (the agent file was written mid-session):
`Agent(subagent_type='general-purpose', description='SEPA iter {N} {phase}', prompt='Read .claude/agents/implement-decorator-file-based-parity-2026-07-13/sepa.md for your full role + context, then advise on task {T-ID}. MODE=TIGHT (pre-RED / pre-COMMIT) or MODE=VERBOSE (post-GREEN). Return only the structured advice format.')`. Persist each SEPA response under `.claude/knowledge-base/implementations/decorator-file-based-parity/sepa-iterations/iteration-{ITERATION}-{phase}.md`.

## One task per iteration

1. Read the progress file; pick the next task whose `status == pending` AND all `deps` are `committed`.
2. **SEPA pre-RED** (MODE=TIGHT). If `[CRITICAL]`, HALT unless 95%-confidence justified.
3. **RED:** write the failing test from the plan's `#### TDD` for this task; run it; CONFIRM it FAILS for the right reason. (If it passes pre-impl, the test is wrong — revise.)
4. **GREEN:** walk the parsimony ladder (`.claude/rules/parsimony-ladder.md`), then write the minimum code to pass. Reuse `@theokit/http` (`walkControllerMetadata`, and for T3.1 `createTypedClient`/`registerControllers`) — never reimplement (Rule 9 / ADR-1).
5. **REFACTOR:** SOLID/DRY/Clean-Code; new logic in NEW files (G6 — `api-middleware.ts`/`app-typed-client.ts` stay < 500). Tests stay green.
6. **SEPA post-GREEN** (MODE=VERBOSE).
7. **WIRING:** `python3 .claude/skills/implement/scripts/check_wiring.py --symbol <new-symbol>`. Pillar (a) production caller is non-negotiable. HALT if it fails (add the real caller, e.g. the manifest/dispatch integration for T1.1).
8. **SEPA pre-COMMIT** (MODE=TIGHT).
9. **COMMIT:** conventional (`feat(server): … (#122)`); reference the task id; add a changeset per the Global DoD when consumer-visible.
10. **PROGRESS:** update the progress JSON (status → `committed`, `commit_sha`, `files`).
11. **Step 4.7:** if this commit closed a `## Phase N`, run `python3 .claude/skills/implement/scripts/mini_review.py --slug decorator-file-based-parity --plan {PLAN_PATH} --progress {progress} --phase N --project-root . --output-dir .claude/knowledge-base/mini-reviews --json`. `PHASE_REVIEW_NEEDS_FIX` → HALT (BLOCKED).

## Task-specific reminders (revised plan — design 3)

- **ADR-5 is load-bearing:** controllers are a PARALLEL path — NEVER touch `generateManifest`/`ManifestRoute` (zero adapter ripple). A routes-only app's manifest + `.theokit/client.d.ts` must stay byte-identical (regression test).
- **Task 1.1 (swc transform):** wiring pillar-(a) caller = the Vite plugin array in `vite-plugin/index.ts` (registering the transform IS the call). Scope to `controllers/**` only (ADR-4). Reuse `@theokit/http`'s swc-loader.
- **Task 1.2 (dispatch = runtime parity):** wiring pillar-(a) caller = `api-middleware.ts` (the "no file-route match → try controller" branch). REUSE `@theokit/http`'s `registerControllers` (ADR-1) — do NOT hand-roll dispatch. Reuse `incomingMessageToHandlerRequest` (#119). All scan/match/dispatch in the NEW `controller-dispatch.ts` (G6 — api-middleware stays < 500).
- **Task 2.1 (typed client):** wiring pillar-(a) caller = `app-typed-client.ts` (wire the orphan `controllersGlob` to the NEW emitter; reuse `scanControllers` from Task 1.2). Run the **ADR-2 spike FIRST**: emit `Awaited<ReturnType<InstanceType<typeof Ctrl>['method']>>` for the response; if class-based BODY inference isn't reliably expressible, fall back to response-typed + body `unknown` + a follow-up issue — runtime parity (Phase 1) already shipped. `@theokit/http`'s `createTypedClient` does NOT auto-gen from controllers (needs a hand-declared `contract()`), so the codegen synthesizes entries itself.
- **Task 3.1:** integration e2e + `pnpm changeset` (minor) + ADR-0057.

## Terminal

Emit `<promise>IMPLEMENTATION_COMPLETE</promise>` ONLY when every task is `committed` or honestly `blocked` with reason. On a hard block (same task fails 3×, plan defect, unremediatable wiring) HALT with a BLOCKED report — NEVER emit the promise falsely (Rule 3).
