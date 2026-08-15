# Discovery Plan: TheoCode as the baseline — what an agent app would have to rebuild

> **Version 1.1** — edge-cases absorbed (EC-1, EC-2, EC-3). This discovery reads the 54 non-test
> modules of the TheoCode baseline that no prior audit has examined, and classifies each subsystem
> as `absorb` / `product-policy` / `covered` — each with a `file:line`, an evidence class, and a
> destination. The output is a blueprint from which a framework-gap roadmap can be cut by
> measurement rather than intuition.

**Slug:** `theocode-baseline-gaps`
**Owner:** paulohenriquevn
**Created:** 2026-08-15
**Baseline SHA:** TheoCode @ `8011068` (branch `workspace`, measured 2026-08-15 — EC-6)
**Framework SHA:** theokit @ `c9735140`
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

Two audits already answered a NARROWER question and are prior art, not to be redone:

- [`audits/2026-08-14-theocode-crossval.md`](../../audits/2026-08-14-theocode-crossval.md) — the first cross-validation; 12 gaps, all closed.
- [`audits/2026-08-15-theocode-adoption.md`](../../audits/2026-08-15-theocode-adoption.md) — the adoption measurement, which found three capability gaps that were **not** publish-gated, and closed them.

Both asked: *"which symbols does TheoCode define that collide with ours?"* That question is
exhausted — measured 2026-08-15: 15 collisions remain, 11 are facades, 4 are genuinely different
capabilities. Re-running it produces nothing.

**This plan asks a larger question**, in the requester's words:

> *"If I were to implement an agent with X functionality / code / integration / behaviour, would I
> have to recreate it? Is that common in other agents? If yes, we must migrate."*

The difference is load-bearing. Collision-matching only sees what TheoCode **named the way we did**.
It is blind to the largest category: capability TheoCode built that the framework never attempted,
so no name exists to collide with. Surface still unexamined under that lens (non-test modules,
measured recursively):

| Area | Modules | Examined by prior audits? |
|---|---:|---|
| `packages/tui/src/{components,agent-session}/` | 20 | **no** — only `SecretInput` + `context-pressure` |
| `packages/agent/src/session/` (incl. `gc/`) | 10 | **no** |
| `packages/agent/src/delegation/` | 6 | **no** |
| `packages/agent/src/review/` | 5 | **no** |
| `packages/agent/src/{goal,ask,pty}/` | 8 | **no** |
| `packages/cli/src/commands/` | 5 | **no** |

54 modules that never received the migration question, against ~11 that did.

## Objective

Produce a blueprint that classifies every in-scope subsystem as **`absorb` / `product-policy` /
`covered`**, so a framework-gap roadmap can be cut from measurement rather than intuition.

Measurable success criteria:

- [ ] Every in-scope subsystem has a verdict row with a resolving `file:line`
- [ ] Every `absorb` row carries an ADR-D3 evidence class **and** an ADR-D4 destination
- [ ] All four coverage corners have populated sections
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

A verdict with no evidence column, or with no destination, is not a verdict.

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

Counts are **non-test modules, measured recursively**. Corrected in v1.1 (EC-2): the first draft
used `ls | wc -l`, which counts test files and subdirectories as modules. That inflated most rows
and hid `session/gc/` entirely — session garbage collection is squarely in scope, and a pass over
the nine visible entries would never have opened it.

| Project | In-scope subdirectories | Modules | Reason |
|---|---|---:|---|
| `/home/paulo/Projetos/theo/usetheo-labs/TheoCode/` | `packages/agent/src/session/` (incl. `gc/`) | 10 | Resume, backtrack, GC, artifacts, liveness — every terminal agent has sessions |
| " | `packages/agent/src/delegation/` | 6 | Sub-agent orchestration; we ship `delegate()` and never compared |
| " | `packages/agent/src/review/` | 5 | A second agent driving a review pass |
| " | `packages/agent/src/goal/` | 3 | Goal loop + `update_goal` tool |
| " | `packages/agent/src/ask/` | 3 | Human-in-the-loop question surface |
| " | `packages/agent/src/pty/` | 2 | Interactive shell ownership |
| " | `packages/tui/src/components/` | 11 | The agent-facing surfaces |
| " | `packages/tui/src/agent-session/` | 9 | Wiring between TUI and the run |
| " | `packages/cli/src/commands/` | 5 | The headless surface |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `packages/agent/src/auth/`, `hooks/hook-trust.ts`, `config/trust-store.ts`, `context/agents-md.ts` | Already migrated this cycle; re-asking wastes the budget |
| `packages/agent/src/tools/registry.ts` | Measured 2026-08-15 as product policy — which tools this product exposes |
| `packages/tui/src/theme.ts`, `formatting/`, copy and branding | Presentation identity is the product's, by definition |
| `node_modules/`, `dist/`, `.git/` | Build artefacts |
| TheoCode's own tests, EXCEPT where Q4 reads them | The suite is evidence for Q4, not a migration target |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** 6h total — 3h for `packages/agent/src/{session,delegation,review,goal,ask,pty}/`,
2h for `packages/tui/src/{components,agent-session}/`, 1h for Q4–Q6 (tests, deps, tools).
Per-question stop: when a question consumes a third of its target's budget with no evidence
citation, it is recorded `needs-evidence` and the loop advances.

**Rationale:** 54 modules against a fixed budget. Five questions answered with evidence beat six
answered with two guesses — and the per-question stop is what makes that trade explicit rather
than accidental. Alternative rejected: *no per-question cap* — the budget then drains into
whichever question is read first, which in a 9-subsystem sweep is arbitrary.

**Consequences:** the blueprint will contain `needs-evidence` rows. That is the intended output,
not a failure; a follow-up discovery slug picks them up.

### D2 — Investigation depth is one pass per subsystem, not per file

**Decision:** per subsystem, read the barrel/entry + the two largest modules + the test file, then
stop. Record what was NOT read, by name.

**Rationale:** file-by-file over 54 modules exceeds the budget, and the first pass does not need
that resolution to classify. Alternatives rejected: (a) *file-by-file* — the budget does not
survive it; (b) *skim everything* — produces a verdict per file with evidence for none, the exact
shape D3 exists to forbid.

**Consequences:** the blueprint's "what was not read" section will be non-empty by construction.

### D3 — "Would a second agent app need this?" requires evidence, not judgement

**Decision:** an `absorb` verdict requires ONE of — (a) a second observed implementation inside the
repo group (`@theokit/tui`, `theokit-plugins`, an SDK example), or (b) **a named external agent and
the concrete behaviour it exhibits** (Claude Code, Codex CLI, Aider, OpenCode, Gemini CLI).
Anything else is `product-policy` or `needs-evidence`.

**Rationale — revised in v1.1 (EC-1).** The first draft let (b) be "a structural reason that does
not mention TheoCode", and that hole was large enough to swallow the ADR. TheoCode is the only
agent app on this framework at that scale, so (a) is almost never available; every verdict would
fall through to (b), and (b) was free-form prose — the exact thing this ADR opens by forbidding.
Naming an external agent and its behaviour is checkable *and refutable*: *"Claude Code's `--resume`
and Codex CLI's `resume` both restore a prior thread"* can be shown wrong, where *"every terminal
agent resumes sessions"* cannot. Alternatives rejected: (a) *trusting the reading* — this cycle
already produced two claims measurement refuted, both from reading without checking; (b) *requiring
two external agents* — past what a 6h budget verifies, and one checkable observation already beats
unbounded prose.

**Consequences:** some real gaps will land in `needs-evidence` for want of a named second agent.
Preferable to the inverse error, which prescribes rebuilding things nobody else needs.

### D4 — Every `absorb` verdict must also name its destination

**Decision:** every `absorb` row carries a destination — `theokit core` / `theokit-sdk` /
`@theokit/tui` / `theokit-plugins` — and the rule that assigns it.

**Rationale:** an `absorb` with no destination is not actionable, and half of them would be illegal
where a reader would assume they go. [`system-design-guardrails.md`](../../../rules/system-design-guardrails.md)
§ G13 forbids `packages/{workflows,memory,mcp,orchestrator}/` outright, and the ADR-0040 carve-out
draws the line this discovery will hit repeatedly: **runtime → SDK; home/boundary → core**. The LLM
loop, provider I/O, tool dispatch, the conversation storage *engine* and response streaming are
SDK-owned by [`sdk-runtime.md`](../../../rules/sdk-runtime.md). `session/` is the sharpest case:
session *storage* is runtime (SDK), while resume/fork *as an app affordance* is home (core) — the
blueprint must say which half each module is, not classify the directory. Alternatives rejected:
(a) *defer routing to the plan cycle* — the evidence for where something belongs is gathered while
reading it, so recovering it later means reading twice; (b) *route everything to core* — the exact
violation G2 and `sdk-runtime.md` exist to prevent, and this repo already deleted a k8s generator
for the mirror-image mistake.

**Consequences:** the blueprint is directly consumable by `/to-plan`; rows destined for
`theokit-sdk` fork into that repo's publish train.

### D5 — Compare against source barrels, never `dist/*.d.ts`

**Decision:** every "do we already ship this?" check reads `packages/*/src` barrels. A
source-vs-`.d.ts` divergence is recorded as its own finding.

**Rationale — absorbed from EC-3.** The `.d.ts` is a *filtered* view: `stripInternal: true` deletes
declarations whose JSDoc names the internal tag. Not hypothetical — that is exactly how
`providerFromApiKeyPrefix` shipped at runtime and could not be imported (#283, fixed in
`@theokit/sdk@4.52.1`). A capability present in source but filtered out of the `.d.ts` reads as
"we don't have it" → `absorb` → we rebuild something we already ship. Measured 2026-08-15:
`packages/agents/dist/index.d.ts` is fresh (0 source files newer), so staleness is not currently
realised — but the filtering problem is structural and independent of freshness. Alternative
rejected: *check dist freshness first* — treats a symptom; the filter applies to a fresh build too.

**Consequences:** the sweep may surface further #283-class defects. Those are findings, not noise.

### D6 — The TUI is in scope despite `@theokit/tui` existing

**Decision:** in scope.

**Rationale:** the instinct is that 99 shipped components answer the TUI question. The
cross-validation already found two capabilities (`mask`, `modeLabel`) TheoCode rebuilt because the
sibling did not ship them — with 20 in-scope modules unexamined, that is a sample of two, not a
conclusion. Alternative rejected: *defer to a `@theokit/tui`-side audit* — the question is what an
agent *app* needs, and only the app knows that; a component-library audit answers the inverse.

**Consequences:** some findings route to `@theokit/tui` rather than this repo (D4).

## Research Questions

Six questions, budget 5–10 respected, ≤3 per corner, ≥1 per corner. Fase A maps hotspots broadly;
Fase B reads each hotspot. All Fase A/B targets are under the Baseline SHA recorded in the header.

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Which of the 10 `session/` modules are mechanism vs TheoCode policy, and which have a counterpart in `@theokit/agents`? | techniques | `/home/paulo/Projetos/theo/usetheo-labs/TheoCode/packages/agent/src/session/` | `ast-grep run -p 'export function $N($$$) { $$$ }' -l ts` + `-p 'export class $N { $$$ }'` over `session/` to list exported mechanism; then `Grep '@theokit/agents'` per file to separate wrapper from rewrite | Read `index.ts`, the two largest modules and `gc/`; compare names against the framework **source** barrels `packages/agents/src/persistence*.ts` / `session*.ts` (D5 — never `dist/*.d.ts`) | Table: module → LoC → verdict → framework symbol (or blank) → evidence class (D3) → destination (D4) |
| Q2 | What does `delegation/` do that `@theokit/agents`' `delegate()` does not, and would a second multi-agent product need it? | techniques | `.../packages/agent/src/delegation/` | `ast-grep run -p 'export const $N = $$$' -l ts` + `-p 'interface $N { $$$ }'` over `delegation/` to map the options surface | Read `roles.ts` + `squad.ts`; diff the options object against `DelegateOptions` in `packages/agents/src` (D5) | Capability list, each tagged with its D3 evidence class + D4 destination |
| Q3 | Which of the 20 TUI modules are agent-app-generic (approval gates, streaming transcript, tool-call rendering) vs TheoCode-specific? | techniques | `.../packages/tui/src/components/`, `.../packages/tui/src/agent-session/` | `ast-grep run -p 'export function $N($$$) { $$$ }' -l tsx` over both dirs; `Grep '@theokit/tui'` to separate composed-from-ours from built-here | Read each component's props interface — falling back to the function signature when typed inline (EC-5); cross-check names against `@theokit/tui`'s **source** barrel (D5) | Table: component → generic? → sibling counterpart (or absent) → evidence → destination |
| Q4 | How does TheoCode test the boundaries the framework would own, and which tests would move if the capability did? | tests | `.../packages/agent/src/**/*.test.ts` | `ast-grep run -p 'describe($A, $$$)' -l ts` over the in-scope dirs to list suites | Read the suites for `session/`, `delegation/`, `pty/`; note which assert against the real filesystem/process vs a mock | List: test file → what it pins → would-move (yes/no) → why |
| Q5 | Which runtime deps exist because the framework does not supply the capability? | deps | `.../packages/*/package.json`, `.../packages/*/src/` | SKIP Fase A — text-shape. `Grep` each of `figlet`, `ink`, `js-yaml`, `lowlight`, `react`, `smol-toml`, `zod` across `packages/*/src` for call sites | For each, read one call site; `Grep` the framework **source** barrels (D5) for a counterpart | Table: dep → call sites → capability → framework counterpart (or absent) → verdict |
| Q6 | Which build/dev/release tooling would a `create-theokit`-scaffolded app still hand-roll? | tools | `.../tools/`, `.../package.json` | SKIP Fase A — text-shape. `ls tools/`; read `package.json` scripts | For each tool, check whether `create-theokit`'s `default` template ships an equivalent (`Grep` the template dir in this repo) | Table: tool → what it enforces → shipped by template? → verdict |

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
| Before answering Qx | Every path declared in Qx's Fase A exists under the Baseline SHA | Mark Qx BLOCKED ("path not found"); continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries, mark Qx `needs-evidence` (D1); continue |
| After answering Qx | Every verdict row under Qx carries a resolving `file:line` | Re-iterate Qx (1 retry max) |
| Evidence class present | Every `absorb` row names its D3 class — repo-group implementation or named external agent + behaviour | Downgrade the row to `needs-evidence`; never to `absorb` on prose |
| Destination present | Every `absorb` row names a D4 destination and the rule assigning it | Re-iterate the row; a row routed to `theokit core` whose capability is runtime per `sdk-runtime.md` is a defect, not a preference |
| Source-of-truth check | Every "already covered" claim was checked against `packages/*/src`, not `dist/*.d.ts` (D5) | Re-check against source; record any divergence as its own finding |
| Straddle hop | When classification requires reading an out-of-scope module, exactly one hop was taken and recorded (EC-4) | Record the hop; do not re-audit the out-of-scope module |
| Per-project time budget | D1 budget for the current target not exhausted | Mark remaining Qx for that target `needs-evidence`; advance |
| Before promising complete | All 4 coverage corners populated AND "what was not read" section non-empty (D2) | Refuse the promise; continue iterating |

## Acceptance Criteria

- [ ] Every question in § Research Questions has an answer section in the blueprint
- [ ] Every in-scope subsystem has a verdict row
- [ ] Every citation resolves — verified by `/discover-confidence`
- [ ] Every `absorb` row names its evidence class (D3) **and** its destination (D4)
- [ ] Every "already covered" claim cites a `packages/*/src` path, never `dist/` (D5)
- [ ] All 4 coverage corners have populated sections
- [ ] The "what was not read" section is non-empty (D2 guarantees it)
- [ ] The blueprint header records the Baseline SHA it was read against (EC-6)

## Global Definition of Done

- [ ] `/discover-plan-confidence theocode-baseline-gaps` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] `/discover-execute` produces `discoveries/blueprints/theocode-baseline-gaps-blueprint.md`
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS per [`discover-blueprint-golden-rule.md`](../../../rules/discover-blueprint-golden-rule.md)
- [ ] No verdict contradicts the prior audits without saying so and citing the measurement that overturns it

## Rules consumed

- [`rules/system-design-guardrails.md`](../../../rules/system-design-guardrails.md) — G13's forbidden package names and the ADR-0040 runtime-vs-home carve-out decide where each `absorb` lands (D4). G11 (YAGNI) is the counterweight: "TheoCode has it" is not a reason for us to.
- [`rules/sdk-runtime.md`](../../../rules/sdk-runtime.md) — the SDK is the only agent runtime. A verdict routing an LLM loop, provider I/O, tool dispatch or a storage engine into `packages/` is wrong regardless of how well-evidenced the gap is.
- [`rules/architecture.md`](../../../rules/architecture.md) — a capability that only works by reaching across layer boundaries is not absorbable as-is.
- [`rules/parsimony-ladder.md`](../../../rules/parsimony-ladder.md) — rung 1 governs every `absorb`: not "could we ship this" but "does it need to exist here".
- [`rules/reference-provenance.md`](../../../rules/reference-provenance.md) — read to learn, write our own. TheoCode is a working sibling rather than a zone clone; it is treated as read-only for this discovery's duration.
- [`rules/testing.md`](../../../rules/testing.md) — Q4 uses § 4.1's edge-vs-negative lenses to judge whether a boundary test is worth moving.
