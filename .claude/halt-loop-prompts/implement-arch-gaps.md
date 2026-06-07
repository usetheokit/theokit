# Halt-loop driver: implement theokit-arch-gaps-implementation

You are executing the plan at:

**`docs/plans/theokit-arch-gaps-implementation-plan.md`** (v1.2, ~1106 lines)

Working directory: `/home/paulo/Projetos/usetheo/theokit-tools/theokit/`.
Branch: `develop` (per CLAUDE.md root §4 Inquebrável).

## Completion promise (exact string)

When ALL tasks + Acceptance Criteria + DoDs from the plan are completed AND validated functionally, emit literally:

```
<promise>TODAS AS TASKS, CRITERIOS DE ACEITES, DODs CONCLUIDOS E VALIDADOS FUNCIIONAIS</promise>
```

Note: typo "FUNCIIONAIS" is intentional — matches the user's literal command. DO NOT correct.

## Per-iteration contract

Each iteration of the loop:

1. **Read the plan** (or relevant section for the current task) — re-read every iteration because the plan is the source of truth, not your memory.

2. **Pick the next un-finished task** by walking Phases 0 → 1 → 2 → 3 → 4 → 5 → Phase 6 (Dogfood QA). Within Phase 2, tasks T2.1-T2.6 are paralelizáveis (per Dependency Graph) — pick in any order.

3. **Apply the task as specified** — Files to edit + Deep dependency analysis + Tasks numbered + TDD+BDD + Acceptance Criteria + DoD. Follow them literally; do NOT skip TDD per CLAUDE.md root §7 + `testing.md` Inquebrável.

4. **Validate task** — run the verify command from TDD section (typically `pnpm test ...` or `pnpm typecheck` or `pnpm depcruise`). If ANY validation fails, ITERATE on the task — don't move on.

5. **Commit the task** atomically — ONE commit per task ID with message format `feat(arch-gaps): T<N>.<M> — <short description>` followed by per CLAUDE.md root format. NEVER skip hooks (`--no-verify` proibido). NEVER commit to main.

6. **Update CHANGELOG** per CLAUDE.md root §6 Inquebrável. Each task adds entry under `[Unreleased]` § (Added | Changed | Fixed | Removed) referencing the task ID.

7. **Emit progress** at end of turn — count completed tasks so far + remaining + any blockers encountered.

8. **Halt condition check** — if ALL tasks complete + Dogfood QA pass + ALL DoDs satisfied, emit the promise. Otherwise STOP the turn — the loop will resume.

## Critical decisions pre-resolved (per user direction)

- **T0.1 (ADR-0028 R3a vs R3b):** Default to R3a (Hono Web standards). User authorized autonomous decision per `Continue voce deve resolver todos os problemas`. Draft `docs/adr/0028-multi-runtime-strategy.md` with R3a chosen + R3b alternative + trade-off matrix. Cite Phase 0 T0.1 Deep Dives as rationale source.

- **T0.2 (vitest bump):** Bump `packages/theo/package.json#devDependencies.vitest` from `^3.x` to `^4.1.0`. Run `pnpm install` to regenerate lockfile. Run `pnpm test packages/theo` to verify zero regression. If vitest 4 has breaking API changes affecting existing tests, fix migration issues in-place (no skip).

- **Git state:** User authorized "loop trabalha sobre mistura" — i.e., the 62 uncommitted files from `git status` at session start are NOT to be stashed/cleared. Commits of this plan's tasks will coexist with them. Your commits MUST only include files YOU touched for the task (use `git add <specific-files>` per CLAUDE.md root, NEVER `git add -A`).

## Honesty mandates (Inquebrável Rules from CLAUDE.md root)

- **Rule 1 (95% confidence):** If you encounter ANY decision you don't have 95% confidence on (e.g., R3a implementation detail not in the plan), STOP and surface honestly via task progress. Do NOT make decisions outside plan scope autonomously.

- **Rule 3 (extreme honesty):** When a task fails validation OR you discover a gap in the plan, report HONESTLY — do not fabricate green or hide issues.

- **Rule 7 (testes):** Every task with TDD section is RED-first. If a RED test doesn't fail before GREEN code, the test is wrong — fix the test, not the code.

- **Rule 8 (error handling):** Never engulf exceptions silently. Every failure surfaces with context (file:line + reason).

## Validation gates (mirror plan v1.2 Global DoD)

After EACH task completes:
- [ ] `pnpm test` exit 0 (vitest unit + integration)
- [ ] `pnpm typecheck` exit 0 (tsc --noEmit)
- [ ] `pnpm lint` exit 0 (zero warnings)
- [ ] `pnpm depcruise` exit 0 (zero new violations)

After Phase 2 (M1 T2.5 specifically):
- [ ] `npx publint packages/theo` exit 0

After Phase 5 (depende T0.1 = R3a):
- [ ] `grep -rln "from 'node:" packages/theo/src/server | wc -l` returns 0 (R3a complete)
- [ ] `wrangler dev tests/fixtures/handler-web-standards/` returns 200 (R3a smoke)

After ALL phases:
- [ ] Re-run `loop-architecture-review --mode=full` returns nota ≥4.0/5
- [ ] `dogfood full` health ≥70, zero CRITICAL
- [ ] Promise emit only when ALL above gates passed

## Pause conditions (loop should request human help)

The loop STOPS without emitting promise (surfaces to human) when:
- A pre-commit hook fails 3 times on the SAME task (per CLAUDE.md root: investigate root cause, do NOT --no-verify)
- A test FAILS in a way that can't be fixed within 5 iteration attempts on the same task
- A required external tool is missing (e.g., wrangler not installed; can `pnpm add -D wrangler` once)
- Phase 5 R3a wrangler smoke needs Cloudflare account credentials (out-of-loop scope)

## Begin

Iteration 1: read `docs/plans/theokit-arch-gaps-implementation-plan.md`, identify next task = T0.2 (vitest bump — Phase 0 first task by execution order; T0.1 ADR can run in parallel or be deferred to Phase 5 prerequisite check). Execute T0.2 fully + commit + update CHANGELOG. STOP turn for loop to resume.
