# ADR 0004 — The terminal is a separate package

- **Status:** Proposed (2026-08-25) — requires the project owner's acceptance
- **Date:** 2026-08-25
- **Deciders:** requires the project owner's acceptance
- **Blocks:** usetheokit/theokit#460; the fourth benchmark metric (time to first green run)

## Context

`@theokit/agents` declares `@theokit/sdk-pty` as a hard `dependency`, and that package declares
`"install": "node scripts/prebuild.js || node-gyp rebuild"` — a native step that downloads a
prebuild or falls back to a C++ compile. Every consumer of `@theokit/agents` pays it, including
every web application that will never open a terminal.

Measured 2026-08-20 and recorded in `packages/agents/src/pty-entry.ts`:

| | with `sdk-pty` | without |
| --- | --- | --- |
| `@theokit/agents` install, alone | **6.7 s** | **1.4 s** |

In a scaffolded app the difference lands on the benchmark's fourth metric:

| | |
| --- | --- |
| TheoKit | **30.40 ± 7.50 s** |
| Next.js | **14.93 ± 0.91 s** |

with our build faster and our dependency tree smaller. It is what retracted the J9 result.

### Why the obvious fix was tried and reverted

Moving it to an optional peer was attempted on 2026-08-20 and reverted.
`packages/agents/tests/unit/dependency-direction.test.ts` refuses it for a reason that survives the
measurement: a peer means *the host provides it*, while the M63 boundary gate forbids the host from
importing `@theokit/sdk*` at all. Asking a consumer to declare a package it may not import is the
inversion M79 fixed.

So two rules conflict and neither is wrong:

- an implementation the consumer cannot import must not be a peer;
- an application should not compile a terminal it will never open.

## Decision

Move the `./pty` subpath into its own package, which owns `@theokit/sdk-pty` as its dependency.
`@theokit/agents` keeps a zero-native install; a consumer that wants a terminal adds one package and
imports it directly.

### Why this shape resolves the conflict rather than relocating it

The peer attempt failed because it asked the host to declare something it may not import. This asks
the host to declare something it **does** import — an ordinary dependency on an ordinary package,
with no inversion and no exemption from either gate.

### What the split costs, measured rather than estimated

The surface is small and bounded, which is the fact that makes this proposable at all:

- **one** file imports `@theokit/sdk-pty` inside `@theokit/agents`: `src/pty-entry.ts`, 46 lines
- **one** subpath exposes it: `./pty`, one of twenty
- **six** symbols cross the boundary: `clampYield`, `MaxSessionsError`, `PtyInteractiveBackend`,
  `YIELD_MAX_MS`, `YIELD_MIN_MS`, and the type `PtyInteractiveBackendOptions`
- the entry is a **pure re-export** — no wrapper, no adaptation, nothing to port

A consumer's migration is one import line and one dependency.

## Consequences

**Breaking**, and for a named set: anyone importing `@theokit/agents/pty`. The change is mechanical
(`@theokit/agents/pty` → the new package) and `tests/unit/subpath-surface.test.ts` already pins the
six symbols, so the parity claim is checkable rather than asserted.

**Everyone else installs 5.3 s faster** and stops compiling a terminal they never open.

`@theokit/agents` returns to a dependency set with no native build step, which is the property the
M79 inversion was fixed to restore.

### What this does NOT decide

The new package's **name**, and whether it lives in this repository or beside `@theokit/sdk-pty`.
Both are the owner's call and neither changes the argument above.

## Alternatives considered

**Optional peer dependency.** Tried on 2026-08-20, reverted the same day. Rejected because it
requires the consumer to declare a package the boundary gate forbids it to import — the inversion
M79 removed. Recorded here so it is not attempted a third time.

**Lazy `import()` inside `pty-entry.ts`.** Rejected: the install cost is paid by `npm install`
resolving the dependency graph, not by module evaluation. Deferring the import defers nothing that
is being measured, and it would trade a static surface `tsc` checks for a dynamic one it cannot.

**Leave it and document the cost.** Rejected, and this is the weakest-looking option worth naming
explicitly: the cost is paid by every consumer at the moment they are deciding whether to keep
using the framework, and a note in a README is read after that decision. It is also the option the
project has been on since M58, which is how it reached a benchmark retraction.

**Make `sdk-pty` install without a native step.** Out of scope here — it is a different repository's
decision, and it would fix the symptom for one dependency while leaving `@theokit/agents` shaped so
the next native dependency reproduces it.

## Provenance

Filed as usetheokit/theokit#460; tracked internally as `B-025`. The measurements and the reverted
attempt were already recorded in `packages/agents/src/pty-entry.ts`; this ADR adds the surface
measurement (one file, one subpath, six symbols) that turns "most likely a separate package" into a
proposal with a known cost.
