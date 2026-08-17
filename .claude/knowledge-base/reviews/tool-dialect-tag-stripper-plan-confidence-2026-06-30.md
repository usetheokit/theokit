# Plan-Confidence — tool-dialect-tag-stripper

**Date:** 2026-06-30
**Plan:** `.claude/knowledge-base/plans/tool-dialect-tag-stripper-plan.md` (v1.1)
**Verdict:** **SHIPPABLE** — final score **90.0** (authoritative re-score with `--no-code-quality`; see § Dismissal)
**Default-run verdict:** NON_SHIPPABLE 70 (single soft cap `symbol_fab_unverifiable_typescript` — TS-introspection limitation, dismissed below)

## Dimension scores

| Dimension | Score | Notes |
|---|---|---|
| completude (completeness) | 100.0 | Coverage Matrix 14/14 (100%); all mandatory sections present; ADRs with alternatives |
| risco_estrutural (structural risk) | 75.0 | minor smell hits (vague pronoun / weak imperative in prose) — penalty only, no cap |
| architecture_compliance | 1.0 | cites `architecture.md`, `parsimony-ladder.md`, `system-design-guardrails.md` + principles DRY/KISS/YAGNI/TDD |
| criterion_executability | acceptable_ratio 1.0 | every Acceptance/DoD criterion names an observable verb + measurable object + backtick oracle |
| concurrency_tests | complete | 3/3 tasks declare the `(none — single-threaded)` escape |

## Iteration log (issues found + fixed during scoring)

The first run scored INVALID 49; each defect was fixed at root (no workaround):

1. **`fabricated_citation` (HARD, was INVALID 49) — FIXED.** T1.1 Evidence cited the blueprint as `Blueprint §"…"` + a bare filename; the M3 checker resolves `Blueprint §` only against repo-root `knowledge-base/discoveries/blueprints/` (no `.claude/` prefix) → flagged fabricated. Fix: cite by the full slash-path `.claude/knowledge-base/discoveries/blueprints/tool-dialect-tag-sanitizer-blueprint.md § "Coverage Corner 4 — Technique 2"` (the checker passes slash-paths). 0 unresolved citations after fix.
2. **`soft_floor_concurrency_tests_missing` (cap 89) — FIXED.** The `(none — single-threaded)` escape was inside a ```` ``` ```` fence; `check_concurrency_tests.py` strips code fences before matching (`_strip_code`), so the escape vanished. Fix: moved the escape OUT of the fence in all 3 tasks → 3/3 credited.
3. **`vague_acceptance_criteria` (cap 70) — FIXED (genuine improvement, not dismissed).** acceptable_ratio was 0.476 (< 0.80): 11 criteria lacked a backtick oracle and/or measurable object. Fix: strengthened every Acceptance/DoD/Integration-Validation criterion to name its verification oracle in backticks (test name or shell command) + a measurable object → acceptable_ratio 1.0.

## Dismissal — `symbol_fab_unverifiable_typescript` (the one residual cap)

The default run caps at 70 SOLELY because the embedded `/code-quality` D2 detector emits `symbol_fab_unverifiable_typescript`. This is a **documented auditor limitation**, not a real fabrication:

- D2 TypeScript member-access introspection is deferred (`code-quality/SKILL.md § Roadmap v0.2`: "D2 member-access introspection for TypeScript — currently package-name check only").
- The symbols the plan cites split into two honest classes:
  - **Existing symbols** — `createThinkTagExtractor`/`extractThinkTagStream`/`heldPrefixLength` (`think-tag-extractor.ts:18/38/55/115`), `parseThinkTags` (`types.ts:27`, `agent-compiler.ts:90/139`, `sdk-adapter.ts:96/357/497`, `agent-runner.ts:81/220`), `createSdkAgentStream` (`sdk-adapter.ts:349`). **All verified by grep/Read during `/to-plan` Step 1.**
  - **New symbols** — `createToolDialectStripper`/`stripToolDialectStream`/`stripToolDialect`. These are the plan's DELIVERABLES — correctly unverifiable pre-implementation; flagging them is expected for any plan that creates new code.
- Authoritative gate: `tsc --noEmit` is the truth source for symbol existence, and the plan's DoD requires `tsc` exit 0. The TS-introspection auditor cannot see member access; its inability to verify is not evidence of fabrication.

Per `code-quality-golden-rule.md § 1` (FAIL_SOFT proceeds with an ADR dismissing the soft cap) and the locked gotcha in `[[project_no_progress_signature_fix_shipped]]`, the authoritative score is the `--no-code-quality` re-score: **SHIPPABLE 90.0, 0 hard caps**.

## Gate decision

Verdict ≥ SHIPPABLE_WITH_CAVEATS → **plan is structurally sound; proceed to `/implement`.** No hard cap (no coverage gap, no fabricated citation, no ADR-without-alternatives, no missing-TDD). The cited existing symbols all resolve; the new symbols are the deliverables. Coverage Matrix 100% (14/14).
