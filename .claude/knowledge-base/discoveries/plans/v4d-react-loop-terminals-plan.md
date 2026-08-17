# Discovery Plan: V4-D react-loop terminals (`no_progress` + `step_limit`)

> **Version 1.2** — Investigates how codex (Rust) and opencode (TS) detect agent-loop termination — specifically a stuck/no-progress round and a step-limit hit — to specify the two terminals still missing from `@theokit/agents`'s `LoopStrategy` after `0.6.0` shipped the react multi-round foundation. Output blueprint feeds `/to-plan` for the V4-D implementation slice.

**Slug:** `v4d-react-loop-terminals`
**Owner:** paulo
**Created:** 2026-06-23
**Time budget:** 4h (codex 2h, opencode 2h — see ADR D1)
**v1.1:** absorbed edge-case MUST-FIX EC-1 (codex tooling path) + EC-2 (opencode test path). **v1.2:** reformatted to the canonical discovery-plan template (corner column, `### D` ADRs, Fase A/B per question) to satisfy `/discover-plan-confidence`.

## Context

V4-D (ROADMAP-v4) gives `@MainLoop({ strategy: 'react' })` its runtime. `@theokit/agents@0.6.0` (slice `v4-mainloop-reflective-runtime`, V4-B/V4-C) already shipped the foundation: `LoopStrategy` + `resolveLoopStrategy('react')` + `runReflectiveLoop` + `AgentRunner` + the `maxIterations` ceiling (`packages/agents/src/loop/loop-strategy.ts`). Empirical scoping found the **remaining V4-D delta** is two missing terminals:

1. **`no_progress`** — terminate when a round is "stuck" (no new tool calls / tool_result / text vs the prior round) instead of burning the full `maxIterations`. Spec: theocode `classifyRoundOutcome` (ROADMAP-v3 § V3-4 — code deleted, prose-only).
2. **`step_limit`** — surface explicitly that the loop stopped at `maxIterations` (today indistinguishable from `stop`: `LoopOutcome.finishReason` is only `'tool-calls'|'stop'|'length'|'error'`, `loop-strategy.ts:19`).

The canonical reference of the prior cycle (Mastra `agentic-loop`/`stopWhen`) was **rotated out** of `.claude/knowledge-base/references/`. The user designated **codex** (OpenAI Codex CLI, Rust core) and **opencode** (sst/opencode, TS) as the strong agent-loop references — freshly cloned and verified to contain real multi-turn loops with step bounding.

## Objective

Specify — grounded in codex + opencode — how `LoopStrategy`/`runReflectiveLoop` should detect **`no_progress`** and surface **`step_limit`**, without touching the SDK (V3-4 stays app-policy, ADR D4). Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for codex + opencode
- [ ] Recommendations section: one concrete proposal per terminal (`no_progress` signal + threshold; `step_limit` graceful-degrade vs plain terminal)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/opencode/` | `packages/core/src/session/runner/`, `packages/core/test/session-runner*.test.ts`, `packages/core/package.json` | TS agent loop with explicit step-limit (`max-steps.ts`) + repeated-tool-call concern (`llm.ts:51`) |
| `.claude/knowledge-base/references/codex/` | `codex-rs/core/src/tasks/regular.rs`, `codex-rs/core/src/session/turn.rs`, `codex-rs/core/src/context/turn_aborted.rs`, `codex-rs/core/src/session/turn_tests.rs`, `codex-rs/core/Cargo.toml`, `justfile` | Rust agent turn loop (`tasks/regular.rs:73 loop { run_turn(...) }`) + abort handling |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/opencode/packages/tui/`, web, auth, providers | Not the loop terminal logic |
| `.claude/knowledge-base/references/codex/codex-rs/tui/`, `exec-server/`, `mcp*`, cloud-config | Not the loop terminal logic |
| `.claude/knowledge-base/references/{astro,fastify,hono,next.js,nitro,workers-sdk}` | Web frameworks — no agent loop |
| `.claude/knowledge-base/references/openguardrails-agentfw`, `nemo-guardrails` | Proxy daemon / telemetry-only — verified NOT a reflective loop |
| The foundation (stopWhen/maxSteps modeling) | Already in `declarative-agent-orchestration-blueprint.md` (ADR D3) — not re-documented |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** codex 2h (Rust, scoped to `tasks/regular.rs` + `session/turn.rs`), opencode 2h (TS, scoped to `session/runner/`).

**Rationale:** opencode is the closer analog (TS + explicit `max-steps.ts` module + AI-SDK-style loop) so it grounds the recommendation; codex is the independent second source (hand-rolled Rust loop) to avoid single-source bias. Alternatives considered: single-project deep-dive (rejected — violates ≥2-source rule), equal split with more projects (rejected — others are not reflective loops).

**Stop condition — per question:** if Fase A returns empty after 3 query-variant retries, mark the question BLOCKED ("Fase A exhausted") and continue. NEVER fabricate Fase B answers (Unbreakable Rule 3).

**Stop condition — per project:** when a project's budget is exhausted with questions pending, mark them BLOCKED ("budget exhausted") and advance. If every remaining question is `done` or honestly `blocked`, emit the honest blocked report — never a false complete.

**Consequences:** the halt-loop stops on budget exhaustion; blocked questions surface as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the in-scope loop files end-to-end (they are small/medium: `regular.rs` 90 LoC, `max-steps.ts` ~20 LoC, `llm.ts` 380 LoC); Grep-then-Read for the no-progress signal across `session/turn.rs` (2458 LoC — too large to read whole).

**Rationale:** end-to-end reading captures the loop's terminal state machine + comments (intent); grep-then-read bounds the large file to the relevant region. Alternative (grep-only) rejected — would miss the intent comments that distinguish "count-only" from "no-progress detector".

**Consequences:** Q3's verdict (does a real no-progress detector exist?) is grounded, not guessed.

### D3 — Narrow to the delta; do NOT re-document the foundation

**Decision:** investigate ONLY `no_progress` + `step_limit`. The react multi-round foundation (`resolveLoopStrategy('react')`, `maxIterations`, stopWhen modeling) is already shipped (0.6.0) and documented in `declarative-agent-orchestration-blueprint.md` (D1).

**Rationale:** re-investigating the foundation is re-work (the goal forbids it). Alternative (full re-discovery) rejected.

**Consequences:** the blueprint extends, not duplicates, the prior one.

### D4 — V3-4 out of scope (app-policy)

**Decision:** exclude the SDK continuation driver (V3-4). `no_progress`/`step_limit` are pure `LoopStrategy` concerns inside `@theokit/agents`.

**Rationale:** ROADMAP-v3 § V3-4 says it "may legitimately stay app-policy"; the terminals need no SDK change. Alternative (build V3-4 first) rejected — V3-4 is not a blocker.

**Consequences:** the slice stays inside `packages/agents`, no `@theokit/sdk` edit.

## Research Questions

- **Fase A (broad)** — grep/ast-grep hotspot map. Skipped (`SKIP`) for text-shape questions (manifests, prose).
- **Fase B (deep)** — Read each hotspot for intent + line-exact citation.

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | When opencode reaches its step limit, does it hard-abort or gracefully degrade (disable tools + force a summary)? | techniques | `.claude/knowledge-base/references/opencode/` | `grep -n 'MAX_STEPS_PROMPT\|isLastStep\|maxSteps' opencode/packages/core/src/session/runner/llm.ts` | Read `max-steps.ts` (full) + `llm.ts` around `:202` | Prose + snippet of the last-step degradation pattern + `file:line` |
| Q2 | How does codex structure its turn loop and what terminates it (model completion vs limit vs abort)? | techniques | `.claude/knowledge-base/references/codex/` | `grep -n 'loop\|break\|return\|run_turn\|completed' codex/codex-rs/core/src/tasks/regular.rs` | Read `tasks/regular.rs` (full, 90 LoC) + the `run_turn` return contract in `session/turn.rs` + `context/turn_aborted.rs` | State machine: what breaks the `loop {}`, terminal variants, `file:line` |
| Q3 | Do codex/opencode detect **no-progress** (repeated identical tool calls / empty round) as a distinct terminal, or only bound by step/turn count? | techniques | `.claude/knowledge-base/references/opencode/`, `.claude/knowledge-base/references/codex/` | `grep -rniE 'repeated\|duplicate\|identical\|no.?progress\|stuck\|stall' opencode/packages/core/src/session codex/codex-rs/core/src/session` | Read each hit in context (opencode `llm.ts:51`; any codex match) | Honest verdict per project: explicit detector vs count-only; the comparison signal used (if any), with `file:line` |
| Q4 | How is the loop-terminal behavior tested (limit reached, abort) without a live LLM? | tests | `.claude/knowledge-base/references/codex/`, `.claude/knowledge-base/references/opencode/` | `grep -nE 'max|limit|abort|step|turn' codex/codex-rs/core/src/session/turn_tests.rs opencode/packages/core/test/session-runner.test.ts opencode/packages/core/test/session-runner-tool-events.test.ts` | Read the matching test blocks | Test recipe: how each scripts a fake model stream + asserts terminal/round count, with `file:line` |
| Q5 | What drives each loop — an external SDK stop-condition (opencode) vs hand-rolled (codex)? Which deps? | deps | `.claude/knowledge-base/references/opencode/`, `.claude/knowledge-base/references/codex/` | SKIP Fase A — text-shape. Read `opencode/packages/core/package.json` + the loop imports at top of `llm.ts`; `codex/codex-rs/core/Cargo.toml` | Read each manifest + import block | Dep table: who owns the loop primitive; relevance to our self-owned `runReflectiveLoop` |
| Q6 | How is the loop exercised locally (build/test command)? | tools | `.claude/knowledge-base/references/opencode/`, `.claude/knowledge-base/references/codex/` | SKIP Fase A — text-shape. Read `opencode/package.json` scripts + `codex/justfile` (repo root); note `cargo test -p codex-core` (`codex-rs/Cargo.toml` is a workspace) | Read each file fully | The one command to run the loop tests in each |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | the `.claude/knowledge-base/references/{project}/{path}` in Fase A/B exists | Mark Qx BLOCKED "path not found", continue |
| Q3 honesty gate | if no explicit no-progress detector exists in a reference, the blueprint says "count-only / not present" and derives `no_progress` from the theocode spec + first principles, labeled as such | Refuse to overclaim a reference; record the honest verdict |
| After answering Qx | the blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry max) |
| Per-project budget | project time budget not exhausted | Mark remaining Qx BLOCKED "budget exhausted", advance |
| Before promising complete | all 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] Every citation resolves under `.claude/knowledge-base/references/{codex,opencode}/`
- [ ] ≥ 2 independent references cited for the Techniques corner (codex AND opencode)
- [ ] `no_progress`: the blueprint states the concrete between-round comparison signal + the K-consecutive threshold
- [ ] `step_limit`: the blueprint recommends graceful-degradation (opencode `MAX_STEPS_PROMPT`-style) vs plain terminal
- [ ] An ADR records V3-4 out of scope + foundation not re-documented

## Global Definition of Done

Scored by `/discover-confidence` against `discover-blueprint-golden-rule.md`: no empty coverage corner, no fabricated citation, ADRs present. Target ≥ SHIPPABLE_WITH_CAVEATS before feeding `/to-plan`.
