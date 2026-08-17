# Review: componentize-default-tui-surface

**Date:** 2026-07-16
**Commits reviewed:** `68f4abcf` (componentization) + `0c015afc` (review-fix follow-up)
**Reviewers (parallel agents):** 3 — architecture/correctness (`code-reviewer`), test-quality (`general-purpose`), cross-validation (`general-purpose`)
**Findings:** BLOCKER 0 · HIGH 0 · MEDIUM 1 (fixed) · LOW ~5 (2 fixed, rest accepted) · INFO 8
**Verdict:** **READY_TO_MERGE**

> Right-sized review — a scaffold-template componentization (pure code-move) does not warrant the full 7-agent domain fan-out. 3 focused reviewers in parallel.

## BLOCKER / HIGH findings
None.

## MEDIUM findings (resolved before merge)

### F1 — `as Mode` type assertion in the slash-command router
- Severity: MEDIUM → **FIXED** in `0c015afc`
- Found by: architecture/correctness
- File: `packages/create-theokit/templates/surfaces/tui/tui/App.tsx.tmpl` (was `setMode(trimmed.slice(1) as Mode)`)
- Evidence: `type-safety.md` forbids `as` assertions; the generated app is exemplar code shipped under `strict: true` — a scaffold user copies this pattern. The cast was safe for the current 4 cases but escapes the type system if a future case is added.
- Resolution: replaced with four explicit type-safe cases (`case '/plan': setMode('plan')` …). No cast; `tsc` + `--noUnusedLocals` clean; App.tsx stays ≤ 230 (228 after compensating comment trims).

## LOW findings

### F2 — Anti-regression guards used bare substrings (comment-defeatable)
- Severity: LOW → **FIXED** in `0c015afc`
- Found by: test-quality + architecture
- The `not.toContain('PlanApproval')` / `'ContextWindowBar')` guards would false-fail on a future documentary comment mentioning the symbol. Hardened to code-shaped tokens: `not.toContain('<PlanApproval')`, `'<ContextWindowBar')`, `'function Banner('`.

### F3 — Plan claimed a `{{name}}`-leak assertion that wasn't implemented
- Severity: LOW → **FIXED** in `0c015afc`
- Found by: architecture
- The plan's Drawbacks table claimed "the unit test asserts no `{{name}}` remains in any scaffolded tui file" — but only a positive substitution check existed. Added the negative loop: `for (f of tui files) expect(read(f)).not.toContain('{{name}}')`. Closes the stated mitigation.

### F4 — Integration test doesn't deep-assert UsagePanel/Demos content
- Severity: LOW → **accepted**. By design: the unit test owns deep per-file content assertions; the integration (matrix) test owns tree/deps/tsconfig breadth. Noted for awareness.

### F5 — Final-Phase `tsc` gate documented-not-reproduced in review
- Severity: LOW → **accepted**. The cross-validation agent couldn't re-run the scaffold+tsc smoke (sandbox). The operator (me) DID run `tsc --noEmit` + `--noUnusedLocals` = 0 errors on a rendered instance (both commits). Verified.

## INFO
- `/progress` `setProgressStep(0)` removal → **DEFINITIVELY not a regression** (architecture agent + operator trace): `mode` can only reach a demo via the composer (shown only when `mode==='chat'`), so every `/progress` mounts a FRESH `ProgressDemo` (`useState(0)`); no demo→demo path keeps the instance alive with a stale step.
- `elapsed`/`tokens` props unused in 3/4 `DemoSurface` arms — YAGNI, acceptable for a scaffold (only the `progress` arm forwards them).
- ProgressDemo timer deps `[step, onComplete, onToast]` are stable (`backToChat = useCallback`, `setToast` React-stable) → no restart on unrelated re-renders. Correct.

## Cross-validation summary (plan vs commits)
- Plan tasks: 6 (T1.1–T3.1) — all fully implemented.
- Goal metric: `App.tsx` **228 lines** ≤ 230 ✅ (from 460 — 50% reduction).
- ADRs: D1 (4 files) ✅, D2 (ProgressDemo owns timer; App holds no `progressStep`) ✅ verified, D3 (System Design in README-surface.md) ✅.
- Coverage Matrix: 9/9 delivered.
- Scope: `scaffold-surface.ts` NOT modified (recursive copy + tsconfig glob already cover `tui/components/`) — exactly as Baseline Context predicted. No scope creep.

## Quality gates summary
- `pnpm --filter create-theokit test`: **95/95** (unit + integration, retargeted to the new layout).
- `tsc --noEmit` (rendered instance): **0 errors** (types correct vs `@theokit/tui@0.40.0`).
- `tsc --noUnusedLocals --noUnusedParameters`: **0** (no orphan imports; no `as` cast).
- App.tsx ≤ 230: **228** ✅.
- `scaffold-surface.ts` untouched: ✅.
- Secret scan on diff: clean.
- Live tmux visual smoke: **blocked** by environment Ink-capture flakiness (the app runs — `tsx tui/main.tsx` 8s no crash); full interactive smoke was done on the byte-identical 1.22.0 logic.

## Spawned agents (audit trail)
- architecture/correctness (`code-reviewer`) — agentId a4baf236a2b38a593
- test-quality (`general-purpose`) — agentId a09abf19a14a9792f
- cross-validation (`general-purpose`) — agentId ae7bf75cb0258ff73

## Handoff decision
**READY_TO_MERGE.** No BLOCKER/HIGH. The single MEDIUM (`as` cast) and the two actionable LOWs (guard hardening + the plan-claimed `{{name}}` negative assertion) were fixed in `0c015afc`. Remaining LOWs/INFO are accepted (design choices / YAGNI). Next: `/release` — consumes the changeset → `create-theokit@1.23.0`, pnpm publish.
