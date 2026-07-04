---
slug: clean-break-proprietary-surface
milestone_id: M3
created_at: 2026-07-04
goal: Remove the pre-M2 proprietary agent surface entirely (AgentEvent + useAgentStream + defineAgentEndpoint + streamAgentRun + createConversationHistory + client tool-cards), migrate the default template to the M2 agents convention, and publish a migration guide — a hard break with no compat layer
---

# Plan: Clean break — remove the proprietary agent surface (M3)

> **Version 1.0** — Delete the proprietary agent surface (8 src files, 1495 LoC) superseded by
> M2; migrate the default template + fixture to `agents/chat.ts` + `useAgent`; delete the two
> demo fixtures; delete/migrate 25 tests; publish a migration guide; CHANGELOG BREAKING/Removed;
> `theokit` majors 0.13.0 → 0.14.0. Grounded in blueprint `clean-break-proprietary-surface`
> + the Q5 lock ("virada total, sem retrocompatibilidade").

## Goal

> After M3, `grep -rE "AgentEvent|useAgentStream" packages/*/src` returns **0**, the proprietary
> `AgentEvent` SSE surface (`defineAgentEndpoint`, `streamAgentRun`, `createConversationHistory`,
> `useAgentStream`, `agent-stream-core`, the client tool-cards) no longer exists, the default
> template ships an `agents/chat.ts` (`defineAgent`) consumed by `useAgent('chat')`, a migration
> guide documents `useAgentStream`→`useChat`/`useAgent` + `defineAgentEndpoint`→`defineAgent`, the
> CHANGELOG marks the BREAKING removal, and the full suite is green (no orphan/dead exports).

## Context

M3 of `ROADMAP.md` (`theokit-ai-first`), depends on shipped M1 + M2. M2 (`theokit@0.13.0`) shipped
the full replacement — the `agents/*.ts` convention (`defineAgent` → `mountAgent` →
`translateToUIMessageStream`) + `useAgent`/`consumeUIMessageStream` — **verified independent** of
the removal set. The proprietary surface is now dead weight + a second way to do the same thing.
Q5 locked a hard break (no compat shim). This is a BREAKING change → `theokit` major.

## Baseline Context (deep review of current state)

| File (REMOVE) | LoC | Role | Surviving caller? |
|---|---|---|---|
| `packages/theo/src/core/contracts/agent-events.ts` | 117 | `AgentEvent` union + `errorToEvent` | none (only removed code + comments) |
| `packages/theo/src/server/agent/stream-agent-run.ts` | 289 | proprietary SSE producer | none (M2 uses `createSdkAgentStream`) |
| `packages/theo/src/server/agent/create-conversation-history.ts` | 362 | theo conversation lifecycle | none (SDK owns storage in M2) |
| `packages/theo/src/server/agent/agent-types.ts` | 21 | back-compat re-export barrel | none |
| `packages/theo/src/server/define/define-agent-endpoint.ts` | 273 | imperative SSE endpoint | fixtures only |
| `packages/theo/src/client/use-agent-stream.ts` | 141 | proprietary hook + derive helpers | fixtures/template only |
| `packages/theo/src/client/agent-stream-core.ts` | 109 | old `AgentEvent` SSE parser | `use-agent-stream` only |
| `packages/theo/src/client/agent-tool-cards.ts` | 147 | tool-card correlator | `use-agent-tool-cards` only |
| `packages/theo/src/client/use-agent-tool-cards.ts` | 36 | tool-card hook | none public |

| File (SURVIVE — untouched or comment-only clean) | Why |
|---|---|
| `packages/theo/src/server/agent/{mount-agent,provider-resolver,configure-agent-registry}.ts` | M2 + SDK integration; provider-resolver shared |
| `packages/theo/src/server/define/define-agent-tool.ts` | pure Zod→SDK tool adapter (comment-only AgentEvent ref) |
| `packages/theo/src/client/{use-agent,consume-ui-message-stream}.ts` | M2 surface (comment-only ref in use-agent) |
| `packages/theo/src/server/define/ui-message-stream-response.ts` | M2 SSE response |

- **Git sha at plan time:** `6dcd5ab`.
- **Barrels:** `server/agent/index.ts` exports ONLY the 3 removed files → collapses empty (EC-4:
  the `./server/agent` package.json subpath is removed OR re-points to survivors). `server/define/index.ts`
  drops one line (`define-agent-endpoint`), keeps `define-agent-tool`. `client/index.ts` drops the
  client-cluster + `AgentEvent` exports. `core/contracts/index.ts` drops the `agent-events` re-export.
- **Comment-only refs (grep→0 requires cleaning):** `use-agent.ts:15`, `define-agent-tool.ts:17`,
  `bare-transform.ts:82`.
- **Glossary:** *proprietary surface* = the AgentEvent-based agent path (M1-era); *M2 surface* =
  the `agents/*.ts` + `useAgent` path (the replacement).

## Prior Art & Related Work

- **M2 replacement** — ADR 0037 + `tests/integration/unified-agent-surface.test.ts` (the exemplar
  `agents/echo.ts` → `mountAgent` → ai `readUIMessageStream`).
- **Migration-guide precedent** — the `docs/migration/` dir convention (referenced by
  `tests/unit/docs-migration-0-3-rollback.test.ts` expecting `docs/migration/0.2-to-0.3.md`).
- **Clean-break precedent** — `ROADMAP.md` M3 risk framing (pre-1.0 beta → hard break acceptable).

## Objective

Delete the proprietary surface, migrate the template + tests, publish the migration guide, mark
the BREAKING CHANGELOG, and cut `theokit@0.14.0` — with the grep→0 gate + a green suite as proof.

## ADRs

### ADR-C1 — Hard removal, no deprecation window

- **Decision.** Delete the surface outright in `theokit@0.14.0` (major); no `@deprecated` shim.
  Migration guide + BREAKING CHANGELOG is the mitigation.
- **Alternatives.** (a) Deprecation window → contradicts Q5 + the grep→0 DoD. (b) Compat re-export
  → keeps the `AgentEvent` wire alive, defeating the gate. Rejected.
- **Consequence.** `theokit` 0.13.0 → 0.14.0; downstream (TheoCode, `@theokit/ui`) migrate via guide.

### ADR-C2 — `AgentEvent` deleted, not kept as an internal wire contract

- **Decision.** Delete `agent-events.ts` entirely; the DoD grep→0 is literal (comments included).
  Type-tests for the contract are deleted with it.
- **Alternatives.** Keep as internal type → nothing surviving consumes it; grep→0 forbids it. Rejected.
- **Consequence.** The only agent wire is `UIMessageStream`.

### ADR-C3 — `./server/agent` public subpath collapses

- **Decision.** After removing the 3 barrel'd files, `server/agent/index.ts` is empty. Remove the
  `./server/agent` export from `packages/theo/package.json` (breaking, acceptable in a major). The
  surviving `server/agent/*` files (mount-agent, provider-resolver) stay INTERNAL (consumed by the
  vite-plugin / cli, not a public subpath).
- **Alternatives.** Re-point the barrel to `provider-resolver` → no evidence any app imports it
  publicly (YAGNI). Rejected unless a consumer is found.
- **Consequence.** One fewer public subpath; internal survivors reached via relative imports.

## Drawbacks & Risks

1. **Downstream breakage** (ROADMAP risk 1) — TheoCode / `@theokit/ui` consuming `AgentEvent` /
   `useAgentStream` break. Mitigated by the migration guide + explicit BREAKING CHANGELOG + major
   bump (pre-1.0 beta makes it acceptable). No code mitigation in-repo (separate repos migrate).
2. **Orphan code after removal** (ROADMAP risk 2) — deleting `use-agent-stream` could leave
   `agent-tool-cards`/`use-agent-tool-cards` as orphan exports. Mitigated by deleting the whole
   cluster + the `/code-quality` D1 knip gate (must be clean, EC-7).
3. **Template ↔ fixture drift** (EC-5) — the migration must be applied to BOTH the template AND
   its fixture copy, or the fixture test diverges. Mitigated by migrating both in the same phase +
   the fixture test asserting the new shape.
4. **Hidden internal importer** — some non-fixture file might import a removed export; tsc catches
   it (a removed export with a surviving importer = type error). The per-phase tsc gate is the net.

## Unresolved Questions

(none — the blueprint settled EC-1..EC-7 + the 3 ADRs; the removal boundary is verified.)

## Dependencies

| Dependency | Version | Rule 9 (present?) | CVE gate |
|---|---|---|---|
| (none new) | — | M3 is removal + migration | n/a |
| `ai` (M2 consumer, template) | ^7 (peer) | yes | n/a |

No new dependency. Removal reduces surface + LoC.

## Dependency Graph

```
Phase 1 (server surface delete + barrels)  ─┐
Phase 2 (client cluster delete + barrel)   ─┤ (independent deletes; tsc after each)
        ↓                                    │
Phase 3 (tests dispose + delete 2 fixtures) ←┘  (needs 1+2 done so deleted-code tests go)
        ↓
Phase 4 (migrate default template + fixture + skill docs + grep→0 gate)  (needs surface gone)
        ↓
Phase 5 (migration guide + CHANGELOG BREAKING + major changeset)  (needs 1–4 green)
```

## Phase 1: Remove the server proprietary surface

#### Objective
Delete the 5 server files + clean the server barrels + reword the surviving comment + adjust the
`./server/agent` subpath (ADR-C3).

#### Why this step (action + reasoning)
The server surface is the root of the proprietary wire; removing it first surfaces every importer
via tsc. `create-conversation-history` is safe to delete (EC-1: SDK owns storage in M2).

#### Evidence
- Deletion targets + LoC: Baseline table. `server/agent/index.ts` = only the 3 removed files.
- M2 independence: `mount-agent.ts` imports `@theokit/agents`, not `stream-agent-run` (verified).

#### Files to edit
- DELETE: `core/contracts/agent-events.ts`, `server/agent/{stream-agent-run,create-conversation-history,agent-types}.ts`, `server/define/define-agent-endpoint.ts`
- EDIT: `server/agent/index.ts` (empty → or remove), `server/define/index.ts` (drop 1 line), `core/contracts/index.ts` (drop agent-events re-export), `packages/theo/package.json` (remove `./server/agent` subpath), `server/define/define-agent-tool.ts` (reword comment L17)

#### Deep file dependency analysis
`provider-resolver.ts` (imported by the removed create-conversation-history AND M2 mount-agent)
must remain (EC-2). After deletion, any surviving importer of a removed symbol → tsc error (the net).

#### Deep Dives
`server/index.ts:74` does `export * from './agent/index.js'` — with the barrel empty, this re-export
is harmless (exports nothing) but should be removed for cleanliness if the subpath is dropped.

#### Pseudo-code / Signatures
(pure deletion — no new signatures.)

#### Tasks
- T1.1 Delete the 5 server files.
- T1.2 Clean `server/agent/index.ts` + `server/define/index.ts` + `core/contracts/index.ts` + `server/index.ts` barrels.
- T1.3 Remove `./server/agent` from `package.json` exports (ADR-C3); reword `define-agent-tool.ts:17` comment.

#### TDD
- T1.1 RED→GREEN: the existing tests for the removed code (`stream-agent-run.test.ts`,
  `define-agent-endpoint.test.ts`, `create-conversation-history.test.ts`, …) are deleted in Phase 3;
  BEFORE that, tsc is the gate — `npx tsc -p packages/theo/tsconfig.json` must reach 0 errors after
  the barrels are cleaned (every importer migrated/removed). The RED is "tsc errors on dangling
  imports"; GREEN is "0 tsc errors".
- T1.3 assertion: `node -e "require('./packages/theo/package.json').exports['./server/agent']"` is undefined.

#### Concurrency tests (only when applicable)
(none — deletion.)

#### Failure scenarios (external I/O)
(none — no I/O touched; provider-resolver's env-resolution survives untouched.)

#### Acceptance Criteria
- The 5 files gone; barrels clean; `./server/agent` subpath removed; `define-agent-tool` survives + comment reworded; `theokit` tsc 0 errors (after Phase 3 removes the now-dangling tests).

#### DoD
- Server surface deleted; tsc green; CHANGELOG updated; provider-resolver + define-agent-tool intact.

## Phase 2: Remove the client proprietary cluster

#### Objective
Delete the 4 client files + clean `client/index.ts` + remove the `use-agent-stream` coverage-exclude
+ reword the `use-agent.ts` comment.

#### Why this step (action + reasoning)
The client cluster is a self-contained tree (`use-agent-tool-cards` → `agent-tool-cards` +
`use-agent-stream` → `agent-stream-core` → `AgentEvent`). Deleting it whole prevents orphans (EC-7).

#### Evidence
- Cluster + barrel lines: blueprint Corner 1/4. M2 `use-agent.ts`/`consume-ui-message-stream.ts`
  import only `ai` (verified independent).
- Coverage-exclude: `vitest.config.ts` excludes `use-agent-stream.ts` (line ~92) — remove it.

#### Files to edit
- DELETE: `client/{use-agent-stream,agent-stream-core,agent-tool-cards,use-agent-tool-cards}.ts`
- EDIT: `client/index.ts` (drop the cluster + AgentEvent exports; keep useAgent/consumeUIMessageStream), `vitest.config.ts` (drop the `use-agent-stream.ts` exclude), `client/use-agent.ts` (reword comment L15)

#### Deep file dependency analysis
`use-agent.ts` + `consume-ui-message-stream.ts` MUST remain exported (M2). Confirm no surviving
non-test file imports the removed client exports (tsc net).

#### Deep Dives
`client/index.ts` also re-exports `AgentEvent` from core/contracts (lines ~57-66) — that re-export
dies with `agent-events.ts` (Phase 1); remove the lines here.

#### Pseudo-code / Signatures
(pure deletion.)

#### Tasks
- T2.1 Delete the 4 client files.
- T2.2 Clean `client/index.ts` (remove cluster + AgentEvent exports).
- T2.3 Remove the `use-agent-stream.ts` coverage-exclude; reword `use-agent.ts:15`.

#### TDD
- T2.1/T2.2 RED→GREEN: tsc on `packages/theo` reaches 0 errors after the barrel is cleaned; the
  M2 surface (`useAgent`, `consumeUIMessageStream`) still exports (assert via a smoke import test
  `tests/smoke/import-validation.test.ts` if it checks client exports, else a new tiny assertion).
- T2.3 assertion: `vitest.config.ts` no longer lists `use-agent-stream.ts`.

#### Concurrency tests (only when applicable)
(none.)

#### Failure scenarios (external I/O)
(none — client hooks removed; M2 fetch path untouched.)

#### Acceptance Criteria
- 4 client files gone; `client/index.ts` exports only the M2 surface + non-agent client APIs; tsc 0 errors; coverage-exclude cleaned.

#### DoD
- Client cluster deleted; no orphan export (knip clean, verified in code-quality); tsc green.

## Phase 3: Dispose the tests + delete the two demo fixtures

#### Objective
Delete the ~16 tests of removed code, delete `fixtures/use-agent-stream-react/` +
`fixtures/agent-endpoint-mock/`, and fix `fixtures/README.md` + `fixtures-index.test.ts`.

#### Why this step (action + reasoning)
Deleted code's tests must go (they won't compile). The demo fixtures exist only to showcase the
removed surface — a clean break deletes them (ADR-C1; the wire reference is now the M2 E2E).

#### Evidence
- Test disposition table (blueprint Corner 1). Fixtures: `use-agent-stream-react`,
  `agent-endpoint-mock` use `defineAgentEndpoint`/`useAgentStream`.
- `fixtures-index.test.ts` already fails on a stale `ui-message-stream-skeleton` entry — fix in passing.

#### Files to edit
- DELETE tests: `use-agent-stream.test.ts`, `define-agent-endpoint*.test.ts` (+params), `regression-1/2-define-agent-endpoint-*.test.ts`, `stream-agent-run*.{test,test-d}.ts`, `stream-agent-run-error-discrim.test.ts`, `agent-stream-derivations.test.ts`, `agent-event-type.test-d.ts`, `tests/type/agent-thinking-event.test-d.ts`, `create-conversation-history*.{test,test-d}.ts`, `create-conversation-history-storage.test.ts`, `define-agent-endpoint-signal.test.ts`, `fixture-agent-endpoint.test.ts`, `fixture-use-agent-stream-react.test.ts`
- DELETE fixtures: `fixtures/use-agent-stream-react/`, `fixtures/agent-endpoint-mock/`
- EDIT: `fixtures/README.md` (drop the two dirs + the stale `ui-message-stream-skeleton` row), `architecture-guards-ci.test.ts` (if it references the surface)

#### Deep file dependency analysis
Any `tests/integration/_helpers/*` that builds the deleted fixtures must be updated/removed.

#### Deep Dives
`architecture-guards-ci.test.ts` may encode a boundary rule mentioning the surface — verify it does
not assert the removed exports exist (would false-fail); update if so.

#### Pseudo-code / Signatures
(deletion + list edits.)

#### Tasks
- T3.1 Delete the ~16 removed-code tests.
- T3.2 Delete the 2 demo fixtures + their `_helpers` + the `README.md`/`fixtures-index` entries.
- T3.3 Verify `architecture-guards-ci.test.ts` green.

#### TDD
- T3.1/T3.2 RED→GREEN: `npx vitest run` on the affected areas — RED before deletion (tests
  reference removed code → compile errors); GREEN after (suite compiles + passes). `fixtures-index.test.ts`
  flips RED→GREEN (stale entry fixed).

#### Concurrency tests (only when applicable)
(none.)

#### Failure scenarios (external I/O)
(none.)

#### Acceptance Criteria
- All removed-code tests gone; 2 fixtures gone; `fixtures-index.test.ts` green; no dangling `_helpers`.

#### DoD
- Suite compiles; the only agent tests left are M2 + the migrated template tests; CHANGELOG updated.

## Phase 4: Migrate the default template + fixture + grep→0 gate

#### Objective
Migrate `packages/create-theokit/templates/default/` + `fixtures/template-default/` from the old
surface to `agents/chat.ts` (`defineAgent`) + `useAgent('chat')`; update the skill docs; add the
grep→0 gate test.

#### Why this step (action + reasoning)
DoD line 3: examples + default template migrated + green. The template is the first thing a user
scaffolds — it must showcase the M2 convention. The grep→0 gate is DoD line 1's executable proof.

#### Evidence
- Template files: `templates/default/{app/page.tsx,server/routes/chat.ts,CLAUDE.md,dot-claude/skills/*}`.
- M2 exemplar shape: `tests/integration/unified-agent-surface.test.ts` (`defineAgent` + `useAgent`).
- `bare-transform.ts:82` comment reworded (grep→0).

#### Files to edit
- `templates/default/agents/chat.ts` (NEW — `export default defineAgent({...})`), delete `templates/default/server/routes/chat.ts`
- `templates/default/app/page.tsx` (`useAgentStream` → `useAgent('chat')`)
- `templates/default/dot-claude/skills/theokit-{agents,frontend,ui}/SKILL.md` + `CLAUDE.md` (drop old surface, show M2)
- Mirror ALL of the above into `fixtures/template-default/` (EC-5)
- `packages/create-theokit/src/bare-transform.ts` (reword comment L82; ensure the bare scaffold drops `agents/chat.ts` now, not `server/routes/chat.ts`)
- `tests/unit/clean-break-grep-gate.test.ts` (NEW — asserts `grep -rE "AgentEvent|useAgentStream" packages/*/src` = 0)
- MIGRATE tests: `fixture-template-default-canonical-chat.test.ts`, `template-default*.spec.ts` (e2e), `scaffold-default-agent.test.ts`, `create-theo-default-template.test.ts`, `create-theokit-bare.test.ts`, `scaffold-no-openai-anti-stack.test.ts`

#### Deep file dependency analysis
The template scaffold generator (`create-theokit`) must emit `agents/chat.ts`; the scaffold tests
assert the new tree. The `bare-transform` deletes `agents/chat.ts` in `--bare` (parity with old
`server/routes/chat.ts` deletion).

#### Deep Dives
`app/page.tsx` migration: `const { events } = useAgentStream('/api/agent')` → `const { messages, send } = useAgent('chat')`;
render `messages` (UIMessage[]) instead of switching on `event.type`. Mirror the M2 E2E's consumption.

#### Pseudo-code / Signatures
```ts
// templates/default/agents/chat.ts
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'
export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'openai/gpt-4o-mini',
  system: 'You are a helpful assistant.',
})
```

#### Tasks
- T4.1 Add `agents/chat.ts` + migrate `app/page.tsx` in BOTH template + fixture; update skill docs + CLAUDE.md.
- T4.2 Update `bare-transform.ts` (drop `agents/chat.ts` in bare; reword comment) + the scaffold generator to emit `agents/`.
- T4.3 Add the grep→0 gate test; migrate the ~7 template/scaffold tests to the M2 shape.

#### TDD
- T4.3 RED: `test_no_proprietary_agent_surface_in_src` — `grep -rE "AgentEvent|useAgentStream" packages/*/src`
  count == 0. RED now (11 files), GREEN after Phases 1–2 + comment rewordings.
- T4.1 RED: `fixture-template-default-canonical-chat.test.ts` asserts `agents/chat.ts` exports
  `defineAgent` + `app/page.tsx` imports `useAgent`. RED against the old template, GREEN after migration.
- T4.2 RED: `scaffold-default-agent.test.ts` asserts the scaffolded tree has `agents/chat.ts`.

#### Concurrency tests (only when applicable)
(none.)

#### Failure scenarios (external I/O)
- The template E2E (`template-default*.spec.ts`) drives a real dev server; if the migrated
  `agents/chat.ts` fails to mount, the E2E 404s → RED. This is the parity guard (the built server
  must serve the migrated agent). Assert it renders via `useAgent`.

#### Acceptance Criteria
- Default template + fixture ship `agents/chat.ts` + `useAgent`; skill docs show only M2; grep→0
  gate GREEN; the migrated template tests + E2E GREEN.

#### DoD
- grep→0 passes; template scaffolds + runs on the M2 surface; all migrated tests green; CHANGELOG updated.

## Phase 5: Migration guide + BREAKING CHANGELOG + major changeset

#### Objective
Publish `docs/migration/0.13-to-0.14-agent-surface.md`, mark the CHANGELOG BREAKING/Removed, and add
the `theokit` major changeset.

#### Why this step (action + reasoning)
DoD line 2 (migration guide) + line 3 (CHANGELOG BREAKING). The changeset drives `theokit@0.14.0`.

#### Evidence
- Migration-guide dir: `docs/migration/` (the `docs-migration-0-3-rollback.test.ts` convention).
- Changeset pattern: `.changeset/*.md` with `"theokit": major`.

#### Files to edit
- `docs/migration/0.13-to-0.14-agent-surface.md` (NEW — the guide, blueprint Corner 4 § migration guide)
- `CHANGELOG.md` (`### Removed` + `### Changed` with `BREAKING:` prefix)
- `.changeset/clean-break-proprietary-surface.md` (NEW — `"theokit": major`)
- `tests/unit/migration-guide-clean-break.test.ts` (NEW — asserts the guide documents both migrations)

#### Deep file dependency analysis
The changeset `major` on `theokit` triggers 0.14.0 at Version Packages. `@theokit/agents` is NOT
in the changeset (untouched).

#### Deep Dives
The guide's before/after uses the migrated template as the canonical example (consistency).

#### Pseudo-code / Signatures
(docs + changeset.)

#### Tasks
- T5.1 Write the migration guide (removed-exports table + before/after for both migrations + wire-format note).
- T5.2 CHANGELOG `### Removed` + `BREAKING:` `### Changed`; add the major changeset.
- T5.3 Add the guide-content test.

#### TDD
- T5.3 RED: `test_migration_guide_covers_both_migrations` — asserts the guide contains
  `useAgentStream` → `useAgent` AND `defineAgentEndpoint` → `defineAgent` sections + a removed-exports
  table. RED before writing, GREEN after.
- T5.2 assertion: CHANGELOG `[Unreleased]` has a `### Removed` entry naming the surface; the changeset declares `theokit: major`.

#### Concurrency tests (only when applicable)
(none.)

#### Failure scenarios (external I/O)
(none.)

#### Acceptance Criteria
- Guide published + covers both migrations + removed-exports table; CHANGELOG BREAKING/Removed;
  `theokit: major` changeset present.

#### DoD
- Guide + CHANGELOG + changeset in place; guide-content test green; ready for release (0.14.0).

## Coverage Matrix

| Goal claim (DoD) | Task(s) | Test |
|---|---|---|
| `grep AgentEvent\|useAgentStream packages/*/src` = 0 | T1.*, T2.*, T4.3 (comments T1.3/T2.3/T4.2) | `clean-break-grep-gate.test.ts` |
| Server proprietary surface removed | T1.1, T1.2 | tsc 0 errors + deleted tests (T3.1) |
| Client proprietary cluster removed (no orphan) | T2.1, T2.2 | tsc + `/code-quality` D1 knip clean (T2 DoD) |
| `createConversationHistory` safely removed (EC-1) | T1.1 | tsc + M2 E2E still green (`unified-agent-surface.test.ts`) |
| `provider-resolver`/`define-agent-tool` survive (EC-2) | T1.* | their tests still green |
| Removed-code tests + 2 demo fixtures deleted | T3.1, T3.2 | suite compiles; `fixtures-index.test.ts` green |
| Default template migrated to `agents/chat.ts` + `useAgent` | T4.1 | `fixture-template-default-canonical-chat.test.ts` (migrated) |
| Scaffold emits `agents/*.ts` | T4.2 | `scaffold-default-agent.test.ts` (migrated) |
| Template E2E green on M2 surface | T4.1 | `template-default*.spec.ts` (migrated) |
| Migration guide published (both migrations) | T5.1 | `migration-guide-clean-break.test.ts` |
| CHANGELOG BREAKING/Removed + major bump | T5.2 | changeset `theokit: major` + CHANGELOG `### Removed` |

## Test Plan

- **Removal safety net:** tsc (`packages/theo`) at 0 errors after each phase — a removed export with
  a surviving importer is a compile error (the primary net).
- **The grep→0 gate:** `clean-break-grep-gate.test.ts` — the DoD's executable proof.
- **Regression:** the M2 suite (49 tests incl. `unified-agent-surface.test.ts`) stays green —
  proves the removal did not touch the replacement.
- **Dead-code:** `/code-quality` D1 (knip) clean — no orphan export after the cluster deletion (EC-7).
- **Template:** migrated `fixture-template-default-canonical-chat.test.ts` + E2E green on the M2 surface.
- **Guide:** `migration-guide-clean-break.test.ts` asserts both migrations + removed-exports table.
