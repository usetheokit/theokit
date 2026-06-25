---
slug: v32-ui-peer-widen-valibot-patch
milestone_id: V3-2
created_at: 2026-06-23
goal: Widen theokit @theokit/ui peer + bump theo-ui valibot past the HIGH CVE
---

# Plan: V3-2 — widen `@theokit/ui` peer + patch `valibot` (coupled)

## Goal

> "Enable the theocode app to adopt `@theokit/ui@0.18.x` without `npm install --force` AND eliminate the transitive `valibot` HIGH (GHSA-vqpr-j7v3-hqw9), measured by `npm install theokit@<next> @theokit/ui@0.18.x` resolving with NO ERESOLVE and `npm audit` reporting 0 HIGH from valibot."

## Context

Two coupled gaps (F-V2-2G-1 + F-V2-2G-4), empirically confirmed 2026-06-23:
1. `theokit@0.8.3` declares `peerDependencies["@theokit/ui"]: "^0.14.0"` (optional). Installing it alongside `@theokit/ui@0.18.1` fails with **ERESOLVE** (`peerOptional @theokit/ui@"^0.14.0" from theokit@0.8.3` → `Conflicting peer dependency: @theokit/ui@0.14.4`), so theocode is pinned to 0.14.x.
2. `@theokit/ui@0.18.1` depends on `valibot@^0.42.1`, which is in the affected range of **GHSA-vqpr-j7v3-hqw9** (HIGH — ReDoS in `EMOJI_REGEX`, affects `>=0.31.0 <1.2.0`; fixed in `1.2.0+`, `fixAvailable: valibot@1.4.1`, semver-major). `npm audit` reports it HIGH. It only clears by bumping valibot — which needs a new `@theokit/ui` release.

They are one problem: widen the theokit peer so 0.18.x resolves, and ship a `@theokit/ui` whose valibot is past the CVE. valibot 1.4.1 was verified to export every API theo-ui uses (`pipe/object/string/optional/array/safeParse/regex/minLength/url`) → the major bump is near-drop-in.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | Repo | Why it exists |
|---|---|---|
| `packages/theo/package.json` | theokit | declares `peerDependencies["@theokit/ui"]: "^0.14.0"` (:130) + optional meta (:140) |
| `package.json` (root) | theo-ui | `@theokit/ui@0.18.1`; `valibot: "^0.42.1"` (:766) |
| `src/themes/schema.ts` | theo-ui | valibot theme schema (`v.pipe/object/string/optional/array`) — verify against valibot 1.x |
| `src/themes/schema.test.ts` | theo-ui | the schema unit test — the valibot-compat oracle |
| `src/themes/theme-provider.tsx` | theo-ui | consumes the schema (`v.safeParse`) |

### Current callers / dependents

- `@theokit/ui` peer (theokit): consumed by apps (theocode) + `@theokit/http@0.5.4` peers `theokit>=0.2.0`. Widening the range is purely additive (accepts MORE versions) — no consumer breaks.
- valibot (theo-ui): used ONLY in `src/themes/` (3 files, modular `v.*` API). No other module imports it.
- `@theokit/ui` public API: unchanged by the valibot bump (valibot is an internal impl detail of the theme schema, not re-exported).

### Domain glossary

- **peerOptional ERESOLVE** — npm refuses to install when an optional peer's declared range excludes the installed version.
- **GHSA-vqpr-j7v3-hqw9** — valibot ReDoS in `EMOJI_REGEX`; affected `>=0.31.0 <1.2.0`; fixed `1.2.0+`.
- **near-drop-in major** — valibot 0.42→1.x: the modular `v.pipe(...)` API theo-ui uses is stable across the boundary (verified).
- **loop closure** — theocode bumps `@theokit/ui@0.18.x` without `--force` and `npm audit` shows no valibot HIGH.

### Architecture boundaries affected

theokit: a single peer-range string (no code). theo-ui: a dependency version + (if any) a schema-API tweak confined to `src/themes/`. No public-API change in either package.

## Prior Art & Related Work

(none — first-of-its-kind in this codebase as a discovery; this is a dependency-hygiene + CVE fix. The "spec" is the empirical evidence, not a reference codebase: the confirmed ERESOLVE (`theokit@0.8.3` × `@theokit/ui@0.18.1`), the `npm audit` advisory GHSA-vqpr-j7v3-hqw9, and the verified valibot-1.4.1 API surface. Per `cycle-discover` ("do NOT discover what your manifests/advisories answer"), no reference-codebase investigation applies.)

## Objective

Widen theokit's `@theokit/ui` optional peer to accept 0.18.x, and bump theo-ui's valibot past the HIGH CVE (verifying the theme schema still parses), so theocode adopts `@theokit/ui@0.18.x` cleanly with a CVE-free audit.

## ADRs

### D1 — Widen the peer to `^0.14.0 || ^0.18.0` (not an open `*` range)

**Decision:** change theokit's `peerDependencies["@theokit/ui"]` from `^0.14.0` to `^0.14.0 || ^0.18.0`.

**Rationale:** accepts the new 0.18.x line while still allowing existing 0.14.x consumers (additive, no break). An open range (`*`/`>=0.14.0`) is rejected — it would silently accept a future breaking 0.x that theokit hasn't validated against (0.x minors can break). Explicit OR-of-caret-ranges is the honest, validated surface (0.15-0.17 are intentionally excluded — theocode jumps 0.14→0.18).

**Alternatives considered:** open `>=0.14.0` (rejected — unbounded, accepts unvalidated future breaks); bump the peer to `^0.18.0` only (rejected — would drop 0.14.x consumers, a breaking change for them).

### D2 — Bump valibot to `^1.4.1` (the fixAvailable), not pin `1.2.0`

**Decision:** in theo-ui, change `valibot` from `^0.42.1` to `^1.4.1`.

**Rationale:** `1.4.1` is npm's `fixAvailable` and the current latest; the modular API theo-ui uses is verified present in 1.4.1. Pinning the minimum `1.2.0` would ship an already-stale dep. The bump is semver-major for valibot but the theme schema (`src/themes/`) uses only stable APIs.

**Alternatives considered:** patch within 0.42.x (impossible — the advisory affects all `<1.2.0`); `^1.2.0` (rejected — ships stale; `^1.4.1` is current + same fix).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| valibot 1.x changed a behavior the theme schema relies on (silent parse difference) | MEDIUM | `src/themes/schema.test.ts` is the oracle — run it against 1.4.1; add a parse round-trip assertion if coverage is thin; the used APIs were verified to exist | implementer |
| Widening the peer lets a consumer pair theokit with a 0.18.x that has its OWN incompatibility | LOW | the OR range is explicit (0.14 ‖ 0.18), both lines are real published majors theokit's vite-plugin contract test covers; not an open range | implementer |
| Two-repo release ordering (theo-ui must publish the CVE-free version before theocode can adopt) | LOW | document the order: theo-ui release (valibot fix) → theokit release (peer widen) → theocode bump; each step independently validated | implementer |

## Unresolved Questions

(none — every decision is resolved at plan time: peer range `^0.14.0 || ^0.18.0` (D1), valibot `^1.4.1` (D2), oracle = theo-ui schema test + npm audit.)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/ui` | `^0.14.0 || ^0.18.0` | npm | theokit optional peer — WIDENED (range change, not a new dep) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | valibot is already a theo-ui dep — only its version changes | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

### Bumped (security)

| Package | From | To | Repo | CVE |
|---|---|---|---|---|
| `valibot` | `^0.42.1` | `^1.4.1` | theo-ui | GHSA-vqpr-j7v3-hqw9 (HIGH, ReDoS) |

## Dependency Graph

```
Phase 1 (theo-ui valibot bump + release) ──▶ Phase 2 (theokit peer widen + release) ──▶ Phase 3 (Integration Validation: theocode resolves + audit clean)
```

Phase 2 is independent of Phase 1 in code (different repos) but the LOOP closes only after Phase 1 ships a CVE-free `@theokit/ui`. Phase 3 validates both.

## Phase 1: theo-ui valibot bump

### T1.1 — Bump valibot to `^1.4.1` + verify the theme schema (theo-ui)

#### Objective
Change `valibot` `^0.42.1`→`^1.4.1` in theo-ui; confirm `src/themes/schema.test.ts` passes and `npm audit` shows no valibot HIGH.

#### Why this step (action + reasoning)
Action: bump the dep, `pnpm install`, run the theme schema test, run `npm audit`. Reasoning: the CVE (GHSA-vqpr-j7v3-hqw9) only clears at valibot 1.2.0+; the schema test is the oracle that the modular API still parses themes correctly after the major bump (D2; the used APIs were verified present in 1.4.1).

#### Evidence
`theo-ui/package.json:766` `valibot: ^0.42.1`; advisory affects `<1.2.0`; valibot 1.4.1 exports all used APIs (verified).

#### Files to edit
- `package.json` (theo-ui root) — `valibot` → `^1.4.1`.
- `src/themes/schema.ts` / `theme-provider.tsx` — ONLY if a valibot 1.x API rename is hit (expected: none).
- `src/themes/schema.test.ts` — add a parse round-trip assertion if the existing coverage is thin.

#### Deep file dependency analysis
valibot is imported only in `src/themes/` (3 files). The `@theokit/ui` public API does not re-export valibot, so the bump is internal. No other theo-ui module is affected.

#### TDD
```
test_theme_schema_parses_valid_theme_under_valibot_1x — safeParse a valid theme object → success:true. RED if a 1.x API break regresses the schema.
test_theme_schema_rejects_invalid_theme — safeParse an invalid theme (bad color) → success:false. Guards the validation still rejects.
(npm audit) — re-run after install: 0 HIGH from valibot.
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Schema parsing is pure/synchronous; no shared state, no async.

#### Acceptance Criteria
- `src/themes/schema.test.ts` passes against valibot 1.4.1 (theo-ui test runner exits 0).
- `npm audit` (theo-ui) reports 0 HIGH attributable to valibot.

#### DoD
- valibot at `^1.4.1`; theme schema tests green; theo-ui typecheck/lint clean; audit no valibot HIGH; changeset/version for the `@theokit/ui` release.

## Phase 2: theokit peer widen

### T2.1 — Widen the `@theokit/ui` optional peer (theokit)

#### Objective
Change `peerDependencies["@theokit/ui"]` from `^0.14.0` to `^0.14.0 || ^0.18.0` in theokit; confirm `npm install theokit@<next> @theokit/ui@0.18.x` resolves with no ERESOLVE.

#### Why this step (action + reasoning)
Action: edit the peer range in `packages/theo/package.json`; run `pnpm sync:templates` (the peer appears in templates/fixtures); validate resolution. Reasoning: the ERESOLVE is the confirmed gap (D1); widening to the explicit OR-range accepts 0.18.x without dropping 0.14.x consumers.

#### Evidence
`packages/theo/package.json:130`; confirmed ERESOLVE (`theokit@0.8.3` × `@theokit/ui@0.18.1`).

#### Files to edit
- `packages/theo/package.json` — peer range → `^0.14.0 || ^0.18.0`.
- `packages/create-theokit/templates/**` + `fixtures/**` — IF `sync:templates` propagates the peer (run `pnpm sync:templates`; re-stage).

#### Deep file dependency analysis
The peer is consumed by apps + the `@theokit/http` peer chain. Widening is additive. `sync:templates` keeps template manifests aligned (the theokit pre-commit `check:templates` gate enforces this).

#### TDD
```
test_ui_peer_accepts_0_18 — a dry-run resolution of theokit@<next> + @theokit/ui@0.18.1 succeeds (no ERESOLVE). RED today (ERESOLVE).
test_ui_peer_still_accepts_0_14 — resolution with @theokit/ui@0.14.x still succeeds (no regression for existing consumers).
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Manifest range change; no runtime code, no async.

#### Acceptance Criteria
- `npm install theokit@<next> @theokit/ui@0.18.1` resolves with NO ERESOLVE.
- `@theokit/ui@0.14.x` still resolves (no regression).
- `pnpm install --frozen-lockfile` (theokit) clean after the change + `sync:templates`.

#### DoD
- peer range widened; templates synced; resolution validated both lines; changeset `theokit` (minor — widened peer surface).

## Coverage Matrix

| Requirement (Goal) | Task(s) |
|---|---|
| theocode adopts @theokit/ui@0.18.x without --force (no ERESOLVE) | T2.1 |
| eliminate valibot HIGH (GHSA-vqpr-j7v3-hqw9) | T1.1 |
| theme schema still parses (no regression from valibot major) | T1.1 |
| existing 0.14.x consumers unaffected | T2.1 |
| loop: theocode resolves + audit clean | Phase 3 |

100% — every Goal requirement maps to ≥ 1 task.

## Failure scenarios (when I/O external)

(none — no external I/O touched at runtime. valibot parsing is pure/synchronous; the changes are dependency manifests + a synchronous schema. The npm-registry resolution is a build-time concern validated by the install/audit gates, not a runtime failure path.)

## Global Definition of Done

- [ ] theo-ui: valibot `^1.4.1`; schema tests green; audit no valibot HIGH; typecheck/lint clean.
- [ ] theokit: peer `^0.14.0 || ^0.18.0`; `sync:templates` applied; `--frozen-lockfile` clean; resolution validated (0.18.x + 0.14.x).
- [ ] CHANGELOG `[Unreleased]` updated in BOTH repos.
- [ ] changeset: `@theokit/ui` (patch/minor — security) + `theokit` (minor — peer widen).

## Final Phase: Integration Validation (MANDATORY)

### Execution
- theo-ui: `pnpm test` (theme schema) + `npm audit` (0 valibot HIGH) + typecheck.
- theokit: dry-run `npm install theokit@<next> @theokit/ui@0.18.1` (no ERESOLVE) + `@theokit/ui@0.14.x` (still ok) + `pnpm install --frozen-lockfile`.
- Loop proof: a temp install of the next theokit + @theokit/ui@0.18.x + `npm audit` → resolves clean, 0 valibot HIGH.

### Acceptance Criteria
- ERESOLVE gone for 0.18.x; 0.14.x still resolves; valibot HIGH gone; schema tests green.

### If Validation Fails
Return to the failing task; do NOT emit `IMPLEMENTATION_COMPLETE` until both the resolution + the audit pass.
