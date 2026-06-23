# Edge Case Review — M8 Decorator Runtime

Date: 2026-06-22
Plan: knowledge-base/plans/m8-decorator-runtime-plan.md (v1.0)
Tasks analyzed: 6 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1)
Edge cases found: 6 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 3)

## MUST FIX

### EC-1: `@Skills` discovery needs the SDK's `local.settingSources` active
- **Affected task:** T4.1
- **Family:** Integration
- **Scenario:** `SkillsSettings.enabled` is passed to `Agent.create`, but the SDK only discovers `SKILL.md` files when a settings source (cwd/project dir) is active. If the adapter never sets `local.settingSources`, the `<skills>` block may be empty even though `enabled` is non-empty.
- **Impact:** `@Skills` appears wired but injects nothing at runtime — a silent no-op (the exact M8 anti-pattern).
- **Suggested fix:** In T4.1, when `compiled.skills` is present, also pass `local: { settingSources: ['project'] }` (or document that the consumer must configure it) — add an integration assertion that the create-options carry a skills-discovery source. One sentence added to T4.1 Deep Dives + one assertion.

## SHOULD TEST

### EC-2: `@ContextWindow()` with no args still forwards the default `maxTokens`
- **Affected task:** T2.1
- **Suggested test:** `test_context_window_no_args_forwards_default_maxtokens` — assert `compileContextWindow({maxTokens:100000,...defaults})` yields `context.maxTokens===100000` AND a metadata-only warning lists the default strategy knobs (so the "empty decorator" path is honest, not silently dropping everything).

### EC-3: project-context resolver composition when base prompt is empty/undefined
- **Affected task:** T3.1
- **Suggested test:** `test_project_context_resolver_empty_base` — resolver with `base===undefined` returns env+map+instructions joined, with no leading/trailing blank-join artifacts (`.filter(Boolean)` already handles it; lock it with a test).

## DOCUMENT

### EC-4: `@Agent` systemPrompt is always a string in `@theokit/agents` (no resolver-wrapping needed)
- **Accepted risk:** The agents-layer `@Agent({systemPrompt})` is typed `string` (not `SystemPromptResolver`), so T3.1's resolver always wraps a string base — the "agent already declared its own resolver" branch (Q1) cannot occur at this layer. Documented; no code needed. If a future change lets `@Agent` accept a resolver, revisit T3.1.

### EC-5: repo-map staleness within a long-lived agent
- **Accepted risk:** `buildRepoMap` runs per send (resolver is lazy), so the map reflects the cwd at send time — acceptable and actually desirable (fresh map). No caching introduced (YAGNI). Documented.

### EC-6: SDK bump may surface unrelated `theo` failures
- **Accepted risk:** Covered by Drawbacks table + Final Phase "separate M8-caused from pre-existing". The `pnpm -w build`/`test` gate in Phase 0 catches regressions early. Documented.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1 | 1 | 0 | 0 | 1 (EC-6) |
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 (EC-2) | 0 |
| T3.1 | 2 | 0 | 1 (EC-3) | 1 (EC-4) |
| T4.1 | 2 | 1 (EC-1) | 0 | 1 (EC-5) |
| T5.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (settingSources) into T4.1 before `/implement`.
