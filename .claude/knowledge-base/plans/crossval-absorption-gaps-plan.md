---
slug: crossval-absorption-gaps
created_at: 2026-08-14
goal: Close the 12 gaps registered by the 2026-08-14 TheoKit↔TheoCode cross-validation
---

# Plan: Close the 12 absorption gaps found by the TheoCode cross-validation

> **Version 1.1** — absorbed the 7 MUST FIX items from
> [`knowledge-base/reviews/crossval-absorption-gaps-edge-cases-2026-08-14.md`](../reviews/crossval-absorption-gaps-edge-cases-2026-08-14.md)
> (EC-1 fork self-overwrite, EC-2 scope canonicalization, EC-3 longest-prefix-wins, EC-4 green-by-absence,
> EC-5 store path + mode repair, EC-6 late-filed changelog entry, EC-7 warn-mode sunset). The review's
> central observation drove all of them: when absorbing a consumer's module, absorb its **scar tissue**,
> not just its interface — three of the seven are defects the consumer already hit and solved.
>
> **Version 1.0** — The 2026-08-14 cross-validation measured TheoKit against TheoCode, its only real consumer (`@theokit/agents ^8.6.0`), and scored it **3,11/5** across 15 dimensions. The 12 registered gaps are not what the framing predicted: only two are "we never built it". The rest split between *built and unreachable* and *built, published, and unusable by the case that motivated it* — including a primitive that ships a correct signature over an implementation that always throws. The plan below closes all 12, and closes the root cause: the CI gate that would have caught every one of them exists and covers 1 of 19 subpaths.

## Goal

> Enable a developer building an agent app on TheoKit to reach every capability the framework already ships — and be blocked by CI when the layer stops forwarding one — measured by `tests/integration/crossval-gaps.test.ts` passing with 12/12 gap-closure assertions green.

## Context

The cross-validation (`cross-validation-output/final_report.md`, 2026-08-14) used TheoCode as the proxy for a hypothetical customer "EmpresaCode": it depends on `@theokit/agents ^8.6.0` — this repository's own package — so every line it wrote is measurable evidence of a capability the framework failed to deliver *in a usable form*.

The finding that reframes the work: **the absorption cycle works when it is triggered, and is almost never triggered.** The `Toolset` docstring cites `agents/tools/registry.ts` from the consumer by name as the reason the primitive exists. Five absorptions (U-1, U-3, U-4, U-6, M79 `resolveCredential`) are verified as published in 8.6.0 — and the consumer's `BACKLOG.md:429-438` still lists four of them as open, with three live reimplementations in its code.

The damage is not hypothetical. Because `loadInstructionTree`/`composeInstructions` are reachable only through a barrel that announces its own removal, TheoCode rewrote 533 LOC of instruction-tree loading and **reintroduced the symlink-containment flaw** that the framework's `assertNoSymlinkEscape` exists to close: with `rootDir='/'`, any file on the machine became readable into the system prompt (its `agents-md.ts:121-125`, filed as B-042 on their side).

The root cause is structural and already diagnosed *by this repository*: `scripts/check-auth-parity.mjs:9-13` narrates that when `@theokit/agents/auth` exported 1 value against the SDK's 19, *"reimplementing was the only legal way out"* for the consumer. The gate it installs — every SDK symbol needs a written decision in the layer, or CI breaks — covers exactly one subpath (`DECISIONS` at `:49` has a single key: `auth`). `@theokit/agents` publishes 19.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/session/session-lifecycle.ts` | 279 | `164cbfec` (2026-08-14) | Session lifecycle: `listSessions`, `protectedTranscripts:126`, `deleteSession`, `forkBeforeUserTurn:220`, private `recordIndexOfUserTurn:266` | `forkBeforeUserTurn` public signature unchanged; `nth` stays 1-based (`:217-218`); truncation stays delegated to the SDK's `forkTranscript` (`:214-215`) |
| `packages/agents/src/session/gc/transcript-gc.ts` | 207 | `164cbfec` (2026-08-14) | Transcript GC with retention floor + plan/apply; imports `protectedTranscripts` at `:6` | The 4 GC invariants and the `GCFloorError` refusal stay; dry-run stays the default |
| `packages/agents/src/session/index.ts` | 40 | `164cbfec` (2026-08-14) | `./session` barrel — re-exports `forkBeforeUserTurn:10`, `protectedTranscripts:12`, `TranscriptGCOptions:38` | Every symbol currently exported stays exported (no narrowing) |
| `packages/agents/src/auth/resolve-credential.ts` | 194 | `164cbfec` (2026-08-14) | M79 — env-only credential resolution with `ProviderDescriptor`/`SourceOrigin`/`CredentialResolution` | `resolveCredential` returns `undefined` on "nothing configured" (documented at `dist/auth.d.ts:258-262`); descriptors stay a parameter (app policy) |
| `packages/agents/src/hooks/hook-fingerprint.ts` | 56 | `164cbfec` (2026-08-14) | sha256 per-hook gate; `approved` is a required argument, deny-by-default | Deny-by-default stays; `approved` stays required (adding a default would silently open the gate) |
| `packages/agents/src/hooks/index.ts` | 30 | `164cbfec` (2026-08-14) | `./hooks` barrel | No narrowing of current exports |
| `packages/agents/src/bridge/delegation-lifecycle.ts` | 104 | `164cbfec` (2026-08-14) | `withClockCap`, `DelegationTimeoutError`, `withEphemeralAgent` | Existing exports and their `isRetryable` semantics unchanged |
| `packages/agents/src/testing/inspect-compiled.ts` | (see note) | `164cbfec` (2026-08-14) | `inspectCompiled(definition: AgentDefinition)` at `:50` — test seam typed over `AgentDefinition` | The `CompiledInspection` shape stays source-compatible for any existing caller |
| `packages/agents/src/tools/index.ts` | 12 | `26ad3db0` (2026-08-14) | `./tools` barrel — re-exports SDK tool factories incl. raw `createShellTool` | Existing named exports stay (removal is a breaking change) |
| `packages/agents/package.json` | 127 | `70d8dc73` (2026-08-14) | `@theokit/agents@8.6.0`; `files: ['dist','README.md','LICENSE']`; 19 export subpaths | `exports` map only grows; `files` only grows |
| `packages/agents/README.md` (NEW) | 0 | — | (to be created — declared in `files` and absent on disk, so npm omits it silently) | — |
| `packages/agents/CHANGELOG.md` | ~2.4k | `164cbfec` (2026-08-14) | Correct per-package changelog, 114 KB, **not listed in `files`** so never shipped | Content preserved; only the `files` field changes |
| `packages/theo/src/server/index.ts` | 226 | `164cbfec` (2026-08-14) | Self-declared DEPRECATED umbrella barrel (`:1-15`); sole door to `LayeredConfig:162`, `TrustStore:170`, `loadCustomCommands:179`, `loadInstructionTree:196`, `composeInstructions:203`, `contextPressure:209`, `loadEnv:217` | Stays working for one more minor (its own promise); re-exports are added, never removed |
| `scripts/check-auth-parity.mjs` | 209 | `c4bd6d4b` (2026-08-12) | M73 surface-parity gate; `DECISIONS:49` has one key (`auth`), `PISO_DE_SIMBOLOS:43` = `{auth:15}`; exits 1 on undecided symbol (`:206`) | The "decision, not coverage" contract (`:16-24`) is the design and MUST NOT become a coverage demand; anti-vacuity floor stays |
| `package.json` (root) | — | (existing) | `check:auth-parity` wired into `check:all` | `check:all` keeps chaining every gate |
| `CHANGELOG.md` | 3474 | `f2020587` (2026-08-14) | Keep-a-Changelog; last version heading is `8.1.0` at `:70`; 8.2.0–8.6.0 stranded in `[Unreleased]` at `:7` | Never edit already-released entries (Unbreakable Rule 6) |
| `README.md` | 506 | `21dde4da` (2026-07-09) | Public README; `:317` teaches `import { defineRoute } from 'theokit/server'`, removed from the public API per ADR-0043 D1 | Voice/tone per `rules/public-copy.md`; DEEP DIVE names APIs |
| `CLAUDE.md` | 325 | `a46a2c70` (2026-08-06) | Ecosystem table lists 5 siblings; the group has 11 repos | Table is the source of truth for what TheoKit integrates with |
| `wiki/capability-index.md` (NEW) | 0 | — | (to be created — capability → symbol → version-it-landed-in) | — |
| `tests/integration/crossval-gaps.test.ts` (NEW) | 0 | — | (to be created — the executable gap register; the Goal's metric) | One assertion per registered gap; no mocks for filesystem facts |
| `packages/agents/src/auth/permission-store.ts` (NEW) | 0 | — | (to be created — persisted tool-permission grants) | — |
| `packages/agents/src/auth-entry.ts` | 47 | `164cbfec` (2026-08-14) | The `./auth` subpath entry — this package uses a flat `*-entry.ts` convention, **not** directory barrels (`auth/` holds only `auth-provider.ts`, `device-provider.ts`, `resolve-credential.ts`) | No narrowing of current exports (G7: each new export ships with a test); the `-entry.ts` convention is followed by any new subpath |
| `packages/agents/src/hooks/approval-store.ts` (NEW) | 0 | — | (to be created — the producer of the `approved` set the fingerprint gate requires) | — |
| `packages/agents/src/config-entry.ts` (NEW) | 0 | — | (to be created — the `./config` subpath entry; mirrors the existing `auth-entry.ts` / `persistence-entry.ts` naming) | — |
| `scripts/check-surface-parity.mjs` (NEW via `git mv`) | 209 | `c4bd6d4b` (2026-08-12) | (renamed from `check-auth-parity.mjs`; same file, generalized) | The "decision, not coverage" contract and the anti-vacuity floor survive the rename |
| `.claude/knowledge-base/audits/2026-08-14-theocode-crossval.md` (NEW) | 0 | — | (to be created — promotes the report out of gitignored `cross-validation-output/` so citations resolve in a fresh clone) | Content copied verbatim; only a provenance header is added |

**Test files created by this plan** (all NEW, LoC 0, no prior commit — listed separately to keep the table above readable):

| File | Created by | Purpose |
|---|---|---|
| `packages/agents/tests/unit/session-fork.test.ts` | T1.1 | Fixture-driven `forkBeforeUserTurn` regression suite |
| `packages/agents/tests/unit/inspect-compiled.test.ts` | T1.2 | Inspect the real builder composition output |
| `packages/agents/tests/integration/config-subpath.test.ts` | T2.1 | `@theokit/agents/config` exports + single module identity |
| `packages/agents/tests/unit/delegation-hook-inheritance.test.ts` | T3.1 | Veto inheritance, transitive + concurrent |
| `packages/agents/tests/unit/hook-approval-store.test.ts` | T3.2 | approved/unknown/modified + fail-closed + torn-write |
| `packages/agents/tests/unit/permission-store.test.ts` | T3.3 | Scope/signature isolation, expiry, fail-closed |
| `packages/agents/tests/unit/resolve-credential.test.ts` | T4.1 | The four M79 completions + `.env` parser |
| `packages/agents/tests/unit/transcript-gc-protection.test.ts` | T4.2 | Additive-only protection, fail-closed, TOCTOU |
| `scripts/__tests__/check-surface-parity.test.mjs` | T5.1 | Gate behaviour: enumeration, warn/error split, anti-vacuity |

Verified against the runner config (pre-flight per `SKILL.md § Pre-flight path validation`): root `test` is `vitest run` with no path restriction, and `packages/agents/tests/{unit,integration}/` plus `tests/integration/` are already discovered (95 files under `tests/integration/`, and `packages/agents` has its own `test` script). `scripts/__tests__/*.test.mjs` is the one path with **no existing precedent in this repo** — T5.1 therefore includes adding it to the vitest include globs in the same task, or relocating the test under `tests/unit/` if the glob change is contentious.

**Sibling-repo files are deliberately absent from this table.** `../theokit-tui/src/...` and `../theokit-tui/tests/...` (T6.1) live in a repository this plan does not govern (D7); their baseline belongs to that repo's own PR. The only file T6.1 changes *here* is the gap register.

### Current callers / dependents

- **Symbol:** `forkBeforeUserTurn` in `packages/agents/src/session/session-lifecycle.ts:220`
  - **Callers (production):** none in `packages/` — only the barrel re-export at `packages/agents/src/session/index.ts:10`.
  - **Callers (tests):** **none** (`grep -rln forkBeforeUserTurn packages/agents/tests` returns nothing).
  - **External:** yes — published on the `./session` subpath (`packages/agents/dist/session.d.ts:94,238`). Any consumer doing session rewind is a caller.
- **Symbol:** `recordIndexOfUserTurn` (private) in `session-lifecycle.ts:266`
  - **Callers (production):** `forkBeforeUserTurn:235` only.
- **Symbol:** `protectedTranscripts` in `session-lifecycle.ts:126`
  - **Callers (production):** `session-lifecycle.ts:193`, `:247`; `session/gc/transcript-gc.ts:6`.
  - **External:** yes — exported on `./session` (`index.ts:12`).
- **Symbol:** `resolveCredential` in `packages/agents/src/auth/resolve-credential.ts:137`
  - **External:** yes — published at `dist/auth.d.ts:263`. TheoCode does **not** import it (its `credentials.ts:8-16` imports six other symbols and reimplements this one).
- **Symbol:** `inspectCompiled` in `packages/agents/src/testing/inspect-compiled.ts:50`
  - **Callers (tests):** none in this repo; the consumer's `composition.test.ts:1-19` documents why it *cannot* use it.
- **Symbol:** `LayeredConfig` / `TrustStore` / `loadInstructionTree` / `composeInstructions` / `loadCustomCommands` / `contextPressure` / `loadEnv`
  - **Callers (production):** reachable only via `packages/theo/src/server/index.ts:162,170,179,196,203,209,217`. `packages/theo/package.json` declares 24 subpaths and **no `./config`**.

### Domain glossary

- **Subpath** — an entry in a package's `exports` map (`@theokit/agents/auth`). The unit the parity gate reasons about.
- **Surface parity** — M73's rule: every symbol the SDK exposes on a subpath has a *written decision* in the layer (`covered`, `re-exported`, or out-with-reason). Not coverage — a decision.
- **Absorption** — a capability first written by a consumer, then moved into the framework so no consumer writes it again.
- **Transcript record** — one JSONL line of a session. Top level carries `type: "user"|"assistant"|"system"`; the `role` lives nested at `message.role`.
- **Protected transcript** — a session the GC must refuse to delete because it is live (writer lease or pointer).
- **Fingerprint gate** — the sha256-of-command check that refuses to run a repo hook whose command changed after approval.

### Architecture boundaries affected

- **G1 (dependency direction)** — all new modules live inside `packages/agents/src/`, which depends on `@theokit/http` and the SDK, never on `theokit` core. No new cross-package edge. `packages/theo/src/server/` stays where it is; only its `exports` surface is discussed.
- **G2 / `sdk-runtime.md` (SDK is the only runtime)** — untouched. Nothing here calls an LLM, dispatches a tool, or stores a conversation. `forkBeforeUserTurn` keeps delegating truncation to the SDK's `forkTranscript`.
- **ADR-0040 carve-out (runtime vs home)** — `PermissionStore` and the hook `approval-store` are **home/boundary**: human gates and consent, explicitly named in the carve-out as framework-core, not runtime. They reuse SDK primitives and reimplement none.
- **G6 (file size)** — every new file budgeted ≤ 500 LoC; `session-lifecycle.ts` is at 279 and gains ~15.
- **G7 (every export has a consumer)** — every new export ships with a test in the same phase.

## Prior Art & Related Work

- **Internal plan** — `knowledge-base/plans/ecosystem-integration-guarantee-plan.md` (M48) established this repo's seam-guarantee pattern: consumer contract test + producer mirror gated by `prepublishOnly` + a version-drift guard. Phase 5 of this plan applies the same shape to the layer's own re-export surface rather than to a type mirror.
- **In-repo gate as prior art** — `scripts/check-auth-parity.mjs:16-24` documents the "decision per symbol, not coverage" contract and the lesson *"a gate nobody can make green is a gate nobody reads"*. T5.1 generalizes that script; it does not redesign it.
- **Sibling gate** — `scripts/check-package-direction.mjs:12-13` reads the consumed set from the principal's own manifest so the guard stays correct as packages come and go. Phase 5 borrows that technique to enumerate subpaths from `package.json#exports` instead of a hand-kept list.
- **Cross-validation evidence** — `cross-validation-output/final_report.md` (12 gaps, 58 findings, 27 comparisons, 89 reference files) and `cross-validation-output/baseline/{target,reference}/architecture_map.md`. Note: this directory is gitignored (`.gitignore:21`), so Phase 0 T0.4 promotes the report into the repo before any task cites it as a durable source.
- **Consumer's own upstream register** — TheoCode `BACKLOG.md:421-441` (U-1…U-11), the pre-existing list this cross-validation re-measured. Four entries are stale-open; one (U-11's class-hierarchy half) was measured **superseded in TheoKit's favour** (20/21 typed vs the consumer's 12/14).
- **Patterns skills** — scanned `skills/*-patterns/`: the only one present is `theokit-http-decorators-pattern-from-nestjs-patterns`, whose triggers (NestJS decorators, `@UseGuards`, `theokit generate controller`, DTO→Zod) do not intersect this plan's title or Goal. Not applicable; no override ADR needed.

## Dependencies

> Required by [`deps-audit-golden-rule.md`](../../rules/deps-audit-golden-rule.md) § 3 hard cap #4.
> Audited 2026-08-14 — report at [`audits/crossval-absorption-gaps-deps-audit-2026-08-14.md`](../audits/crossval-absorption-gaps-deps-audit-2026-08-14.md).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `^4.49.0` (optional peer) | npm | Source of `assertSecureModes` (T3.2, T3.3 — reused instead of hand-rolling the permission check, `parsimony-ladder.md` rung 4), `forkTranscript` (T1.1 keeps delegating truncation), `SessionRecord` (T1.1's record shape), and the OAuth engine T4.1 does not touch |
| `zod` | (existing range) | npm | T4.1 validates the credential file with the schema library already in the dependency set — no new validator |
| `vitest` | `^3` (dev) | npm | Every RED test in every phase; already the project runner (`test: "vitest run"`) |
| `node:fs` / `node:crypto` (stdlib) | — | node | T3.2/T3.3 atomic write + `realpathSync` (EC-2) + `chmodSync` (EC-5); sha256 for fingerprints. `parsimony-ladder.md` rung 2 — stdlib before any dependency |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| **(none)** | — | — | The parsimony ladder resolved every need at rung 2 or 4. Candidates considered and rejected: **`semver`** for T5.1's sunset comparison — rejected, a date comparison is `Date.parse` on an ISO string (rung 2/5), and `check-sdk-compat` in this repo already declined `semver` for the same reason; **`proper-lockfile`** for the two stores' concurrency — rejected, the temp-file + atomic `rename` pattern is 3 lines of stdlib and is what the SDK itself uses; **`env-paths`** for the store location — rejected, T3.2 reuses the SDK's `credentialHome` so the store sits beside the credential store it is held to the standard of (EC-5). | n/a — zero new dependencies |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

**Net dependency delta of this plan: zero.** Adding capability without adding surface is the intended outcome of walking the ladder, not a coincidence.

## Objective

- [ ] **O1 — Signal**: the published `@theokit/agents` tarball carries a README and a CHANGELOG, released versions have version headings, and a capability index exists (closes G9, G10)
- [ ] **O2 — Broken published primitives**: `forkBeforeUserTurn` works and is tested; `inspectCompiled` is typed over what the composition routines actually return (closes G1, G11)
- [ ] **O3 — Reachability**: config/context/commands are importable from a non-deprecated subpath in the package an agent builder already installs (closes G8)
- [ ] **O4 — Safeguards**: delegated members inherit the parent's hook veto; the fingerprint gate has a producer; tool-permission grants persist (closes G3, G4, G2)
- [ ] **O5 — Partial absorptions**: `resolveCredential` covers the mechanisms it claims; GC pointer protection is injectable and therefore not inert (closes G6, G5)
- [ ] **O6 — Root cause**: the surface-parity gate covers 19/19 subpaths (closes G7)
- [ ] **O7 — Sibling repo**: `@theokit/tui` closes U-9 and U-8 (closes G12) — separate PR, sequenced last

> **Scope note, stated rather than hidden.** The template guidance is "~7 sub-goals or split the plan"; this plan sits exactly at 7 covering 12 gaps, which is the honest ceiling. It is one plan and not three because the gaps share one root cause (O6) and one delivery constraint (O1): fixing any capability without the channel repeats the exact failure the cross-validation measured. See **D8** for the decision and the split trigger.

## ADRs

### D1 — Generalize the existing parity gate rather than fixing the 12 gaps case by case

**Decision.** Extend `scripts/check-auth-parity.mjs` from 1 subpath to all 19, enumerating subpaths from `packages/agents/package.json#exports` instead of a hand-kept list, and rename it `check-surface-parity.mjs`.

**Rationale.** Every gap in this plan is an instance of one failure: the layer stopped forwarding something and nothing said so. The gate that catches that class already exists, is proven (it was born from the ~120 duplicated credential lines its own header describes, `:9-13`), and is applied to 5% of the surface. Per `parsimony-ladder.md` rung 4 (reuse an installed dependency before adding one) and rung 1 (does this need to exist — the *detector* does not need to be invented, only widened). Fixing 12 symptoms without the detector guarantees a 13th.

**Alternatives considered.**
- *Fix the 12 gaps and stop.* Rejected: the cross-validation exists because nobody noticed the previous five absorptions landing; the same blindness produces the next batch. Symptom treatment with a measured recurrence rate.
- *Write a new, richer gate from scratch (AST-based, cross-package).* Rejected per YAGNI/G11: the existing gate's `.d.ts` enumeration + decision registry already catches the measured failure mode. A new gate is speculative scope with no case demanding it.
- *Enumerate subpaths from a hand-kept constant.* Rejected: `check-package-direction.mjs:12-13` already learned this lesson — read the consumed set from the manifest so the guard cannot drift.

**Consequences.** Enables detection of unforwarded symbols on every subpath. Constrains: turning the gate on for 18 new subpaths will fail loudly on first run, and each undecided symbol needs a written decision — that is deliberate work, budgeted as T5.2, not a surprise.

### D2 — Promote config/context to a `@theokit/agents` subpath, not to a new `theokit/config` subpath

**Decision.** Re-export `LayeredConfig`, `TrustStore`, `loadInstructionTree`, `composeInstructions`, `loadCustomCommands`, `contextPressure` and `loadEnv` from a new `@theokit/agents/config` subpath, keeping `theokit/server` working until its announced removal.

**Rationale.** The measured failure is not only "deprecated door" — it is *wrong package*. `packages/theo` is the web framework; an agent builder installs `@theokit/agents` and no package of TheoCode's four depends on `theokit` at all. Putting the door on `theokit/config` would be reachable and still uninstalled. The seven symbols are agent configuration — the same argument `server/index.ts:189-195` already makes when it explains why the instruction tree lives under `config/` and not a new top-level layer.

**Alternatives considered.**
- *Add `theokit/config` subpath.* Rejected: fixes the deprecation and not the reachability; the consumer would still not have the package.
- *Move the source files into `packages/agents/`.* Rejected for this plan: `packages/theo` has production callers of these modules and moving them is a larger, riskier change than re-exporting. Recorded as a follow-up, not silently dropped.

**Consequences.** Enables an agent builder to import config/trust/instruction-tree from the package they already have. Constrains: creates a second import path for the same symbols until `theokit/server` is removed — the duplication is bounded and time-boxed by that removal.

### D3 — Make the closure metric an executable gap register, not a checklist

**Decision.** `tests/integration/crossval-gaps.test.ts` carries one assertion per registered gap; the Goal is met when it is green at 12/12.

**Rationale.** The cross-validation's own worst finding is that closed work went unnoticed. A markdown checklist reproduces exactly that: it can be ticked without the fact holding. Filesystem and API facts (a README exists, a version heading exists, a symbol is exported, a function does not throw) are all assertable. `rules/testing.md § 3` — a bug fix starts with a failing regression test; this file *is* the regression suite for the whole plan.

**Alternatives considered.**
- *Tick the Coverage Matrix.* Rejected: unverifiable after the fact, which is the failure mode being fixed.
- *A script reading `cross-validation-output/cross-validation.db`.* Rejected: that directory is gitignored (`.gitignore:21`), so the gate would be green-by-absence on a fresh clone — the worst possible failure for a gate.

**Consequences.** Enables `/review` and `/acceptance` to verify plan completion mechanically. Constrains: assertions over documentation facts are coarse (a README that exists but is empty passes) — mitigated by asserting minimum substance, not mere existence.

### D4 — Fix `forkBeforeUserTurn` by reading the record shape the SDK actually writes

**Decision.** Change `recordIndexOfUserTurn` to count `record.type === 'user'` at the top level (the shape the SDK's writer emits), keeping the public signature and the 1-based `nth` vocabulary.

**Rationale.** Measured, not assumed: `session-lifecycle.ts:271` types the records as `{ role?: string }` and `:274` filters on `record.role`, while a real transcript line is `{"type":"user","message":{"role":"user",…}}` (sampled from a live `.jsonl`, and confirmed against the SDK's own `SessionRecord` at `agent-BiCINq25.d.ts:63`, whose top-level discriminant is `type` and which declares no `role`). The predicate is therefore never true and the function always throws its "fewer than N user turns" error. The signature and the turn-counting vocabulary are correct and documented (`:211-218`) — only the field read is wrong.

**Alternatives considered.**
- *Read `record.message.role`.* Rejected: `type` is the SDK's declared discriminant on `SessionRecord`; `message.role` is inside a body whose shape the docstring at `:255-265` deliberately keeps out of this module.
- *Deprecate the function.* Rejected: the vocabulary ("count turns, not records") is the point of the primitive per `:262-265`, and the consumer rebuilt 585 LOC in its absence.

**Consequences.** Enables session rewind through the public API. Constrains: nothing — no caller can currently depend on the throwing behaviour, since the function has no production caller and no test.

### D5 — `PermissionStore` and the hook `approval-store` are framework core, not SDK

**Decision.** Both ship under `packages/agents/src/`.

**Rationale.** ADR-0040's carve-out names **human gates** and consent explicitly as home/boundary rather than runtime, and `sdk-runtime.md § Carve-out` restates it: runtime → SDK, home/boundary → core. Neither store calls an LLM, dispatches a tool, or stores a conversation. The fingerprint gate they feed is already in `packages/agents/src/hooks/hook-fingerprint.ts`.

**Alternatives considered.**
- *Put them in `@theokit/sdk`.* Rejected: crosses the carve-out line in the wrong direction and puts a consent decision behind another repo's publish train.
- *Leave both to the consumer.* Rejected: that is the measured status quo, and it produced a gate whose required `approved` argument has no producer — half a capability.

**Consequences.** Enables persisted consent for tools and hooks. Constrains: introduces on-disk state owned by the framework, with the permission and concurrency obligations that implies (see Drawbacks).

### D6 — Hook inheritance by a delegated member is ON by default

**Decision.** `delegate()` gives the member the parent's `pre_tool_call` hooks unless the caller explicitly opts out.

**Rationale.** This is authority inheritance, not configuration. A default of "off" means every consumer must know the rule exists to be safe, and the failure is silent and passes tests — the consumer needed 16 lines to discover it. `error-handling.md § 2` — fail loud, not silently permissive. Safe-by-default with an explicit widening act is the only ordering where forgetting is safe.

**Alternatives considered.**
- *Opt-in flag.* Rejected: preserves the silent hole for everyone who does not read the docs, which is the measured failure.
- *Always inherit, no escape.* Rejected: a legitimate case exists (a member deliberately scoped tighter *or* looser by the operator); removing the escape trades one silent failure for an unrepresentable state.

**Consequences.** Enables a squad to inherit its parent's gate. Constrains: **behaviour change** for any existing caller that relied on non-inheritance — flagged in Drawbacks and requiring a CHANGELOG `Changed` entry.

### D7 — Sibling-repo work ships as its own PR, sequenced last

**Decision.** G12 (`@theokit/tui` U-8/U-9) is Phase 6 and lands as a separate PR in `../theokit-tui`, following the cross-repo pattern M48 used.

**Rationale.** `git-safety.md § 1` — work is born on `workspace` and promoted per repository; a single PR cannot span two repos. Sequencing it last means the consumer-facing channel (O1) and the root-cause gate (O6) land first, so the TUI fix is announced through a channel that now works.

**Alternatives considered.**
- *Do it first (it is small).* Rejected: shipping a fix through a tarball with no README/CHANGELOG repeats the exact failure this plan exists to close.
- *Drop it from scope.* Rejected: the user asked for all 12 gaps, and U-9 is 63 LOC of hand-rolled masked input in the consumer.

**Consequences.** Enables honest cross-repo sequencing. Constrains: this plan is not fully closed until a second PR merges in a repo this plan does not govern — stated in Unresolved Questions.

### D8 — One plan at the 7-sub-goal ceiling, with a declared split trigger

**Decision.** Keep the 12 gaps in one plan at exactly 7 sub-goals, and split into `crossval-absorption-gaps-{signal,safeguards,parity}` if `/plan-confidence` returns `NEEDS_REVISION` on scope grounds or if Phase 5 T5.2 surfaces more than 40 undecided symbols.

**Rationale.** The template's guidance is that >7 sub-goals means split. The present plan sits at the ceiling deliberately: the gaps share one root cause (D1) and one delivery constraint (D3/O1), and splitting would let a capability phase merge without the channel phase — reproducing the measured failure. Declaring the trigger up front is what keeps this from being an excuse.

**Alternatives considered.**
- *Three plans now.* Rejected: creates the ordering hazard above and triples the review surface for work with one root cause.
- *One plan with no split trigger.* Rejected: an unbounded plan with no exit condition is how scope creep is laundered.

**Consequences.** Enables a coherent single contract. Constrains: a large plan; the trigger is the release valve.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Turning the parity gate on for 18 new subpaths breaks CI until every symbol has a written decision — potentially dozens | **High** | T5.1 lands the gate with the 18 new subpaths in a `warn` mode that prints and exits 0; T5.2 converts to `error` subpath by subpath. Never both in one commit. If T5.2 exceeds 40 symbols, D8's split trigger fires | Implementer |
| D6 changes delegation behaviour: a member that previously ran without the parent's veto now inherits it | **High** | Semver minor at minimum; `CHANGELOG.md § Changed` entry with the word BREAKING if any existing caller is found; explicit opt-out documented in the same commit | Implementer |
| `PermissionStore` introduces framework-owned on-disk state — file permissions and multi-process races are new failure surface | **High** | Reuse the SDK's `assertSecureModes` (exported at `dist/auth.d.ts:2`, U-4 closed) rather than hand-rolling the permission check; single-writer + atomic replace; concurrency tests mandatory in T3.3 | Implementer |
| D2 creates two import paths for the same symbols until `theokit/server` is removed | Medium | The duplication is time-boxed by the already-announced removal; T2.2 adds a deprecation note pointing at the new subpath so the old door teaches the new one | Implementer |
| The plan's metric (T0.5 test file) can pass while a capability is technically present and practically unusable — exactly the "absorbed with the wrong shape" category the cross-validation named | Medium | Assertions test *behaviour* where a behaviour exists (`forkBeforeUserTurn` returns a record index; `resolveCredential` reads a file), not mere symbol presence | Implementer |
| Fixing `forkBeforeUserTurn` can reveal that `forkTranscript`'s `beforeRecordIndex` semantics differ from this module's assumption — the bug hid the integration | Medium | T1.1's RED test asserts against a real fixture transcript with tool calls (where record index ≠ turn index), not a synthetic 2-line file | Implementer |
| Scope: 12 gaps in one plan risks a long-lived branch and a painful review | Medium | Phases are independently mergeable and ordered by cost; D8's split trigger is the exit | Implementer |
| G12 depends on a repo this plan does not govern; it can stall indefinitely | Low | D7 sequences it last and Unresolved Questions records that plan closure depends on a second PR | Implementer |

## Unresolved Questions

- Q1 — **Does TheoCode know these capabilities exist?** The cross-validation registered this as unanswerable from code alone (finding F18). It decides whether the residual problem is product or communication, and therefore whether O1 is sufficient. **Answer before Phase 5**: ask the consumer's maintainer directly; it is one question to one person.
- Q2 — **Is the consumer's slash-command router migratable to the published `routeCommand` without breaking?** Registered as unanswerable from code (finding F54). It determines whether `@theokit/agents/commands` has a shape problem (a third instance of "absorbed with the wrong shape") or merely a discoverability problem. Affects nothing in this plan's tasks; affects whether a 13th gap exists.
- Q3 — **How many symbols will T5.2 surface as undecided across the 18 new subpaths?** Unknown until T5.1 runs in warn mode. The undecided-symbol count is the single largest uncertainty in the plan's size and the trigger for D8's split.
- Q4 — **Does any existing caller depend on delegated members *not* inheriting parent hooks?** `grep` in this repo returns none, but the surface is published. Determines whether D6 is a minor or a major bump.
- Q5 — **Do `packages/theo`'s config modules eventually *move* to `packages/agents` rather than being re-exported (D2's rejected alternative)?** Deferred deliberately; needs its own ADR with the caller-migration cost measured.

## Dependency Graph

```
Phase 0 (signal + metric) ──┬──▶ Phase 1 (broken primitives)   ──┐
                            │                                     │
                            ├──▶ Phase 2 (reachability)         ──┤
                            │                                     │
                            ├──▶ Phase 3 (safeguards)           ──┼──▶ Phase 5 (parity gate) ──▶ Final: Integration Validation
                            │                                     │
                            └──▶ Phase 4 (partial absorptions)  ──┘
                                                                  │
                                                                  └──▶ Phase 6 (sibling repo, separate PR)
```

**Phase 0 blocks everything** — it creates the test file that every later phase appends its assertion to, and the channel every later phase announces through.
**Phases 1–4 are mutually independent and run in parallel** — they touch disjoint files (session, exports map, hooks/delegation, auth/gc).
**Phase 5 is a sequential blocker after 1–4** — the gate is more likely to be green once the reachability and forwarding fixes have landed; running it first would mix "pre-existing debt" with "regression".
**Phase 6 is independent of 5** but sequenced after 0 by D7.

---

## Phase 0: Signal and the closure metric

**Objective:** give the framework a channel to announce absorption, and give this plan a mechanical definition of done.

### T0.1 — Ship a README and a CHANGELOG inside the `@theokit/agents` tarball

#### Objective
Make the published package carry prose a consumer can read.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does.** Creates `packages/agents/README.md` and adds `CHANGELOG.md` to the package's `files` array.

**Why it is necessary now.** `packages/agents/package.json` already *declares* `files: ['dist','README.md','LICENSE']` and `packages/agents/README.md` **does not exist on disk** — npm omits a declared-but-absent file silently, which is why the published tarball measured as `dist/ LICENSE package.json`. Meanwhile a correct 114 KB `packages/agents/CHANGELOG.md` exists and is not listed, so it is never shipped. Both are one-line fixes to the same manifest, and per D3 every later phase's announcement depends on this channel existing. T0.1 is the cheapest task in the plan and the one that unblocks the value of all the others.

#### Evidence
- `packages/agents/package.json` `files` field: `['dist','README.md','LICENSE']` (read 2026-08-14).
- `ls packages/agents/README.md` → *no such file or directory*.
- `ls -la packages/agents/CHANGELOG.md` → exists, 114144 bytes.
- `cross-validation-output/final_report.md § 1` gap G9 — the published tarball carries no prose.

#### Files to edit
```
packages/agents/README.md (NEW) — package README: what the package is, the 19 subpaths, link to CHANGELOG
packages/agents/package.json — add 'CHANGELOG.md' to files
tests/integration/crossval-gaps.test.ts (NEW) — RED assertions for G9 (created in T0.5, extended here)
```

#### Deep file dependency analysis
- `packages/agents/package.json` (Baseline row: 127 LoC, `70d8dc73`) — only the `files` array grows. No `exports`, `dependencies` or `version` change, so no consumer resolution changes.
- `packages/agents/README.md` (NEW) — no dependents; it is leaf documentation.

#### Deep Dives
- **Invariant** (Baseline: "`files` only grows"): removing an entry would silently drop a file from the tarball — the exact class of defect being fixed.
- **Edge case:** `npm pack --dry-run` must be run from `packages/agents/`, not the repo root, or it packs the wrong manifest.
- **Content floor:** the README must name the package, list the 19 subpaths, and link the CHANGELOG. An empty file would satisfy `files` and defeat the purpose — hence the substance assertion in T0.5.

#### Tasks
1. Write `packages/agents/README.md` with: one-paragraph what-it-is, the 19 subpaths table, a "what landed recently" pointer to `CHANGELOG.md`.
2. Add `"CHANGELOG.md"` to `files` in `packages/agents/package.json`.
3. Verify with `cd packages/agents && npm pack --dry-run`.

#### TDD
```
RED:     tarball_ships_readme_and_changelog() — asserts packages/agents/{README.md,CHANGELOG.md} exist AND both are listed in package.json#files
RED:     agents_readme_has_substance() — asserts README ≥ 30 non-blank lines and mentions at least 10 of the 19 subpath names
GREEN:   Create the README; add CHANGELOG.md to files
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `cd packages/agents && npm pack --dry-run` lists `README.md` and `CHANGELOG.md`
- [ ] Pass: lint — `pnpm lint` zero warnings on changed files
- [ ] Pass: size — every changed file ≤ 500 lines (`system-design-guardrails.md` G6)

#### DoD
- [ ] All tasks completed and validated
- [ ] `pnpm vitest run tests/integration/crossval-gaps.test.ts` green for the G9 assertions
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

### T0.2 — Give 8.2.0–8.6.0 version headings in the root CHANGELOG

#### Objective
Make released versions findable in the changelog that announces them.

#### Why this step (action + reasoning)

**What this step does.** Moves the entries for 8.2.0 through 8.6.0 out of `[Unreleased]` into dated version headings, and corrects the entry that still calls 8.6.0 unpublished.

**Why it is necessary now.** `CHANGELOG.md:70` is the last version heading (`8.1.0`), while `packages/agents/package.json` says `8.6.0` and TheoCode's lockfile resolves `8.6.0`. A consumer asking "what changed since I upgraded?" reads a file that claims nothing shipped after 8.1.0. Per Unbreakable Rule 6 the changelog is the contract; per D3 this is the channel the rest of the plan announces through.

#### Evidence
- `grep -n "^## \[" CHANGELOG.md | head -8` → `:7 [Unreleased]`, `:70 [@theokit/agents 8.1.0 · @theokit/http 1.1.0] - 2026-08-14`.
- `packages/agents/package.json` version: `8.6.0`.
- `cross-validation-output/final_report.md § 1` gap G9.

#### Files to edit
```
CHANGELOG.md — move 8.2.0..8.6.0 entries from [Unreleased] to dated version headings
tests/integration/crossval-gaps.test.ts — assertion for the 8.6.0 heading
```

#### Deep file dependency analysis
- `CHANGELOG.md` (Baseline row: 3474 LoC, `f2020587`) — **invariant: never edit already-released entries.** Entries below `:70` are untouched; only content currently inside `[Unreleased]` moves up into new headings above it.

#### Deep Dives
- **Which entries belong to which version** is determined from `packages/agents/CHANGELOG.md` (the correct per-package file) and `git log` on the version bumps — not guessed. **Limit of that source:** it covers `@theokit/agents` only. Entries describing `theokit`, `@theokit/http`, `@theokit/presenter` or `create-theokit` work have no counterpart there and are mapped from `git log` on their own version bumps. An entry that cannot be mapped from either source stays in `[Unreleased]` — moving it on a guess is fabrication.
- **Edge case:** an entry describing work released across two packages gets a combined heading, matching the existing convention at `:70` and `:89`.
- **EC-6 (MUST FIX) — the rule for an entry that belongs to an ALREADY-released version.** Some `[Unreleased]` entries describe work that shipped in `8.1.0`, whose heading already exists at `:70`. Filing it correctly would mean editing a released section, which Unbreakable Rule 6 forbids; leaving it means the changelog stays wrong. Without a stated rule the implementer picks one silently. **The rule:** such an entry goes under the **next** version heading, annotated `(shipped in 8.1.0, filed late)`. Released sections are never edited — the annotation carries the correction instead.

#### Tasks
1. Read `packages/agents/CHANGELOG.md` to map entries → versions.
2. Create dated headings for 8.2.0, 8.3.0, 8.4.0, 8.5.0, 8.6.0 above `:70`.
3. Move the corresponding `[Unreleased]` entries under them; correct the entry calling 8.6.0 unpublished.
4. Leave genuinely-unreleased entries in `[Unreleased]`.

#### TDD
```
RED:     changelog_has_heading_for_published_version() — reads packages/agents/package.json version, asserts a "## [" heading in CHANGELOG.md contains that version string
RED:     changelog_does_not_call_published_version_unpublished() — asserts no line matching /8\.6\.0.*(unpublished|not yet published|nao publicada)/i
GREEN:   Restructure the headings
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Every published `@theokit/*` version has a heading
- [ ] No already-released entry was modified (`git diff` shows changes only above line 70)
- [ ] Pass: lint — `pnpm lint` zero warnings

#### DoD
- [ ] `pnpm vitest run tests/integration/crossval-gaps.test.ts` green for the G9 changelog assertions
- [ ] `git diff CHANGELOG.md` reviewed for the never-edit-released invariant

---

### T0.3 — Publish a capability index

#### Objective
Let a builder search by question ("I want session GC") instead of by package name.

#### Why this step (action + reasoning)

**What this step does.** Creates `wiki/capability-index.md`: three columns — capability, the symbol that delivers it, the version it landed in.

**Why it is necessary now.** Gap G10 measured that `wiki/` indexes by topic and never by capability, `wiki/migration/` has no 7.x→8.x entry, and no codemod exists for these absorptions. A capability index is the artifact that would have prevented the three live reimplementations in TheoCode — it is cheap, it is a single page, and per D3 it is assertable.

#### Evidence
- `cross-validation-output/final_report.md § 3` gap G10.
- TheoCode `BACKLOG.md:421-441` — the consumer maintains its own upstream register precisely because no such index exists on the producer side.

#### Files to edit
```
wiki/capability-index.md (NEW) — capability → symbol → version-it-landed-in
tests/integration/crossval-gaps.test.ts — assertion for the index
```

#### Deep file dependency analysis
- `wiki/capability-index.md` (NEW) — leaf documentation, no dependents. Linked from `wiki/index.md` in T0.4.

#### Deep Dives
- **Seed rows are not invented** — they come from the five verified absorptions: session GC (`GCFloorError`/`GCCandidate`, `./session`, 8.x), typed `ToolsetError` (8.0), `assertSecureModes` (`./auth`), `sandboxWritePolicy` (`./tool-scope`), `resolveCredential` (M79, `./auth`).
- **Invariant:** every row cites a symbol that resolves in `packages/agents/dist/*.d.ts`. A row for a symbol that does not exist is exactly the fabricated citation this ecosystem's golden rules cap at INVALID.

#### Tasks
1. Create the file with a header explaining the three columns.
2. Seed with the five verified absorptions plus the symbols this plan adds (filled in per phase).
3. Link it from `wiki/index.md`.

#### TDD
```
RED:     capability_index_exists_and_resolves() — asserts wiki/capability-index.md exists, has ≥ 5 rows, and every cited symbol appears in packages/agents/dist/*.d.ts
GREEN:   Create and seed the index
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] ≥ 5 rows, every symbol resolving in the published `.d.ts`
- [ ] Linked from `wiki/index.md`

#### DoD
- [ ] Assertion green
- [ ] Zero lint warnings

---

### T0.4 — Promote the cross-validation report into the repo and correct two stale public claims

#### Objective
Make the plan's evidence durable, and fix the two documentation defects the cross-validation found.

#### Why this step (action + reasoning)

**What this step does.** Copies `cross-validation-output/final_report.md` to `.claude/knowledge-base/audits/2026-08-14-theocode-crossval.md`, corrects `README.md:317` (which teaches a removed import), and updates the `CLAUDE.md` ecosystem table from 5 siblings to the real 11 repositories.

**Why it is necessary now.** `cross-validation-output/` is gitignored (`.gitignore:21`), so every citation this plan makes to it would be unresolvable in a fresh clone — the fabricated-citation failure the golden rules cap at INVALID. The two doc fixes ride along because they are the same class (public surface stating something untrue) and both are single-line edits.

#### Evidence
- `.gitignore:21` — `cross-validation-output/`.
- `README.md:317` teaches `import { defineRoute } from 'theokit/server'`; `packages/theo/src/server/define/index.ts:1-12` records that the `define*` functions were removed from the public API per ADR-0043 D1.
- `CLAUDE.md` Ecosystem table lists 5; `ls /home/paulo/Projetos/theo/theokit-framework/` returns 11 directories.

#### Files to edit
```
.claude/knowledge-base/audits/2026-08-14-theocode-crossval.md (NEW) — promoted report
README.md — fix the defineRoute example at :317 (and :320,:327,:357,:369)
CLAUDE.md — ecosystem table: 11 repos, incl. @theokit/tui, sdk-tools, sdk-pty
tests/integration/crossval-gaps.test.ts — assertion that README examples import only exported symbols
```

#### Deep file dependency analysis
- `README.md` (Baseline row: 506 LoC, `21dde4da`) — public copy. Per `rules/public-copy.md` the DEEP DIVE section names APIs; the fix stays inside that section and does not touch HERO/BODY.
- `CLAUDE.md` (Baseline row: 325 LoC, `a46a2c70`) — the Ecosystem table is declared the source of truth for integrations, so a stale table is load-bearing wrong.

#### Deep Dives
- **The README fix is not "delete the example"** — it must teach the *current* correct import (the fluent builders that `define/index.ts` says are the public surface), or the reader is left with a hole.
- **Edge case:** five call sites (`:317,:320,:327,:357,:369`), not one.

#### Tasks
1. Copy the report into `knowledge-base/audits/` with a provenance header.
2. Rewrite the five README examples to the current public surface.
3. Update the `CLAUDE.md` ecosystem table.

#### TDD
```
RED:     readme_examples_import_exported_symbols() — extracts `import { X } from 'theokit/...'` from README.md, asserts each X appears in the corresponding package's exports
GREEN:   Fix the five examples
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Report resolvable from a fresh clone — `git ls-files .claude/knowledge-base/audits/2026-08-14-theocode-crossval.md` returns the path (exit 0)
- [ ] No README example imports a non-exported symbol — `pnpm vitest run tests/integration/crossval-gaps.test.ts -t readme_examples` exits 0
- [ ] `CLAUDE.md` table matches the filesystem
- [ ] Pass: public-copy lint — `.claude/hooks/public-copy-lint.sh` clean

#### DoD
- [ ] Assertion green
- [ ] Zero lint warnings

---

### T0.5 — Create the executable gap register

#### Objective
Establish the file that is this plan's Goal metric.

#### Why this step (action + reasoning)

**What this step does.** Creates `tests/integration/crossval-gaps.test.ts` with a `describe` per gap G1..G12, each initially `test.fails`-style RED, and a manifest constant listing the 12 gap ids with their one-line claim.

**Why it is necessary now.** Per D3 the closure metric must be executable, and per the dependency graph every later phase appends its assertion here. Creating it first means no phase can merge without a mechanical statement of what it closed.

#### Evidence
- `cross-validation-output/final_report.md § 3` — the 12 registered gaps with severities and reference citations.
- `rules/testing.md § 3` — every bug fix starts with a failing regression test.

#### Files to edit
```
tests/integration/crossval-gaps.test.ts (NEW) — 12 describes, one per gap; RED at creation
```

#### Deep file dependency analysis
- New file, no dependents. Lives in `tests/integration/` which the root `vitest run` already discovers (verified: `test: "vitest run"` with no path restriction, and 95 files already under `tests/integration/`).

#### Deep Dives
- **Structure:** a `GAPS` constant maps id → `{title, phase}`; a meta-test asserts `Object.keys(GAPS).length === 12` so a gap cannot be quietly dropped.
- **Invariant:** no mocks for filesystem facts. A test that mocks `existsSync` to assert a README exists is theatre.
- **Edge case:** assertions that read `packages/agents/dist/*.d.ts` must `skipIf` the dist is unbuilt, and the skip must be *loud* (a logged reason), or an unbuilt dist makes the gate green by absence.
- **EC-4 (MUST FIX) — a loud skip is not enough; CI must refuse a mostly-skipped run.** On a fresh clone with `dist/` unbuilt, *every* `.d.ts`-reading assertion skips and the suite reports success having verified nothing. A vacuous pass on the single Goal metric is the outcome — the same failure shape the anti-vacuity floor guards against in T5.1, and precisely what D3 rejects. Add a meta-assertion: under `process.env.CI`, at most 1 gap assertion is allowed to skip, and the failure message lists which skipped and why.

#### Pseudo-code / Signatures
```pseudocode
const GAPS = { G1: {title: 'forkBeforeUserTurn always throws', phase: 1}, ... G12: {...} }

test('every registered gap has an assertion')
  assert Object.keys(GAPS).length == 12
  for id in GAPS: assert describeBlockExists(id)

# Example
input:  GAPS with 11 keys
output: FAIL — "gap register drifted: 11 of 12"
```

#### Tasks
1. Create the file with the `GAPS` manifest and the meta-test.
2. Add a RED `describe` per gap, each with `expect.fail('not yet closed — phase N')`.
3. Confirm the suite is RED at 12/12.

#### TDD
```
RED:     every_registered_gap_has_an_assertion() — asserts the manifest has 12 entries and each has a describe block
RED:     ci_refuses_a_mostly_skipped_run() — EC-4 (MUST FIX): under CI, ≤ 1 skipped assertion; failure names which skipped and why
RED:     G1..G12 placeholder assertions — all failing by construction
GREEN:   (this task's GREEN is the file existing and being RED — later phases turn each green)
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] File discovered by `pnpm vitest run` without config change
- [ ] Meta-test asserts exactly 12 gaps — `pnpm vitest run tests/integration/crossval-gaps.test.ts -t every_registered_gap` exits 0
- [ ] Every `skipIf` logs its reason

#### DoD
- [ ] Suite runs and reports 12 open gaps
- [ ] Zero type errors

---

## Phase 1: Broken published primitives

**Objective:** make two published symbols do what their signatures promise.

### T1.1 — Fix `forkBeforeUserTurn`

#### Objective
Make session rewind work through the public API.

#### Why this step (action + reasoning)

**What this step does.** Changes `recordIndexOfUserTurn` to count `record.type === 'user'` instead of `record.role === 'user'`, and adds the tests the function never had.

**Why it is necessary now.** Per D4 this is a published primitive that always throws — the worst gap class, because the correct signature makes a consumer believe the fault is theirs. It has zero production callers and zero tests, so the fix is unblocked and unusually safe. TheoCode rebuilt 585 LOC (`backtrack.ts` 175 + test 75 + `tui/backtrack/` 335) in its absence.

#### Evidence
- `packages/agents/src/session/session-lifecycle.ts:271` — `loadJsonl<{ role?: string }>(src)`.
- `:274` — `if (record.role !== 'user') continue`.
- SDK `SessionRecord` at `node_modules/@theokit/sdk/dist/agent-BiCINq25.d.ts:63` — top-level discriminant is `type: "user" | "assistant" | "system"`; no `role` field.
- Live transcript sample: `{"type":"user","message":{"role":"user",...},"uuid":...}` — `role` is nested under `message`.
- `grep -rln forkBeforeUserTurn packages/agents/tests` → no results.

#### Files to edit
```
packages/agents/src/session/session-lifecycle.ts — recordIndexOfUserTurn: read `type`, not `role`; retype the loadJsonl generic
packages/agents/tests/unit/session-fork.test.ts (NEW) — RED tests first
tests/integration/crossval-gaps.test.ts — G1 assertion turns green
```

#### Deep file dependency analysis
- `session-lifecycle.ts` (Baseline row: 279 LoC, `164cbfec`) — changes the private `recordIndexOfUserTurn:266` only. `forkBeforeUserTurn:220` keeps its signature, so the published `dist/session.d.ts:94` is unchanged and no consumer sees a type change. Callers per Baseline: only the barrel at `session/index.ts:10`.
- **Invariant preserved:** truncation stays delegated to the SDK's `forkTranscript` (`:245`); this task does not touch that call.

#### Deep Dives
- **Data shape:** the generic becomes `loadJsonl<{ type?: string }>`; the filter becomes `record.type !== 'user'`.
- **Invariant (Baseline "nth stays 1-based"):** the `seen`/`nth` counting logic is correct and untouched — only the predicate changes.
- **Critical edge case:** a turn spans many records (message, assistant reply, tool calls, results), so record index ≠ turn index. The fixture MUST contain tool calls, or the test passes for the wrong reason on a 2-line file where the two indices coincide — the exact trap `:257-260` documents.
- **Edge case:** `nth` beyond the available turns must still throw the existing error — that path is currently the *only* reachable one and must stay correct.
- **EC-1 (MUST FIX) — `srcId === newId` is data loss, and this task is what makes it reachable.** `transcriptPath` resolves both ids against the same root, so a self-fork truncates the session in place. The hazard does not exist today only because the function always throws; fixing the count opens it. Guard first, before the count is fixed:
  ```
  if (srcId === newId) throw new TheokitAgentError('forkBeforeUserTurn: srcId and newId must differ')
  ```
- **EC-10 edge case:** a transcript can open with a `system` record. The naive fixture (user first) would pass for the wrong reason.
- **EC-9 negative case:** a crash-truncated last line is a realistic on-disk state. The assertion must pin the *specific* behavior — the SDK exposes `tolerateTrailingPartialLine` and the consumer's PS-003 recorded that re-deriving this produced a bare `SyntaxError` where the SDK throws a typed `JsonlParseError` carrying the line number.

#### Pseudo-code / Signatures
```pseudocode
function recordIndexOfUserTurn(src, nth) -> number | undefined
  records = loadJsonl<{ type?: string }>(src)
  seen = 0
  for (index, record) in records:
    if record.type != 'user': continue
    seen += 1
    if seen == nth: return index
  return undefined

# Example — fixture with tool calls
input:  [user, assistant, tool_call, tool_result, user, assistant], nth=2
output: 4          # the 2nd user turn starts at record index 4, not 1
```

#### Tasks
1. Write the fixture transcript with ≥ 2 user turns separated by tool records.
2. Write the RED tests.
3. Change the generic and the predicate.
4. Turn the G1 assertion green.

#### TDD
```
RED:     fork_finds_second_user_turn_past_tool_records() — fixture with tools; asserts recordIndex is the tool-aware index, not the naive one
RED:     fork_throws_when_nth_exceeds_available_turns() — asserts the existing typed error still fires
RED:     fork_rejects_zero_and_negative_nth() — asserts the 1-based guard at :226 still holds
RED:     fork_rejects_src_equal_to_new_id() — EC-1 (MUST FIX): asserts a typed error, NOT an in-place truncation
RED:     fork_accepts_nth_equal_to_last_user_turn() — EC-8: 3 turns, nth=3 returns the 3rd index (boundary, not throw)
RED:     fork_counts_correctly_when_transcript_starts_with_system() — EC-10: leading system record does not shift the count
RED:     fork_handles_truncated_last_line() — EC-9: asserts the SPECIFIC behavior (typed error w/ line number, or tolerant parse), never merely "does not crash"
GREEN:   Read `type` instead of `role`; add the srcId===newId guard
REFACTOR: None expected
VERIFY:  pnpm vitest run packages/agents/tests/unit/session-fork.test.ts
```

#### Concurrency tests
(none — single-threaded)
The function reads a file and delegates the write to the SDK's `forkTranscript`, which owns the live-session guard (`:242-244`). No shared mutable state is introduced by this task.

#### Acceptance Criteria
- [ ] `forkBeforeUserTurn` returns a correct `recordIndex` on a fixture containing tool records
- [ ] The two existing error paths still throw with their current messages — `pnpm vitest run packages/agents/tests/unit/session-fork.test.ts` exits 0 with both message assertions
- [ ] Pass: coverage — `pnpm test:coverage` ≥ 90% on `session-lifecycle.ts` (this function: 100%)
- [ ] Pass: size — `session-lifecycle.ts` ≤ 500 lines (G6)

#### DoD
- [ ] G1 assertion green in the gap register
- [ ] `pnpm typecheck` zero errors
- [ ] CHANGELOG `[Unreleased] § Fixed` entry

---

### T1.2 — Re-type `inspectCompiled` over what the composition routines return

#### Objective
Make the published test seam usable by the case that motivated it.

#### Why this step (action + reasoning)

**What this step does.** Changes `inspectCompiled`'s parameter from `AgentDefinition` to the type the builder's composition routines actually produce, keeping `CompiledInspection` source-compatible.

**Why it is necessary now.** Gap G11: the seam has zero adoption in the consumer's 72 test files, and its `composition.test.ts:1-19` documents *why* — the parameter type is not what its three composition routines return, so it re-derives the same facts by hand at `:141-317`. The seam falls squarely in the "absorbed with the wrong shape" category: the work is done and unusable by the case that asked for it.

#### Evidence
- `packages/agents/src/testing/inspect-compiled.ts:50` — `export function inspectCompiled(definition: AgentDefinition)`.
- Consumer `packages/agent/src/composition.test.ts:1-19` (documented refusal) and `:141-317` (hand re-derivation).
- `cross-validation-output/final_report.md § 3` gap G11.

#### Files to edit
```
packages/agents/src/testing/inspect-compiled.ts — widen/correct the parameter type
packages/agents/tests/unit/inspect-compiled.test.ts (NEW) — RED: inspect the output of a real builder composition
tests/integration/crossval-gaps.test.ts — G11 assertion
```

#### Deep file dependency analysis
- `inspect-compiled.ts` (Baseline row) — exported from `testing/index.ts:15`. Per Baseline invariant, `CompiledInspection` stays source-compatible so any existing caller keeps compiling. Callers in this repo: none; external: published on `./testing`.

#### Deep Dives
- **The correct parameter type is discovered, not assumed:** read what `AgentBuilder.create()` / the compile path returns, and type the parameter as that. If it is a supertype of `AgentDefinition`, widening is source-compatible for existing callers.
- **Invariant:** widening a parameter is safe for callers; *narrowing* would be breaking. If the discovered type is not a supertype, this becomes an overload rather than a replacement — decided at implementation time against the real types, and recorded in the CHANGELOG accordingly.
- **Edge case:** a definition with zero tools must inspect cleanly (empty `gatedToolNames`), not throw.

#### Tasks
1. Read the return type of the builder's composition path.
2. Write the RED test that inspects a real composed agent.
3. Widen the parameter (or add an overload if widening is not source-compatible).

#### TDD
```
RED:     inspect_accepts_builder_composition_output() — composes via AgentBuilder, passes the result to inspectCompiled, asserts gatedToolNames
RED:     inspect_handles_agent_with_no_tools() — asserts empty inspection, no throw
GREEN:   Correct the parameter type
REFACTOR: None expected
VERIFY:  pnpm vitest run packages/agents/tests/unit/inspect-compiled.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `inspectCompiled` accepts the output of the builder path without a cast
- [ ] No existing caller signature breaks (verified by `pnpm typecheck`)
- [ ] Pass: coverage ≥ 90% on the changed file

#### DoD
- [ ] G11 assertion green
- [ ] CHANGELOG entry under `Changed` (or `Fixed` if the type was simply wrong)

---

## Phase 2: Reachability

**Objective:** put config, trust and instruction-tree behind a door an agent builder can open.

### T2.1 — Add the `@theokit/agents/config` subpath

#### Objective
Re-export the seven config/context symbols from the package an agent builder installs.

#### Why this step (action + reasoning)

**What this step does.** Creates `packages/agents/src/config-entry.ts` re-exporting `LayeredConfig`, `TrustStore`, `loadInstructionTree`, `composeInstructions`, `loadCustomCommands`, `contextPressure` and `loadEnv`, and adds `"./config"` to `packages/agents/package.json#exports`.

**Why it is necessary now.** Per D2 this is the gap with **materialized damage**: the consumer rewrote 533 LOC of instruction-tree loading and reintroduced the symlink-containment flaw `assertNoSymlinkEscape` exists to close. The current sole door is a barrel that `console.warn`s its own removal, inside a package the consumer does not install. Every day this stays open is a day another consumer re-derives an unsafe version.

#### Evidence
- `packages/theo/src/server/index.ts:1-15` — self-declared DEPRECATED umbrella, removal scheduled.
- Same file `:162,170,179,196,203,209,217` — the seven symbols.
- `packages/theo/package.json` — 24 subpaths, none named `./config`.
- Consumer `packages/agent/src/context/agents-md.ts:121-125` — B-042, the reintroduced flaw.
- `server/index.ts:176-179` — M76's own words: *"a convention with a hole in it is worse than no convention"*.

#### Files to edit
```
packages/agents/src/config-entry.ts (NEW) — re-export the seven symbols
packages/agents/package.json — add "./config" to exports; add the tsup entry
packages/agents/tests/integration/config-subpath.test.ts (NEW) — RED
tests/integration/crossval-gaps.test.ts — G8 assertion
```

#### Deep file dependency analysis
- `packages/agents/package.json` (Baseline row) — `exports` only grows (Baseline invariant). Adding a subpath is non-breaking.
- **G1 boundary check:** `packages/agents` importing from `packages/theo` would **invert the declared direction** (`theokit` depends on `@theokit/agents`, not the reverse). The direction constraint is the load-bearing risk of this task — see Deep Dives.

#### Deep Dives
- **The direction problem is the whole task.** `@theokit/agents` must not import `theokit`. Two admissible shapes, decided at implementation against the real dependency graph:
  1. **Move** the seven modules from `packages/theo/src/config/` into `packages/agents/src/config/`, and have `packages/theo` re-export *from* `@theokit/agents` (direction preserved: theo → agents).
  2. If a module has `packages/theo`-only dependencies that cannot move, split it: the portable half moves, the coupled half stays.
  Shape 1 is preferred; it is D2's rejected-alternative "move" being forced by the boundary rather than chosen for taste. **If shape 1 proves impossible for a given symbol, that symbol is dropped from this task and recorded as an Unresolved Question — not smuggled across the boundary.**
- **Invariant:** `theokit/server` keeps exporting the same names for one more minor (its own promise at `:1-15`), now by re-export.
- **Edge case:** `loadEnv` has a `_resetEnvCache` sibling (`server/index.ts:221`) used by tests — module-level cache state that must not end up duplicated in two packages, or two caches disagree.

#### Tasks
1. Map each of the seven modules' imports; classify movable vs coupled.
2. Move the movable ones into `packages/agents/src/config/`.
3. Create `config-entry.ts`; add `"./config"` to `exports` and the tsup entry.
4. Re-point `packages/theo/src/server/index.ts` at `@theokit/agents/config`.
5. Verify `pnpm check:direction` and `pnpm check:deps` stay green.

#### TDD
```
RED:     config_subpath_exports_the_seven_symbols() — imports each from '@theokit/agents/config', asserts defined
RED:     server_barrel_still_exports_them() — imports from 'theokit/server', asserts same identity (no duplicate module instance)
RED:     env_cache_has_a_single_instance() — loadEnv + _resetEnvCache across both import paths observe one cache
GREEN:   Move modules, add the subpath, re-point the barrel
REFACTOR: Delete any now-dead re-export shims
VERIFY:  pnpm vitest run packages/agents/tests/integration/config-subpath.test.ts && pnpm check:direction
```

#### Concurrency tests
(none — single-threaded)
`loadEnv`'s module-level cache is shared mutable state, but it is not accessed concurrently in this task's scope; the single-instance invariant is asserted by identity, not by a race.

#### Acceptance Criteria
- [ ] All seven symbols importable from `@theokit/agents/config` (or the dropped ones recorded as Unresolved Questions)
- [ ] `theokit/server` still exports them, same module identity
- [ ] `pnpm check:direction` green — no inverted dependency
- [ ] `pnpm check:deps` green — zero cycles
- [ ] Pass: size — `wc -l` on every changed file returns ≤ 500 (G6)

#### DoD
- [ ] G8 assertion green
- [ ] `pnpm typecheck` zero errors
- [ ] CHANGELOG `Added` entry naming the new subpath

---

### T2.2 — Point the deprecated barrel at its replacement

#### Objective
Make the old door teach the new one.

#### Why this step (action + reasoning)

**What this step does.** Updates the deprecation notice in `packages/theo/src/server/index.ts` to name `@theokit/agents/config` for the seven symbols.

**Why it is necessary now.** The barrel already warns; a warning that does not say where to go sends the reader to reimplement — the measured behaviour. One edit, and it converts the loudest existing channel into a migration pointer.

#### Evidence
- `packages/theo/src/server/index.ts:5-15` — the current notice lists subpaths but not the new config door (which did not exist until T2.1).

#### Files to edit
```
packages/theo/src/server/index.ts — deprecation notice names @theokit/agents/config
```

#### Deep file dependency analysis
- `server/index.ts` (Baseline row: 226 LoC, `164cbfec`) — comment and warning text only; no export changes, so no consumer breaks.

#### Deep Dives
- **Invariant (Baseline):** re-exports are added, never removed — this task removes nothing.

#### Tasks
1. Update the docblock and the `console.warn` string.

#### TDD
```
RED:     deprecation_notice_names_the_replacement() — asserts the warning text contains '@theokit/agents/config'
GREEN:   Update the text
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] The warning names the replacement subpath — `grep -q '@theokit/agents/config' packages/theo/src/server/index.ts` exits 0

#### DoD
- [ ] Assertion green; zero lint warnings

---

## Phase 3: Safeguards

**Objective:** close the three consent and authority holes.

### T3.1 — Delegated members inherit the parent's `pre_tool_call` hooks

#### Objective
Stop a subagent from running a tool the parent vetoed.

#### Why this step (action + reasoning)

**What this step does.** Makes `delegate()` pass the parent's `pre_tool_call` hooks to the member by default, with an explicit opt-out.

**Why it is necessary now.** Per D6 this is authority inheritance, and its absence fails silently and passes tests. The consumer needed 16 lines to discover and close it. Gap G3 is critical severity for exactly that reason: a consumer who does not know the rule exists has a hole no test of theirs reveals.

#### Evidence
- `cross-validation-output/final_report.md § 3` gap G3 — grep in the framework returns no hook inheritance.
- Consumer `packages/agent/src/delegation/hooks-for-member.ts:7` — 16 LOC propagating the parent's veto.
- `packages/agents/src/bridge/delegation-lifecycle.ts` (104 LoC) — where the member's lifecycle is composed.

#### Files to edit
```
packages/agents/src/bridge/delegation-lifecycle.ts — inherit parent's pre_tool_call hooks by default
packages/agents/tests/unit/delegation-hook-inheritance.test.ts (NEW) — RED
tests/integration/crossval-gaps.test.ts — G3 assertion
CHANGELOG.md — Changed entry (behaviour change)
```

#### Deep file dependency analysis
- `delegation-lifecycle.ts` (Baseline row: 104 LoC, `164cbfec`) — Baseline invariant: existing exports and their `isRetryable` semantics unchanged. T3.1 adds inheritance to the composition path; it does not alter `withClockCap` or `DelegationTimeoutError`.

#### Deep Dives
- **Invariant:** a member is scoped *tighter* by the operator, never silently *wider*. The opt-out therefore takes an explicit hook list, not a boolean `false` — a boolean makes "no hooks" and "default hooks" indistinguishable at the call site.
- **Edge case:** a parent with no hooks must not synthesize an empty gate that changes behaviour.
- **Edge case:** nested delegation (member delegates further) must inherit transitively, or the hole reopens one level down.

#### Pseudo-code / Signatures
```pseudocode
function delegate(spec, opts)
  memberHooks = opts.hooks ?? parentHooks(spec)   # default: inherit
  # opts.hooks === [] is an explicit, auditable widening — not the default
  return runMember(spec, { hooks: memberHooks })

# Example
input:  parent vetoes 'run_shell'; member calls run_shell
output: member's call is vetoed (previously: allowed)
```

#### Tasks
1. Write the RED test: parent vetoes a tool, member attempts it.
2. Write the RED test for transitive inheritance.
3. Implement default inheritance + explicit opt-out.
4. CHANGELOG `Changed`, marked BREAKING if Q4 finds an affected caller.

#### TDD
```
RED:     member_inherits_parent_veto() — parent vetoes run_shell; member's call is refused
RED:     nested_member_inherits_transitively() — two levels deep, veto still applies
RED:     explicit_hook_list_overrides_inheritance() — passing hooks replaces, does not merge
RED:     parent_without_hooks_does_not_synthesize_a_gate() — behaviour unchanged when parent has none
GREEN:   Default inheritance in the member composition path
REFACTOR: None expected
VERIFY:  pnpm vitest run packages/agents/tests/unit/delegation-hook-inheritance.test.ts
```

#### Concurrency tests
Delegation runs the member concurrently with the parent's turn, and the hook set is shared state read by both.
Cancellation propagation — cancel the parent mid-member-run; assert the member stops and no post-cancel
tool call passes the gate. (Structured-concurrency shape: AbortSignal from parent to member.)
Concurrent members — spawn 3 members from one parent under Promise.all, each attempting the vetoed tool;
assert 3 refusals and no interleaving where one member observes an empty hook set.

#### Acceptance Criteria
- [ ] A vetoed tool is refused for the member, transitively — `pnpm vitest run packages/agents/tests/unit/delegation-hook-inheritance.test.ts` exits 0
- [ ] Explicit opt-out is representable and auditable — `pnpm vitest run packages/agents/tests/unit/delegation-hook-inheritance.test.ts -t explicit_hook_list` exits 0
- [ ] Pass: coverage — `pnpm test:coverage` reports 100% on the inheritance branch (security path)
- [ ] Q4 answered before merge — `grep -rn 'delegate(' packages --include='*.ts' | grep -v test` returns the caller list, recorded in the PR description

#### DoD
- [ ] G3 assertion green
- [ ] CHANGELOG `Changed` entry with the opt-out documented
- [ ] Semver decision recorded (minor vs major) per Q4's answer

---

### T3.2 — Give the hook fingerprint gate a producer

#### Objective
Make the `approved` set the gate requires actually obtainable.

#### Why this step (action + reasoning)

**What this step does.** Adds `packages/agents/src/hooks/approval-store.ts`: a persisted store of approved hook fingerprints, with a `modified` state when a command changes after approval.

**Why it is necessary now.** Gap G4: the gate exists (`hook-fingerprint.ts`, `approved` required, deny-by-default) and **nothing in the framework produces the set**. A hook is `spawn(cmd, {shell:true, detached:true})` on every tool call, so the consumer's only two exits are "approve everything" or "write the store" — and it wrote the store. Half a capability, where the missing half is the on-disk-permissions half consumers get wrong.

#### Evidence
- `packages/agents/src/hooks/hook-fingerprint.ts` (56 LoC) — gate with required `approved`, deny-by-default.
- Consumer `packages/agent/src/hooks/hook-trust.ts:24` — sha256 ledger with `modified` detection.
- `cross-validation-output/final_report.md § 3` gap G4.

#### Files to edit
```
packages/agents/src/hooks/approval-store.ts (NEW) — persisted approvals keyed by fingerprint
packages/agents/src/hooks/index.ts — export the store
packages/agents/tests/unit/hook-approval-store.test.ts (NEW) — RED
tests/integration/crossval-gaps.test.ts — G4 assertion
```

#### Deep file dependency analysis
- `hook-fingerprint.ts` (Baseline row) — **not modified**. Baseline invariant: `approved` stays required. T3.2 adds the producer beside it.
- `hooks/index.ts` (Baseline row: 30 LoC) — grows by one export; G7 satisfied by the new test.

#### Deep Dives
- **Do not hand-roll the permission check.** `assertSecureModes` is exported from the SDK (`dist/auth.d.ts:2`, U-4 closed) and refuses a group/other-writable store. Per `parsimony-ladder.md` rung 4, reuse it. The reuse is the concrete lesson from the consumer's SAC-01: its store was held to a weaker standard than the credential store next to it.
- **EC-5 (MUST FIX) — name the path, and REPAIR the mode rather than only asserting it.** The store lives at `<credentialHome>/hook-approvals.json`, reusing the SDK's `credentialHome` so it sits beside the credential store it is held to the standard of. The credential home is **shared with the SDK's transcript root**, and `mkdirSync(..., {mode: 0o700})` is a **no-op on an existing directory** — so whoever creates it first sets the permissions and this code inherits a world-writable dir through no action of its own. Asserting alone would fail-closed forever on a machine the SDK set up first. Therefore: `chmodSync(dir, 0o700)` on open, *then* `assertSecureModes`. The repair-then-assert order turns the consumer's SAC-01 finding turned into a fix instead of a repeat.
- **Three states, not two:** `approved` / `unknown` / `modified`. Collapsing `modified` into `unknown` loses the signal the gate exists for — a command changed *after* someone approved it.
- **Invariant:** deny-by-default. An unreadable store yields `unknown` for everything (fail closed), never "approve all".
- **Edge case:** the store directory is shared with the SDK's transcript root; whoever creates it first sets the mode. Repair the mode on open rather than assuming.

#### Pseudo-code / Signatures
```pseudocode
type ApprovalState = 'approved' | 'unknown' | 'modified'
function loadApprovals(path) -> Map<fingerprint, {cmd, approvedAt}>
  assertSecureModes(path)          # SDK; refuses group/other-writable
  ...on read error: return empty   # fail CLOSED — everything reads 'unknown'

function stateOf(store, hook) -> ApprovalState
  entry = store.get(fingerprint(hook))
  if !entry: return 'unknown'
  if entry.cmd != hook.cmd: return 'modified'
  return 'approved'

# Example
input:  hook approved yesterday, command edited today
output: 'modified'   # NOT 'approved', NOT 'unknown'
```

#### Tasks
1. RED tests for the three states and for fail-closed-on-unreadable.
2. Implement the store using the SDK's `assertSecureModes`.
3. Export from the barrel; wire a usage example in the README.

#### TDD
```
RED:     unknown_hook_is_not_approved() — empty store, deny
RED:     approved_hook_is_approved() — round-trip
RED:     changed_command_reports_modified() — approve, edit cmd, assert 'modified' not 'approved'
RED:     unreadable_store_fails_closed() — chmod 000 (or inject a throwing reader); assert everything 'unknown'
RED:     insecure_store_mode_is_refused() — group-writable dir; assert assertSecureModes rejects
RED:     preexisting_shared_dir_mode_is_repaired() — EC-5 (MUST FIX): dir pre-created 0777 by another writer; assert chmod to 0700 then pass, NOT a permanent refusal
RED:     empty_store_file_reads_as_unknown() — EC-13: 0-byte file yields 'unknown' for every fingerprint, no parse throw
GREEN:   Implement the store
REFACTOR: None expected
VERIFY:  pnpm vitest run packages/agents/tests/unit/hook-approval-store.test.ts
```

#### Concurrency tests
The store is on-disk state that two processes (CLI + TUI) can write.
Atomic-counter invariant (concurrent test) — N concurrent writers each approving a distinct fingerprint; assert the final
store contains all N entries and is valid JSON (no torn write). Implementation writes to a temp file and
renames, so the assertion is that no reader ever observes a partial file.
Reader-during-write — interleave reads with writes; assert every read yields either the pre- or the
post-state, never a parse error.

#### Acceptance Criteria
- [ ] Three states distinguishable — `pnpm vitest run packages/agents/tests/unit/hook-approval-store.test.ts` exits 0 on the approved/unknown/modified trio
- [ ] Fail-closed on unreadable and on insecure mode — `pnpm vitest run packages/agents/tests/unit/hook-approval-store.test.ts -t fails_closed` exits 0
- [ ] No torn write under N concurrent approvals
- [ ] Pass: coverage — `pnpm test:coverage` reports 100% on the state machine (security path)
- [ ] Pass: size — `wc -l` on the new file returns ≤ 500 (G6)

#### DoD
- [ ] G4 assertion green
- [ ] CHANGELOG `Added` entry
- [ ] `wiki/capability-index.md` row added

---

### T3.3 — `PermissionStore`: persisted tool-permission grants

#### Objective
Let a user say "always allow this" without saying "allow everything".

#### Why this step (action + reasoning)

**What this step does.** Adds `packages/agents/src/auth/permission-store.ts`: grants persisted by (tool, scope, command signature), with optional expiry.

**Why it is necessary now.** Gap G2 is the only genuine absorption in this plan — verified by grep, **neither** the framework nor the consumer has this for tools: `alwaysAllow|allowRule|permissionRule|rememberDecision` returns zero across `packages/agents/src` and `packages/theo/src`. `ApprovalDecision` settles one request; nothing persists a standing grant. The result is that a user approves the same `npm test` a tenth time or turns on `full-auto` — and `full-auto` is the setting that removes the gate entirely.

#### Evidence
- Grep (re-run 2026-08-14 by the security analyst): zero matches for the four patterns across both packages.
- `packages/theo/src/server/agent/approval-registry.ts:80-90` — in-memory, single-process by declaration, durable store named as future work.
- Consumer's only tool-level escape is global `full-auto` (`packages/agent/src/config/approval-policy.ts`).

#### Files to edit
```
packages/agents/src/auth/permission-store.ts (NEW) — persisted grants
packages/agents/src/auth-entry.ts — export
packages/agents/tests/unit/permission-store.test.ts (NEW) — RED
tests/integration/crossval-gaps.test.ts — G2 assertion
```

#### Deep file dependency analysis
- New module inside `packages/agents/src/auth/`, beside `resolve-credential.ts` and `auth-provider.ts`. No inbound dependency from `packages/theo` (G1 direction preserved).

#### Deep Dives
- **The grant key is the security decision.** Keying on tool name alone would let "always allow `run_shell`" approve every command ever. The key is (tool, scope, command signature) — a grant for `npm test` in `/repo/a` does not authorize `rm -rf` in `/repo/b`.
- **EC-2 (MUST FIX) — the scope must be canonicalized, or the key is not a boundary.** `/repo/a`, `/repo/a/`, `/repo/./a` and a symlink `/tmp/link → /repo/a` are the same directory and four different strings. Raw string equality both *denies legitimate grants* and, worse, lets a symlinked scope match a directory the user never granted. The defect is not hypothetical: the state analyst measured exactly this defect in the consumer's `TrustStore` — "compares paths by string equality (no `realpath` canonicalisation)". Canonicalize on **both** write and read (`realpathSync`), and refuse a scope that does not resolve rather than falling back to the raw string.
- **Signature, not raw command:** normalize (trim, collapse whitespace) but never fuzzy-match. A near-match that grants is worse than no grant.
- **Invariant:** deny-by-default; an absent or unreadable store grants nothing.
- **Reuse:** same `assertSecureModes` + atomic-replace as T3.2. Per `parsimony-ladder.md` rung 4 and G12 (DRY on knowledge), the two stores share the secure-read/atomic-write helper rather than duplicating it — extracted only if this is the **second** occurrence, which it is.
- **Edge case:** expiry — an expired grant is `unknown`, and the expired entry is reported, not silently dropped (the allowlist-sunset discipline this repo already uses).

#### Pseudo-code / Signatures
```pseudocode
type Grant = { tool: string, scope: string, signature: string, expiresAt?: number }
function isGranted(store, {tool, scope, command}, now) -> boolean
  g = store.find(tool, scope, normalize(command))
  if !g: return false                      # deny by default
  if g.expiresAt && g.expiresAt <= now: return false   # expired -> not granted
  return true

# Example
input:  grant(run_shell, /repo/a, "npm test"); ask(run_shell, /repo/b, "npm test")
output: false        # scope differs
```

#### Tasks
1. RED tests incl. the scope-isolation and expiry cases.
2. Extract the shared secure-read/atomic-write helper from T3.2 (second occurrence — Rule of 3 satisfied at 2 for a *security* helper, justified in the commit).
3. Implement the store; export it.

#### TDD
```
RED:     absent_grant_denies() — empty store, deny
RED:     grant_is_scoped() — grant in scope A does not authorize scope B
RED:     grant_is_signature_specific() — grant for 'npm test' does not authorize 'npm publish'
RED:     expired_grant_denies_and_is_reported() — assert deny + the expired entry surfaces
RED:     unreadable_store_denies() — fail closed
RED:     scope_is_canonicalized() — EC-2 (MUST FIX): '/repo/a', '/repo/a/', '/repo/./a' and a symlink to it all resolve to ONE key
RED:     unresolvable_scope_is_refused() — EC-2: a scope that does not realpath is rejected, never keyed raw
RED:     grant_expiring_exactly_now_is_denied() — EC-14: expiresAt === now denies (locks the `<=` boundary)
RED:     empty_store_file_reads_as_unknown() — EC-13: 0-byte file (crash-truncated) yields deny, not a parse throw
GREEN:   Implement
REFACTOR: Extract the shared secure-store helper used by T3.2 and this task
VERIFY:  pnpm vitest run packages/agents/tests/unit/permission-store.test.ts
```

#### Concurrency tests
Atomic-counter invariant (concurrent test) — N concurrent grant writes; assert all N present and the file always parses.
Grant-during-check — interleave isGranted() with writes; assert no read observes a partial file and no
check returns true for a grant that was never fully written (fail closed under partial state).

#### Acceptance Criteria
- [ ] Grants are scope- and signature-specific — `pnpm vitest run packages/agents/tests/unit/permission-store.test.ts -t scoped` exits 0
- [ ] Expiry denies and reports — `pnpm vitest run packages/agents/tests/unit/permission-store.test.ts -t expired` exits 0
- [ ] Deny-by-default on every error path — `pnpm vitest run packages/agents/tests/unit/permission-store.test.ts` exits 0 with every error-path case returning false
- [ ] Pass: coverage — `pnpm test:coverage` reports 100% on the grant decision (security path)
- [ ] Pass: size — `wc -l` on the new file returns ≤ 500 (G6)

#### DoD
- [ ] G2 assertion green
- [ ] CHANGELOG `Added`
- [ ] `wiki/capability-index.md` row added

---

## Phase 4: Partial absorptions

**Objective:** finish two absorptions that shipped half-done.

### T4.1 — Complete `resolveCredential`

#### Objective
Make the published resolver cover the mechanisms it claims.

#### Why this step (action + reasoning)

**What this step does.** Adds, in the order the cross-validation ranked by cost-of-being-wrong: (1) kills or implements the dead `kind: 'oauth'` variant, (2) prefix↔provider coherence, (3) a typed error carrying the ordered attempt list, (4) credential-file resolution.

**Why it is necessary now.** Gap G6. M79 shipped the argument and the env-only half; the published type declares a `kind: 'oauth'` variant **that no code path produces**, which is a correctness defect a consumer can only discover at runtime. Items 1 and 2 are correctness; 3 and 4 are the difference between the consumer deleting its 390 LOC and keeping it.

#### Evidence
- `packages/agents/src/auth/resolve-credential.ts` (194 LoC) — env-only resolution.
- `dist/auth.d.ts:227-239` — `CredentialResolution.kind: 'api-key' | 'oauth'` and `SourceOrigin{kind:'oauth'}`, both declared; the security analyst found no producing path.
- `dist/auth.d.ts:182-185` — the framework's own mechanism-vs-policy argument.
- Consumer `packages/agent/src/auth/credentials.ts:160-168` (`assertPairMatches`), `:101-106` (`inferProvider`), `:72-79,288-295` (`MissingCredentialError` with attempts), `:226-264` (file resolution).

#### Files to edit
```
packages/agents/src/auth/resolve-credential.ts — the four additions
packages/agents/tests/unit/resolve-credential.test.ts — RED per addition
tests/integration/crossval-gaps.test.ts — G6 assertion
```

#### Deep file dependency analysis
- `resolve-credential.ts` (Baseline row: 194 LoC, `164cbfec`) — **invariants:** returns `undefined` on "nothing configured" (documented behaviour a consumer relies on) and descriptors stay a parameter. The new typed error is for *contradiction* (a prefix naming a provider with no credential), matching the existing `ProviderPrefixMismatchError` precedent — never for absence.
- Published on `./auth`; external consumers exist. Additions are backward-compatible; the `oauth` variant decision is not (see Deep Dives).

#### Deep Dives
- **The dead variant is a fork in the road, and the plan does not pretend otherwise.** Either implement OAuth-kind resolution (reading the persisted OAuth credential the store already writes) or remove the variant from the published type. Removing is a **breaking type change**; implementing is more work and non-breaking. **Decision rule:** implement, because the store already persists OAuth credentials and the OAuth engine is already exported — the variant is not speculative, it is unfinished. Removal is the fallback only if implementing requires new SDK surface.
- **Coherence check:** `assertPairMatches` refuses a key whose prefix contradicts its declared provider. Refusing at resolution beats a 401 mid-request (`error-handling.md § 1`).
- **EC-3 (MUST FIX) — prefix inference is longest-match-wins, or it is wrong by construction.** `sk-` is a strict prefix of both `sk-ant-` and `sk-or-`, so a scan in declaration order matches `sk-` first and routes an Anthropic key to OpenAI. The mis-route produces exactly the mid-request 401 the coherence check next to it exists to prevent. The consumer solved this by sorting descending on prefix length (`PREFIXES_BY_LENGTH`); sort before scanning and pin it with the `sk-ant-` case in the RED set.
- **File budget:** the file is 194 LoC and grows; if it approaches 400 (G6 WARN) split resolution strategies into a sibling module.
- **Edge case:** the `.env` parser is measurably weaker than the consumer's (no multiline quoted values), so provenance mis-attributes. Fixing the parser is in scope for item 3's correctness, since provenance is what the error message reports.

#### Tasks
1. RED tests for all four additions.
2. Implement OAuth-kind resolution (or remove the variant per the decision rule, with a CHANGELOG BREAKING note).
3. Implement coherence, typed error with attempts, file resolution.
4. Fix the multiline-quoted-value case in the `.env` name parser.

#### TDD
```
RED:     oauth_kind_is_producible() — persisted OAuth credential resolves to kind 'oauth' with expiresAt
RED:     longest_prefix_wins() — EC-3 (MUST FIX): an `sk-ant-...` key infers anthropic, NOT openai via the shorter `sk-`
RED:     prefix_provider_mismatch_is_refused() — sk-ant- key declared as openai -> typed error
RED:     missing_credential_lists_attempts_in_order() — asserts the ordered attempt list is on the error
RED:     credential_file_is_read_when_env_absent() — auth.json resolves
RED:     env_parser_handles_multiline_quoted_value() — provenance attributes to the right variable
GREEN:   Implement the four additions
REFACTOR: Split resolution strategies if the file approaches 400 LoC
VERIFY:  pnpm vitest run packages/agents/tests/unit/resolve-credential.test.ts
```

#### Concurrency tests
(none — single-threaded)
Resolution is a pure read. The OAuth *refresh* path (`AuthProvider.ensureFresh`) already owns its cross-process lock in the SDK and is not modified here.

#### Acceptance Criteria
- [ ] No declared variant is unproducible — `pnpm vitest run packages/agents/tests/unit/resolve-credential.test.ts -t oauth_kind_is_producible` exits 0 (or the variant is removed and `git diff` shows the BREAKING CHANGELOG note)
- [ ] A contradictory prefix/provider pair is refused at resolution — `pnpm vitest run packages/agents/tests/unit/resolve-credential.test.ts -t mismatch_is_refused` exits 0
- [ ] `undefined`-on-absence behaviour preserved
- [ ] Pass: coverage ≥ 90%; the coherence and error paths 100%
- [ ] Pass: size — `wc -l` returns ≤ 500 (G6)

#### DoD
- [ ] G6 assertion green
- [ ] CHANGELOG entry; BREAKING marked if the variant was removed
- [ ] `wiki/capability-index.md` updated

---

### T4.2 — Make GC pointer protection injectable

#### Objective
Stop the pointer protection from being silently inert inside a deletion guard.

#### Why this step (action + reasoning)

**What this step does.** Adds an injectable protected-ids seam to `TranscriptGCOptions`, so a consumer whose live-session pointer lives elsewhere can feed the guard.

**Why it is necessary now.** Gap G5. The GC is real, tested and in one respect better than the consumer's (it floors on both `keepLast` and `maxAgeDays`, where the consumer floors only on `maxAgeDays`). But `protectedTranscripts` derives protection from *this* framework's pointer convention; for a consumer whose pointer is elsewhere the protection is **inert — silently, inside a guard that deletes user transcripts.** The consumer's own PS-002 was exactly this class: a guard declared, wired, and never called.

#### Evidence
- `packages/agents/src/session/gc/transcript-gc.ts:6` — imports `protectedTranscripts` directly.
- `packages/agents/src/session/session-lifecycle.ts:126` — `protectedTranscripts(cwd, root)` derives ids from this convention.
- Consumer `packages/agent/src/session/gc/all-sessions.ts` — 442 LOC of a different protection model.

#### Files to edit
```
packages/agents/src/session/gc/transcript-gc.ts — accept injectable protected ids, defaulting to protectedTranscripts
packages/agents/src/session/index.ts — export the widened option type
packages/agents/tests/unit/transcript-gc-protection.test.ts (NEW) — RED
tests/integration/crossval-gaps.test.ts — G5 assertion
```

#### Deep file dependency analysis
- `transcript-gc.ts` (Baseline row: 207 LoC, `164cbfec`) — **invariants:** the four GC invariants and the `GCFloorError` refusal stay; dry-run stays the default. The seam is additive with the current behaviour as default, so no existing caller changes.
- `session/index.ts` (Baseline row: 40 LoC) — the option type it re-exports at `:38` widens.

#### Deep Dives
- **The default must remain the current behaviour**, or this task turns a safety fix into a regression: absent injection, `protectedTranscripts` is still consulted.
- **Invariant:** injection only *adds* protected ids, never remove them. A consumer must not be able to unprotect a session this framework knows is live — otherwise the seam becomes a deletion vector.
- **Edge case:** an injected provider that throws must fail the GC closed (refuse to collect), matching `GCFloorError`'s posture of refusing rather than clamping — and matching the consumer's own fail-open bug (PS-001) that the present plan must not reproduce.

#### Pseudo-code / Signatures
```pseudocode
function planTranscriptGC(options)
  builtin = protectedTranscripts(options.cwd, root)
  extra   = options.protectedIds?() ?? []      # additive only
  protected = union(builtin, extra)            # never a difference
  ...on extra throwing: throw — refuse to collect

# Example
input:  builtin={s1}, injected={s2}
output: protected={s1,s2}   # s1 can never be dropped by injection
```

#### Tasks
1. RED tests incl. the union-not-difference and fail-closed cases.
2. Widen `TranscriptGCOptions` with an optional provider.
3. Union the sets; keep the default.

#### TDD
```
RED:     injected_ids_are_added_not_substituted() — builtin protection survives injection
RED:     default_behaviour_unchanged_without_injection() — regression guard
RED:     throwing_provider_fails_closed() — GC refuses to collect, does not proceed unprotected
GREEN:   Implement the seam
REFACTOR: None expected
VERIFY:  pnpm vitest run packages/agents/tests/unit/transcript-gc-protection.test.ts
```

#### Concurrency tests
GC plans and then applies, with a TOCTOU window the module already re-checks at apply.
Plan-then-delete concurrent test (happens-before observation across the TOCTOU window) — between plan and apply, mark a candidate live via the injected provider;
assert apply re-checks and refuses that candidate (the existing TOCTOU re-check must cover injected ids
too, not only builtin ones).

#### Acceptance Criteria
- [ ] Injection adds, never removes, protection — `pnpm vitest run packages/agents/tests/unit/transcript-gc-protection.test.ts -t added_not_substituted` exits 0
- [ ] Default behaviour byte-identical without injection — `pnpm vitest run packages/agents/tests/unit/transcript-gc-protection.test.ts -t default_behaviour_unchanged` exits 0
- [ ] Fail-closed on a throwing provider — `pnpm vitest run packages/agents/tests/unit/transcript-gc-protection.test.ts -t throwing_provider` exits 0
- [ ] TOCTOU re-check covers injected ids — `pnpm vitest run packages/agents/tests/unit/transcript-gc-protection.test.ts -t plan_then_delete` exits 0
- [ ] Pass: coverage — `pnpm test:coverage` reports 100% on the protection path (deletion path)

#### DoD
- [ ] G5 assertion green
- [ ] CHANGELOG `Changed`
- [ ] `wiki/capability-index.md` updated

---

## Phase 5: The root cause

**Objective:** make an unforwarded symbol break CI on every subpath, not one.

### T5.1 — Generalize the parity gate to 19 subpaths, in warn mode

#### Objective
Turn the gate on everywhere without breaking the build in the same commit.

#### Why this step (action + reasoning)

**What this step does.** Renames `check-auth-parity.mjs` to `check-surface-parity.mjs`, enumerates subpaths from `packages/agents/package.json#exports` instead of the hand-kept `DECISIONS` keys, and reports undecided symbols on the 18 new subpaths as warnings (exit 0) while `auth` stays a hard error.

**Why it is necessary now.** Per D1 this is the only structural fix in the plan. Per the Drawbacks table, landing 18 subpaths as hard errors in one commit would leave CI red until every symbol has a decision — the "gate nobody can make green is a gate nobody reads" failure the script's own header warns about (`:26`). Warn mode first is the mitigation, not a softening.

#### Evidence
- `scripts/check-auth-parity.mjs:43` — `PISO_DE_SIMBOLOS = { auth: 15 }`.
- `:49` — `DECISIONS` with one key.
- `:97` — iterates `Object.entries(DECISIONS)`.
- `packages/agents/package.json` — 19 export subpaths.
- `scripts/check-package-direction.mjs:12-13` — the read-from-manifest technique this borrows.

#### Files to edit
```
scripts/check-surface-parity.mjs (NEW — git mv from check-auth-parity.mjs) — enumerate from exports; warn mode for new subpaths
package.json — rename the script; keep check:auth-parity as an alias for one release
scripts/__tests__/check-surface-parity.test.mjs (NEW) — RED
tests/integration/crossval-gaps.test.ts — G7 assertion (warn-mode half)
```

#### Deep file dependency analysis
- `check-auth-parity.mjs` (Baseline row: 209 LoC, `c4bd6d4b`) — **invariant: the "decision, not coverage" contract MUST NOT become a coverage demand.** The generalization changes *which subpaths* are walked, never *what is demanded per symbol*.
- `package.json` (root) — `check:all` keeps chaining every gate (Baseline invariant); the renamed script replaces the old name in the chain.

#### Deep Dives
- **Enumerate from the manifest, not a constant** — mirrors `check-package-direction.mjs:12-13` so the guard cannot drift as subpaths come and go.
- **Anti-vacuity floor generalizes too:** each subpath needs a floor, or a failed `import()` returns zero symbols and "0 undecided" is trivially true. Default the floor to 1 and record measured floors per subpath as they are established.
- **EC-7 (MUST FIX) — warn mode carries a SUNSET, or it becomes the permanent state.** Printing a count is not a forcing function: T5.2 promotes four subpaths and the remaining 14 would warn forever, degrading D1's structural fix into "we print something" — the pre-existing state with extra output. The repository already has the antidote as a convention: `code-quality-allowlist.txt` and `deps-audit-allowlist.txt` both require a sunset ≤ 90 days, and an **expired entry re-fires at full severity**. Apply the same rule: each warn-mode subpath carries a sunset date in the script, and past that date it fails hard. Warn mode must print the count, the date it was introduced **and** its sunset.
- **Edge case:** `./client/react` and `.` are subpaths whose SDK counterpart does not exist; a subpath with no SDK side is skipped with a logged reason, not silently.

#### Pseudo-code / Signatures
```pseudocode
subpaths = Object.keys(require('packages/agents/package.json').exports)
for sp in subpaths:
  sdkSurface = enumerate(`@theokit/sdk/${sp}`)   # skip+log when absent
  if sdkSurface.length < floor(sp): fail("surface unreadable")
  undecided = sdkSurface - decisions(sp)
  if sp == 'auth': errors += undecided           # hard
  else:            warnings += undecided         # warn mode (T5.2 promotes)

# Example
input:  ./session exposes 12 SDK symbols, 0 decisions registered
output: WARN "./session: 12 symbols without a decision (warn mode since 2026-08-14)" ; exit 0
```

#### Tasks
1. `git mv` the script; keep the old npm script name as an alias.
2. Enumerate subpaths from the manifest.
3. Add per-subpath floors and the skip-with-reason path.
4. Implement warn vs error split.

#### TDD
```
RED:     gate_enumerates_every_exports_subpath() — asserts the walked set equals package.json#exports keys
RED:     auth_stays_a_hard_error() — an undecided auth symbol exits 1
RED:     new_subpaths_warn_not_fail() — an undecided session symbol exits 0 and prints
RED:     unreadable_surface_fails_not_passes() — a subpath below its floor exits 1 (anti-vacuity)
RED:     missing_sdk_counterpart_is_skipped_with_reason() — logged, not silent
RED:     warn_mode_entry_requires_a_sunset() — EC-7 (MUST FIX): a warn-mode subpath with no sunset date exits 1
RED:     expired_warn_mode_fails_hard() — EC-7: a subpath past its sunset stops warning and exits 1, matching the allowlist convention
GREEN:   Implement
REFACTOR: None expected
VERIFY:  node scripts/check-surface-parity.mjs && pnpm vitest run scripts/__tests__/check-surface-parity.test.mjs
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] All 19 subpaths walked — `node scripts/check-surface-parity.mjs` prints 19 subpath lines and exits 0
- [ ] `auth` still hard-fails; new subpaths warn
- [ ] Anti-vacuity floor active per subpath — `pnpm vitest run scripts/__tests__/check-surface-parity.test.mjs -t unreadable_surface` exits 0
- [ ] Every warn-mode subpath carries a sunset ≤ 90 days, and an expired one fails hard (EC-7) — `pnpm vitest run scripts/__tests__/check-surface-parity.test.mjs -t sunset` exits 0
- [ ] `pnpm check:all` green

#### DoD
- [ ] G7 warn-mode assertion green
- [ ] CHANGELOG `Changed`
- [ ] Warn-mode counts recorded in the PR description (feeds Q3 and D8's split trigger)

---

### T5.2 — Promote subpaths from warn to error — **SPLIT TRIGGER FIRED (2026-08-14)**

> **Deferred to its own plan, by the rule this plan declared before it knew the number.**
>
> D8 set the trigger at "more than 40 undecided symbols". Measured after T5.1 landed:
>
> | Subpath | Undecided symbols |
> |---|---:|
> | `.` (SDK root barrel) | 383 |
> | `./sandbox` | 37 |
> | `./persistence` | 29 |
> | `./interactive` | 9 |
> | `./client` | 1 |
> | **Total** | **459** |
>
> 459 is an order of magnitude past the trigger, and `.` alone is ten times it. Writing 459 written
> decisions inside a plan whose Goal is "close 12 gaps" would bury the other eleven, and each
> decision is a judgement about whether a symbol SHOULD cross — not clerical work to rush.
>
> **This is not a deferral without a date.** T5.1 shipped the sunset (2026-11-12) and
> `tests/unit/check-surface-parity.test.ts` asserts that an expired deferral fails the gate hard. The
> forcing function exists and is tested; what moves to `crossval-parity-decisions` is the work, not
> the obligation.
>
> The original task text is kept below as the specification that plan inherits.

</details>
<details>
<summary>Original T5.2 specification (inherited by <code>crossval-parity-decisions</code>)</summary>


#### Objective
Make the gate real on the subpaths where the measured gaps live.

#### Why this step (action + reasoning)

**What this step does.** Writes the per-symbol decisions for `session`, `tools`, `hooks` and `sandbox` and flips those four from warn to error.

**Why it is necessary now.** Those four are where this plan's gaps concentrate, so they are where the gate pays first. Doing them subpath by subpath keeps each commit reviewable and each CI break attributable — the opposite of the all-at-once failure the Drawbacks table names.

#### Evidence
- Gaps G1/G5 (session), G4 (hooks), G12-adjacent (tools), plus the `createShellTool` re-export hole in `packages/agents/src/tools/index.ts` where the SDK keeps `sandbox` optional.
- T5.1's warn output — the actual undecided counts (unknown until T5.1 runs; this is Q3).

#### Files to edit
```
scripts/check-surface-parity.mjs — move the four subpaths to the error set; record their floors
packages/agents/src/tools/index.ts — decide the raw createShellTool re-export (forward with sandbox required, or document out-with-reason)
tests/integration/crossval-gaps.test.ts — G7 assertion (error-mode half)
```

#### Deep file dependency analysis
- `tools/index.ts` (Baseline row: 12 LoC, `26ad3db0`) — **invariant: existing named exports stay** (removal is breaking). If raw `createShellTool` must stop being forwarded, that is a deprecation with a CHANGELOG BREAKING note, not a silent removal.

#### Deep Dives
- **A decision is not a rubber stamp.** `out: '<reason>'` requires a real reason; "not needed" is not one. The reviewer checks reasons, which is the only part of this gate a script cannot enforce.
- **The `createShellTool` hole is a decision, not a bug to paper over:** forwarding a factory where `sandbox` is optional re-opens B-006 (the silent unconfined shell) for anyone bypassing `bindToolScope`. The decision is either "forward a wrapper that requires sandbox" or "out — use `bindToolScope`", written down either way.
- **If undecided symbols exceed 40**, D8's split trigger fires and the remaining subpaths move to their own plan.

#### Tasks
1. Read T5.1's warn output for the four subpaths.
2. Write a decision per symbol.
3. Flip the four to error; record floors.
4. Resolve the `createShellTool` re-export decision.

#### TDD
```
RED:     session_tools_hooks_sandbox_are_hard_errors() — an undecided symbol on each exits 1
RED:     every_decision_has_a_reason() — asserts no `out` entry with an empty/placeholder reason
GREEN:   Write the decisions; flip the four
REFACTOR: None expected
VERIFY:  node scripts/check-surface-parity.mjs && pnpm check:all
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Four subpaths hard-fail on an undecided symbol — `node scripts/check-surface-parity.mjs` exits 1 when a decision is removed from any of session/tools/hooks/sandbox
- [ ] Every `out` decision carries a non-placeholder reason
- [ ] The `createShellTool` decision is written down
- [ ] `pnpm check:all` green

#### DoD
- [ ] G7 assertion green at 19/19 walked, 5/19 hard
- [ ] CHANGELOG `Changed`
- [ ] Remaining warn-mode subpaths listed in the PR with an owner

---

## Phase 6: Sibling repo — `@theokit/tui`

**Objective:** close the two TUI gaps that survived re-verification.

### T6.1 — Close U-9 (masked input) and U-8 (status-footer mode union)

#### Objective
Remove 63 LOC of hand-rolled masked input from every terminal consumer.

#### Why this step (action + reasoning)

**What this step does.** Adds a masked mode to `FreeTextInput` and opens the `StatusFooterProps.mode` union, in `../theokit-tui`, as a separate PR.

**Why it is necessary now.** Re-verified against the published `@theokit/tui@0.52.1`: **U-7 is closed** (`WelcomeBannerProps.art` exists beside `aside`) and **U-10 is half closed** (`hiddenBefore`/`hiddenAfter` are numeric; the `readJsonlTail` absolute-index half is untouched). U-8 and U-9 survived. Per D7 this lands last and in its own PR, so it is announced through the channel Phase 0 repaired.

#### Evidence
- `@theokit/tui@0.52.1` `dist/index.d.ts:973` — `PERMISSION_MODES` still `[default, auto-accept, plan]`.
- Same file `:1316-1330` — `FreeTextInputProps` has no mask.
- Consumer `packages/tui/src/components/SecretInput.tsx` (63 LOC) and `secret-buffer.ts` — masked input whose value never enters React state.
- Consumer `packages/tui/src/components/SessionFooter.tsx:56-63` — never passes `mode`, stuffs everything into `left`.

#### Files to edit
```
../theokit-tui/src/... (SIBLING REPO — separate PR) — FreeTextInput mask mode; StatusFooterProps.mode union
../theokit-tui/tests/... (SIBLING REPO) — RED tests
tests/integration/crossval-gaps.test.ts — G12 assertion, version-gated on the published @theokit/tui
```

#### Deep file dependency analysis
- Sibling-repo files are **not** in this repo's Baseline table by design — this plan does not govern that repo (D7). The only file changed *here* is the gap register, whose G12 assertion reads the installed `@theokit/tui` version and `skipIf` it predates the fix, logging the reason.

#### Deep Dives
- **The masked-input invariant is the point:** the consumer's implementation keeps the secret out of React state. A framework version that puts it in state is worse than no version, because it looks safe.
- **Edge case:** paste into a masked field, and terminal echo during paste.
- **This repo's assertion must not hard-fail before the sibling publishes** — hence the version gate, with a loud skip reason.

#### Tasks
1. Open the sibling PR: mask mode + widened union + tests.
2. Publish `@theokit/tui`.
3. Bump the consumer-facing range here if applicable; un-skip the G12 assertion.

#### TDD
```
RED (sibling):  free_text_input_masks_value() — rendered output shows no plaintext
RED (sibling):  masked_value_never_enters_component_state() — asserts the state holds no secret
RED (sibling):  status_footer_accepts_consumer_modes() — the widened union compiles
RED (here):     G12 assertion — installed @theokit/tui exposes the mask prop (skipIf older, logged)
GREEN:          Implement in the sibling; publish; un-skip here
REFACTOR:       None expected
VERIFY:         (sibling) pnpm test ; (here) pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Masked input available and secret never in component state — the sibling repo's `pnpm test -t masked` exits 0
- [ ] `mode` union covers the consumer's real modes
- [ ] G12 assertion green — `pnpm vitest run tests/integration/crossval-gaps.test.ts -t G12` exits 0, or prints its skip reason with the installed `@theokit/tui` version

#### DoD
- [ ] Sibling PR merged and published
- [ ] G12 assertion green
- [ ] `wiki/capability-index.md` row added

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | `forkBeforeUserTurn` published broken (always throws) | T1.1 | Count `type === 'user'`; add the tests it never had |
| G2 | No persisted permission rules anywhere | T3.3 | `PermissionStore` keyed by (tool, scope, signature) with expiry |
| G3 | Delegated member does not inherit parent's hook veto | T3.1 | Inheritance on by default, explicit opt-out, transitive |
| G4 | Fingerprint gate's `approved` set has no producer | T3.2 | `approval-store` with approved/unknown/modified, fail-closed |
| G5 | GC pointer protection inert for other consumers | T4.2 | Injectable protected-ids seam, additive-only, fail-closed |
| G6 | `resolveCredential` is the env-only half | T4.1 | Dead `oauth` variant, coherence check, typed error with attempts, file resolution, `.env` parser fix |
| G7 | Parity gate covers 1 of 19 subpaths | T5.1, T5.2 | Enumerate from the manifest; warn mode then error on 4 subpaths |
| G8 | Config/context reachable only via a deprecated barrel | T2.1, T2.2 | `@theokit/agents/config` subpath; old door points at it |
| G9 | Tarball ships no README/CHANGELOG; versions stranded | T0.1, T0.2 | Create README, ship CHANGELOG, give 8.2.0–8.6.0 headings |
| G10 | No capability index anywhere | T0.3 | `wiki/capability-index.md` — capability → symbol → version |
| G11 | `./testing` seam typed over the wrong type, zero adoption | T1.2 | Re-type over what the composition path returns |
| G12 | `@theokit/tui` U-8/U-9 open | T6.1 | Mask mode + widened union in the sibling repo |

**Coverage: 12/12 gaps covered (100%)**

Two documentation defects found alongside the gaps are also covered: the README teaching a removed import and the stale `CLAUDE.md` ecosystem table, both in T0.4.

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` green
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] File-size budget respected — every changed file ≤ 500 LoC (`system-design-guardrails.md` G6)
- [ ] `CHANGELOG.md` updated under `[Unreleased]` for every phase (Unbreakable Rule 6)
- [ ] Backward compatibility preserved, or every break marked BREAKING in the CHANGELOG with the affected callers named (applies to D6 and to T4.1's variant decision)
- [ ] `pnpm check:all` green, including the renamed `check:surface-parity`
- [ ] **`tests/integration/crossval-gaps.test.ts` green at 12/12** — the Goal's metric
- [ ] `wiki/capability-index.md` has a row for every capability this plan adds or completes
- [ ] **Runtime-metric proof** — T3.1's inheritance, T3.2's and T3.3's deny-by-default, and T4.2's fail-closed are each observed in an integration test, not only compiled
- [ ] Q1 and Q4 answered before Phase 5 merges; Q3 recorded with the measured count
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` and the PR is merged, move this file to `knowledge-base/plans/completed/crossval-absorption-gaps-plan.md`

## Failure scenarios

The plan touches the filesystem (credential file, approval store, permission store, transcript GC) and one network path (OAuth refresh, unmodified but exercised).

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Approval store (fs) | Unreadable file (EACCES) | inject a throwing reader / `chmod 000` in a temp dir | Every hook reads `unknown`; deny-by-default; the read error is reported, not swallowed (`error-handling.md § 2`) |
| Approval store (fs) | Group/other-writable directory | create the dir with mode 0777 | `assertSecureModes` refuses; the gate does not fall back to permissive |
| Permission store (fs) | Torn write (crash mid-write) | write a truncated JSON file directly | Parse failure denies every grant; the corrupt file is reported, never silently reset |
| Permission store (fs) | Concurrent writers | N processes granting simultaneously | Atomic replace; all N entries present; no reader observes a partial file |
| Transcript GC (fs) | Injected protected-ids provider throws | provider that throws on call | GC refuses to collect (fail closed), matching `GCFloorError`'s refuse-don't-clamp posture |
| Transcript GC (fs) | Candidate becomes live between plan and apply | mark live via the injected provider after plan | Apply re-checks and refuses that candidate |
| Credential file (fs) | `auth.json` malformed | write invalid JSON | Typed `CredentialError` naming the path; never a silent fallback to another provider's key |
| OAuth refresh (HTTP) | Provider 5xx / timeout during `ensureFresh` | inject a `fetch` returning 503 / never resolving | Transient failure tolerated: the existing credential is returned rather than the run failing (behaviour preserved, asserted by a regression test since T4.1 touches this file) |

## Final Phase: Integration Validation (MANDATORY)

> Runs after Phases 0–5 (Phase 6 gates separately on the sibling publish).

**Objective:** prove the changes work in a real workload, not only as isolated units.

### Execution

```bash
pnpm test                 # unit + integration
pnpm test:coverage        # ≥ 90% on changed files
pnpm test:types           # type-level assertions
pnpm typecheck            # zero type errors
pnpm lint                 # zero warnings
pnpm check:all            # 9-gate chain incl. check:surface-parity, check:direction, knip
pnpm vitest run tests/integration/crossval-gaps.test.ts   # THE metric — 12/12
```

Failure-scenario pass (the `## Failure scenarios` rows):

```bash
pnpm vitest run packages/agents/tests/**/*failure*.test.ts packages/agents/tests/**/*store*.test.ts
```

### Acceptance Criteria

- [ ] All suites green — `pnpm test` exits 0
- [ ] Coverage ≥ 90% on changed files; 100% on the security paths (T3.1 inheritance, T3.2/T3.3 deny-by-default, T4.2 protection, T4.1 coherence)
- [ ] Zero type errors, zero lint warnings — `pnpm typecheck` and `pnpm lint` both exit 0
- [ ] `pnpm check:all` green with 19/19 subpaths walked
- [ ] `crossval-gaps.test.ts` 12/12 — with G12 either green or loudly skipped with its version reason
- [ ] Runtime-metric proof — `pnpm vitest run packages/agents/tests/**/*store*.test.ts` exits 0 with every deny-by-default and fail-closed path asserted firing
- [ ] Every `## Failure scenarios` row exercised and the expected behaviour observed

### If Validation Fails

1. Separate plan-caused failures from pre-existing ones (`git stash` the branch and re-run to classify).
2. Fix every plan-caused failure before declaring the plan complete.
3. Re-run the chain.
4. Pre-existing issues are documented in the PR description and do not block, **except** any failure on a security path this plan touches — those block regardless of origin.

</details>
