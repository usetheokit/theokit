# Changelog

All notable changes to this product are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/).

**Work done in an upstream repository is named as such.** This product is assembled from
`@theokit/*` packages, and some entries will record a change that landed in `theokit-gateways`,
`theokit-sdk` or the framework packages rather than here. Those carry the repository name.

## [Unreleased]

### Fixed

- The declared build produced nothing. `package.json` declares `build: tsc -p tsconfig.json` and
  `tsconfig.json` sets `outDir: ./dist` and `declaration: true`, but `noEmit: true` is inherited
  from the root config and was never overridden — so the command exited 0 and created no `dist/`.
  Found by the phase-2 quality evaluator, which failed the phase at 0.55 rather than accept it.

- The composition root could not build the one thing it exists to build. `withAgent` resolved
  through the SYNCHRONOUS `container.resolve` while the declared factory type accepts a Promise —
  and `Agent.create`, the canonical agent factory, is async. Every real consumer would have got
  `AsyncProviderInSyncResolveError` instead of an agent. Three reviewers reached it independently by
  execution; both shipped tests used a synchronous factory, so neither tsc nor the suite could see
  it. One word: `resolveAsync`.
- Two dependency declarations that nothing on disk satisfied. `@theokit/sdk` was declared `^5.9.1`
  against a lockfile pinned to 5.9.0, and `dependency-cruiser` was declared `^16.0.0` and never
  installed — the binary that actually ran the boundary gate was the root's 17.4.3. A reviewer
  measured `pnpm install --frozen-lockfile` failing with `ERR_PNPM_OUTDATED_LOCKFILE`, which is
  CI's default here. The lockfile now resolves 5.9.1, and the redundant declaration is gone rather
  than corrected: the root already declares and installs the tool, so adding a second one was the
  parsimony violation. Under the declared major it was also worse than redundant — `16.10.4` cruises
  `0 modules, 0 dependencies` on this tree and exits 0, which is the vacuous gate the config's own
  docblock exists to prevent.

### Added

- Three tests for what the first round could not see: an async factory (RED before the fix above),
  the typed `ScopeViolationError` refusal this module's docblock rests on, and one boundary sharing
  one agent across two resolves — the behaviour that separates REQUEST from TRANSIENT, which a
  reviewer showed the original suite could not distinguish.

- A typecheck that actually reads the tests (`tsconfig.test.json`). The existing `tsconfig.json`
  excludes `tests/`, so `tsc --noEmit` resolved zero test files and a fabricated method call passed
  it silently — a reviewer found it. The new config was proven to arm before being committed.
- Architecture boundaries for this application (`.dependency-cruiser.cjs`): production must not
  import tests, and nothing may import the composition root but an entry point. The first was
  proven to fire by a deliberate violation. The second could not be: `src/` holds one file and the
  rule's own lookahead excludes it, so its source set is empty today. A reviewer measured that and
  a second confirmed it — the sentence that stood here claimed both, and only the commit message
  was accurate.
- A third test pinning the composition root's surface to exactly one key, which is what makes
  "no caller can resolve outside a request" true by construction rather than by a guard.

- The composition root (`src/composition.ts`) — the first code in this application. It exposes a
  request BOUNDARY rather than a resolve, because the container refuses a REQUEST-scoped resolve
  outside one with a typed error, and a boundary opened per resolve would make "one agent per
  request" mean "one agent per call" (B-004).
- The application's TypeScript and test configuration, and its four runtime dependencies. They are
  installed from the registry rather than linked: `theokit-di` is a sibling repository outside this
  workspace, and `pnpm-workspace.yaml` states the rule for exactly that case.

- The maintenance registry: `BACKLOG.md`, created after `cycle-brainstorm` returned
  `PRODUCT_ALIGNED`. Honestly empty — the ten technical pieces are what the product is made of,
  not work somebody filed, and seeding them would manufacture items with no `why_now` and no
  owner. Routing resolves for two domains (`theoclaw`, `theokit`) with the specialist on disk.

- Ten registered items, B-001 to B-010 — seven for the pieces the signed cascade committed and
  has not started, three for rows OBJ-6 declares unmeasured. Each carries a `why_now` naming what
  changed here (the signature, the all-ten platform decision, a delivered sibling piece), a
  verifiable DoD, and `blocked_by` where a decision or another repository is genuinely in the way.
  No item was derived from a piece alone.

- The product scope exists: `apps/theoclaw`, a workspace member under the monorepo's root
  toolchain. Nothing is implemented yet — this entry records the scope root that
  `cycle-brainstorm` requires before a product vision can be written (Unbreakable Rule 6).
- The four product documents, written from an interview rather than derived: what TheoClaw is
  and is explicitly not, five objectives each carrying a metric and a horizon, seven
  requirements each serving an objective, and eight technical pieces each realising a
  requirement. `.squad/wiki/product/`. Unsigned — the alignment gate scores 100% of what a
  script can check and refuses to sign the part it cannot.
