# Blueprint: TheoCode as the baseline — what an agent app would have to rebuild

**Plan:** `discoveries/plans/theocode-baseline-gaps-plan.md` v1.1
**Baseline SHA:** TheoCode @ `8011068` (branch `workspace`) · **Framework SHA:** theokit @ `c9735140`
**Date:** 2026-08-15

---

## Context

Two prior audits asked *"which symbols collide with ours?"* and exhausted it. This discovery
asked the larger question — *"if I built an agent with X, would I have to recreate it?"* — over the
54 non-test modules no prior audit had examined. Plan: `discoveries/plans/theocode-baseline-gaps-plan.md` v1.1.

## Objective

Classify every in-scope subsystem as `absorb` / `product-policy` / `covered`, each with a
`file:line`, an evidence class (plan D3) and a destination (plan D4), so a framework-gap roadmap is
cut from measurement rather than intuition.

## Headline

**Corrected mid-execution.** The first pass concluded that the framework "hands capabilities to the
app, never to the agent". That was a measurement error: the grep behind it matched only
`export function create…Tool` declarations, and the framework's tool factories are **re-exports in a
list**. Re-measured, `@theokit/agents/tools` ships **23** agent-facing factories:

```
createApplyPatchTool  createBraveWebSearchAdapter  createCurrentTimeTool  createEditFileTool
createGenericHttpSearchAdapter  createGitDiffTool  createGitStatusTool  createGlobTool
createInteractiveShellTool  createListDirTool  createPlanModeTool  createQuestionTool
createReadFileTool  createRunVitestTool  createSearchTextTool  createSessionArtifactStore
createShellTool  createTodolistTool  createUpdatePlanTool  createWebFetchTool
createWebSearchTool  createWriteFileTool  createWriteStdinTool
```

Two of the three "missing wrappers" in the first draft were not missing at all. TheoCode's
`ask/interactive-shell-tool.ts` is a **pure delegation** to the framework's own
`createInteractiveShellTool` — its 26 lines are a docblock explaining why an earlier fork was
deleted. And `goal/update-goal-tool.ts` is 15 lines of `Tool.create` plus 35 lines of product
policy (what *this* product's goal loop means by "complete" and "blocked").

The narrowed, surviving finding:

| Capability | App-facing | Agent-facing tool | TheoCode had to write it? |
|---|---|---|---|
| Read/write/patch/glob/search/git/web/shell/question/todo/plan | ✅ | ✅ (23 factories) | no |
| Remote A2A peer | ✅ | ✅ `createA2ATool` | no |
| **Local sub-agent delegation** | ✅ `delegate()`, `delegateWithScoring()`, `delegateBackground()`, `Squad` | **absent** | **yes** — `delegation/squad.ts` |

The framework can delegate; the *agent* cannot ask it to. Every other capability an agent reaches
for mid-run has a factory; the one that spawns a sub-agent does not — except `createA2ATool`, whose
target is a **remote** peer over the network, not a local sub-agent sharing the parent's tools,
budget and authority.

---

## Coverage Corner 4 — Techniques

### Q1 — `session/`

**Method:** `ast-grep` export map over `session/` + `Grep '@theokit/agents'` per module; compared
against `packages/agents/src/session/` — the **source** barrel, never `dist/*.d.ts` (D5).

TheoCode consumes 9 framework symbols (`transcriptPath`, `transcriptRoot`, `forkTranscript`,
`encodeProjectDir`, `sessionHasWriter`, `protectedTranscripts`, `JsonlParseError`, `Agent`,
`TheokitAgentError`) — the **primitives**. It then reimplements the **operations** on top of them:
`session-ops.ts:21` defines its own `listSessions` with raw `readdirSync`, and `:104` its own
`deleteSession` with raw `rmSync`, while `@theokit/agents/session` exports both.

| Module | LoC | Verdict | Framework symbol | Evidence (D3) | Destination (D4) |
|---|---:|---|---|---|---|
| `session-ops.ts` (list/delete) | 171 | `covered` | `listSessions`, `deleteSession` | — | — (already ships) |
| `backtrack.ts` | 175 | `covered` | `forkBeforeUserTurn` | — | — |
| `gc/per-session.ts`, `gc/filesystem.ts` | 372 | `covered` | `planTranscriptGC`, `runTranscriptGC` | — | — |
| `gc/all-sessions.ts` (multi-project sweep) | 442 | `needs-evidence` | none — framework GC is single-project | no second implementation found; no external agent verified to sweep across projects | — |
| `archiveSession` / `renameSession` / `compactSession` | — | `needs-evidence` | none | not verified against a named external agent within budget | — |
| `liveness-oracle.ts` | 188 | `covered` | consumes `sessionHasWriter` | — | — |
| `agent-list.ts`, `artifacts.ts`, `gc/pointer.ts` | 117 | `product-policy` | — | product's own listing/artefact shape | — |

**Answer:** session is largely **covered**. The duplication in `session-ops.ts` is TheoCode's to
remove (a facade, like `trust-store.ts` before it), not a framework gap. The caveat is honest: its
`listSessions` also reads a **legacy root** the framework's does not, so the facade must preserve
the dual read — the same trap that made the first `trust-store` facade silently lose trust
decisions earlier in this cycle.

### Q2 — `delegation/`

**Method:** export map over `delegation/`; options diff against `DelegateOptions` in
`packages/agents/src` (D5).

The framework ships more delegation *runtime* than TheoCode uses: `delegate`,
`delegateWithScoring`, `delegateBackground`, `DelegationBudgetExceededError`,
`DelegationTimeoutError`, `DelegationPort`. TheoCode's `delegation/` is mostly product policy —
`TEAM_ROLES`, `buildRoleAgent`, `createAnalystSubagent`, `hooksForMember` are *which* roles this
product has.

The exception is `createDelegateToTeamTool` (`squad.ts`, 87 LoC): it makes delegation callable
**by the agent**, not just by the app.

| Item | Verdict | Evidence (D3) | Destination (D4) |
|---|---|---|---|
| `createDelegateToTeamTool` → generic `createDelegateTool` | **`absorb`** | Claude Code ships an agent-callable sub-agent tool (its `Agent`/`Task` tool): the agent decides to spawn a sub-agent mid-run, with no app code in the loop. The framework's own 23 factories cover every *other* such capability — this is the hole in an otherwise complete set, not a new category | `theokit core` — wrapping a shipped function as an agent-callable tool is boundary/home wiring: no LLM call, no dispatch, no storage (`sdk-runtime.md` + ADR-0040 carve-out) |
| `TEAM_ROLES`, `buildRoleAgent`, `hooksForMember`, `createAnalystSubagent` | `product-policy` | which roles exist is the product's | — |
| `withDelegationCap`, `DELEGATION_CAP_MS` | `covered` | `DelegationBudgetExceededError` + `DelegationTimeoutError` ship | — |

### Q3 — TUI surfaces

**Method:** export map over `components/` + `agent-session/`; `Grep '@theokit/tui'`; cross-checked
against `@theokit/tui`'s **source** (D5).

12 of the 20 modules already import `@theokit/tui`. The sibling ships `approval-prompt`,
`permission-prompt`, `plan-approval`, `question-prompt`, `cost-meter`, `token-usage-chart`,
`context-window-bar`, `tool-call`, `tool-result`, `diff-viewer`, `agent-timeline` — the surfaces
`ConsentGates` and `UsagePanel` compose.

| Component | Generic? | Sibling counterpart | Verdict |
|---|---|---|---|
| `ConsentGates.tsx` | yes | `approval-prompt` + `permission-prompt` + `plan-approval` | `covered` (composition) |
| `UsagePanel.tsx` | yes | `cost-meter` + `token-usage-chart` + `context-window-bar` | `covered` (composition) |
| `secret-buffer.ts` | yes | `free-text-input` `mask` prop (shipped `@theokit/tui@0.53.0`) | `covered` |
| `Banner`, `Demos`, `SessionFooter`, `ConversationRegion/Slot`, `InputSlot` | no | — | `product-policy` |
| `composer-shortcuts.ts` | partly | `keyboard-help` renders, does not bind | `needs-evidence` — keybinding *policy* is arguably the product's |

**Answer:** the TUI question is **largely closed**, and D6's premise (that two prior findings were
a sample, not a conclusion) is answered: with 20 modules examined, no third gap surfaced.

## Coverage Corner 1 — Integration Tests

### Q4 — Boundary tests

**Method:** `ast-grep -p 'describe($A, $$$)'` over the in-scope dirs; read the suites for
`session/`, `delegation/`, `pty/`.

The in-scope suites are `backtrack.test.ts` and `session-ops.test.ts`. They assert against a real
filesystem (temp dirs), not mocks — which is why they would move *with* the capability if it moved.
They currently pin TheoCode's own reimplementation of `listSessions`/`deleteSession`. When those
become facades (Q1), the tests must be re-pointed at the boundary the facade keeps — the legacy-root
dual read — rather than deleted; the framework's own suite already covers the operations.

| Test file | Pins | Would move? | Why |
|---|---|---|---|
| `session/session-ops.test.ts` | list/delete over a real FS | **no** | framework already has equivalents; keep the legacy-root assertions locally |
| `session/backtrack.test.ts` | fork-before-user-turn | **no** | `forkBeforeUserTurn` ships; same reasoning |
| (no test for `delegation/`, `pty/` in scope) | — | — | recorded as a gap in TheoCode's suite, not ours |

## Coverage Corner 2 — Dependencies

### Q5 — Runtime dependencies as a gap signal

**Method:** `Grep` each runtime dep across `packages/*/src`; framework counterpart searched in
**source** barrels (D5).

| Dep | Capability | Framework counterpart | Verdict |
|---|---|---|---|
| `ink`, `react` | terminal rendering | `@theokit/tui` peer-depends on both | `covered` — correct to declare |
| `zod` | schema | `defineAgentTool` takes Zod | `covered` |
| `js-yaml`, `smol-toml` | frontmatter / config parsing | none in framework | `product-policy` — config format is the product's |
| `lowlight` | syntax highlighting | `@theokit/tui` `code-block` | `needs-evidence` — may be a direct use the sibling could absorb |
| `figlet` | ASCII banner | `@theokit/tui` `welcome-banner` | `product-policy` — branding |

**Answer:** no dependency exists *because* the framework fails to supply a capability. This corner
came back clean, which is itself the useful result.

## Coverage Corner 3 — Tools

### Q6 — Tooling a scaffolded app would hand-roll

**Method:** `ls tools/`; `package.json` scripts; compared against `create-theokit`'s `default`
template.

TheoCode carries repo-governance tooling (`check-backlog-crossval.py` and friends) that a
scaffolded app would not need — it exists because TheoCode is a *product with a backlog*, not
because the template is thin. No gap.

| Tool | Enforces | Shipped by template? | Verdict |
|---|---|---|---|
| `tools/check-backlog-crossval.py` | backlog ↔ crossval consistency | no | `product-policy` |
| `build` / `lint` / `test` scripts | standard | yes | `covered` |

---

## Cross-cutting Comparison

### Verdict summary

| Verdict | Count |
|---|---:|
| `covered` | 14 |
| `product-policy` | 9 |
| **`absorb`** | **1** |
| `needs-evidence` | 4 |

One `absorb`, and it survived a correction that removed the two rows beside it. That distribution
is the honest answer to the requester's question: after the auth/hooks/trust work earlier in this
cycle, the framework's capability surface is broadly complete. The single hole is that an agent
cannot ask the framework to delegate — a gap in a set of 23, not a missing category.

## ADRs

### D1 — GAP-1 lands in `theokit core`, as agent-facing tool wrappers

**GAP-1 — the agent cannot ask the framework to delegate to a local sub-agent.**

- **Evidence (D3b):** Claude Code ships an agent-callable sub-agent tool (`Agent`/`Task`) and an
  agent-callable question tool (`AskUserQuestion`); Codex CLI ships `update_plan`. In all three the
  *agent* invokes the capability mid-run. This is not a TheoCode idiosyncrasy.
- **Evidence (measured):** `@theokit/agents/tools` ships 23 factories; none delegates to a local
  sub-agent. `createA2ATool` delegates to a **remote** A2A peer — a different transport, a different
  trust boundary, and no inheritance of the parent's tools/budget/authority. TheoCode wrote
  `delegation/squad.ts` (87 LoC) to close it, of which the generic half is the tool wrapper and the
  product half is `TEAM_ROLES`.
- **Destination (D4):** `theokit core`. Wrapping a shipped function as a tool the agent may call is
  boundary/home wiring — it makes no LLM call, dispatches no tool, owns no storage. `sdk-runtime.md`
  and the ADR-0040 carve-out place exactly this class in core.
- **Rung-1 check (`parsimony-ladder.md`):** does it need to exist? Yes, and the check nearly said no.
  Two of the three candidates dissolved under re-measurement — one was a pure delegation to a
  shipped factory, the other 70% product policy. This one survives because the framework offers no
  path to it at all: `Tool.create({handler: () => delegate(...)})` is reachable, but every argument
  that makes delegation safe (tool inheritance, budget clamping, authority propagation, timeout) is
  then the app's to re-derive — which is what `delegate()` exists to own.
- **Correction on record:** the first draft of this blueprint claimed three missing wrappers. Two
  were a grep artefact. The claim was published and is corrected here rather than silently edited.

## What was NOT read (D2 — mandatory)

- `session/gc/all-sessions.ts` beyond its export surface (442 LoC — the largest in-scope module).
- `review/` bodies: `createReviewAgent`, `runReview`, `parseReviewOutput` were mapped by export
  only. **The framework has no `Review*` export at all** — this is the single largest
  `needs-evidence` area and the natural next discovery slug.
- `pty/` bodies. Note: `@theokit/sdk-pty@0.3.0` **exists** in the SDK repo. Whether TheoCode's
  `createSessionPtyOwner` duplicates it was not verified — if it does, that is a *discoverability*
  finding of the class CLAUDE.md already records ("a capability that exists and is not discoverable
  costs a customer exactly what an absent one costs").
- `goal/` beyond exports; `agent-session/` beyond names; `cli/src/commands/` bodies.
- Budget consumed on Q1–Q3; Q4–Q6 answered at export/manifest depth per D1's stop condition.

## Recommendations

### Follow-up slugs

1. `theocode-review-subsystem` — the framework has zero `Review*` exports; 5 modules unexamined.
2. `theocode-pty-vs-sdk-pty` — duplication or discoverability?
3. `theocode-session-multi-project-gc` — is a cross-project sweep generic or TheoCode-shaped?
