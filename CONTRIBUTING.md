# Contributing to TheoKit

Thanks for your interest in TheoKit. This document is the short, runnable
contract between you and the codebase: what to install, what to test
before opening a PR, and what shape contributions should take.

If you're upgrading an existing TheoKit app across versions, the breaking changes and
their replacements are recorded in [`CHANGELOG.md`](CHANGELOG.md). This guide is for
changes to the framework itself.

## Quick start

```bash
git clone https://github.com/usetheokit/theokit.git
cd theokit
pnpm install
pnpm try:scaffold        # scaffolds a throwaway app into my-test/
cd my-test && pnpm dev
```

If `pnpm try:scaffold` fails, you're missing a dependency or your Node
version is too old. Every manifest declares `engines.node >= 22.12.0`, and the
CLI refuses to run below it rather than failing later in an unrelated place.

## Local testing — before every PR

These commands are the gate. CI runs the same ones; if they pass locally,
your PR is likely to pass in CI.

```bash
# 1. Unit + integration tests
pnpm test

# 2. Type check
pnpm typecheck

# 3. Lint + format
pnpm lint
pnpm format:check

# 4. Dead code
pnpm knip
```

There is no browser suite: the project ships no end-to-end harness, so a
change to rendering or hydration needs a reviewer to exercise it by hand.

### Which `@theokit/sdk` are you actually reading?

`theokit` supports two SDK majors (`^4.52.1 || ^5.0.0`), and a pnpm store routinely holds both at
once — one because the lockfile resolves it, another left by a `pnpm.overrides` entry someone used
to test the other half of the range. The symlink decides which one your editor, your grep and your
tests see, and it changes under you without saying so.

Before concluding anything from a search under `node_modules`, name the object:

```bash
L=$(readlink -f node_modules/@theokit/sdk) \
  && node -e "console.log(require('$L/package.json').version)"
```

This is not hypothetical. A 5.x-only type was searched for, found zero times, and reported as
"absent from the installed 5.0.1" — while the link pointed at 4.52.1. The grep was correct; it
answered about a different package than the one the sentence named.

"Verify against the artifact, not the indicator" presumes there is ONE artifact. Two trees, one
name, on one machine is the case where that rule fails silently.

## How to add a feature

1. Open an issue (or comment on an existing one). Confirm scope before
   investing time.
2. Branch off `develop` (NOT `main`). Branch name: `feat/<short-slug>`.
3. Write a failing test first. Yes — even when you "know" how it'll
   work. The TDD cycle is mandatory.
4. Implement the minimum code to make the test pass.
5. Refactor for clarity; the tests stay green.
6. Update CHANGELOG.md under `[Unreleased]`. Use the
   [Keep a Changelog](https://keepachangelog.com/) categories
   (Added / Changed / Deprecated / Removed / Fixed / Security).
7. Run the gate above.
8. Open the PR. Fill in the template.

## How to test a primitive end-to-end

A test that needs a whole app builds it in a temp directory and tears it down
afterwards — see `tests/unit/wave0-mandatory.test.ts` for the shape. Do not add
a checked-in demo app: one grows stale the moment the primitive it exercises
changes, and every consumer of it has to be updated in lockstep.

A primitive that genuinely cannot be exercised without a running dev server has
no automated coverage today. Say so in the PR rather than asserting something
weaker and calling it covered.

## Where a fixture's shape comes from

A fixture invented alongside the code it tests cannot disagree with it. Both carry the same
assumption, the test passes, and the assumption is never checked against anything.

Measured on 2026-08-20: five occurrences in one day. Token attributes were read from a flat object
invented for the test while the code read the same invented shape — and four of the five surfaced
only because a benchmark graded the output, not because the suite failed.

**A fixture's shape must come from one of three places, and the test says which:**

| Source | Use it when | What it buys |
|---|---|---|
| the published `.d.ts` | the thing under test consumes a typed interface | a signature change breaks the mock at `tsc` time |
| the producer's own builder | the value is normally constructed by code we ship | the fixture cannot drift from the constructor |
| a recorded payload, dated | the shape belongs to something external | the drift is visible as a stale date, not as a silent pass |

**What is NOT a source: a shape typed out from memory while writing the test.** That is the case
above, and it fails silently by construction.

### Mocks that stand in for a published interface declare it

A stub written as `export const doThing = () => null` satisfies nothing. Changing the real
`doThing`'s signature leaves it compiling, and the test keeps passing against a contract that no
longer exists.

```ts
// Drifts silently.
export const resolveThing = () => null

// Breaks at `tsc` the day the signature moves.
import type { ResolveThing } from '@theokit/http'
export const resolveThing: ResolveThing = () => null
```

**Verified by `tsc`, not by review** — which is the whole reason the type is worth writing.

### What this convention does NOT check

Stated rather than implied, because a convention that claims more than it enforces is worse than
one that claims less:

- **Nothing scans for untyped stubs.** The rule above is honoured by the author and caught in
  review, not by a gate. The untyped worker stubs under `tests/unit/` predate this section and are
  the largest known exception — `tests/unit/worker-stubs-cover-the-generated-imports.test.ts` covers
  their export LIST against the generator, which is a different guarantee from covering their types.
- **A recorded payload's date is not checked against anything.** A fixture recorded two years ago
  looks identical to one recorded today.
- **"From the builder" is not mechanically distinguishable** from a hand-written value that happens
  to match. The declaration is a statement by the author.

## Branch + commit conventions

- **Branches**: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `refactor/<slug>`.
  Never work directly on `main`.
- **Commits**: imperative present tense, short subject (≤ 72 chars).
  The first line is the subject; an empty line follows; the body
  explains the *why* (the diff already shows the *what*).
- **No trailers**: commit bodies carry no `Co-Authored-By` lines. A local hook
  rejects them. Credit a pair in the body prose instead.
- **Squash on merge**: PRs are squashed by default. The PR title becomes
  the commit subject — write it carefully.

## How releases work

**Nobody runs `npm publish`.** Publishing happens in `.github/workflows/release.yml`
under npm trusted publishing (OIDC), so there is no token to hold and no local step
that mints one. If your PR needs a release to be visible to users, say so in the PR
description.

### The one manual step, and where it is announced

A release takes two passes through `main`, and the handoff between them is a human
click — not by oversight.

The reason it was built that way has since expired, and both halves are worth
knowing. On 2026-08-23 Actions could not open pull requests here
(`can_approve_pull_request_reviews=false`, measured across every repo and at the org
level), so `changesets/action` would have failed on the version branch and the
workflow pre-empted that. **Re-measured 2026-09-07: the flag is now `true` at both
levels.** The restriction is gone; the manual step remains, now resting only on the
second argument its author gave — that a person opening the PR is a stronger Rule 4
gate than a bot doing it.

Until that is revisited, this is the sequence:

| pass | trigger | what CI does | what a person does |
|---|---|---|---|
| 1 | `develop` → `main` merges | versions the packages, pushes `changeset-release/main`, prints a `::notice` with the compare link | open the Version Packages PR from that link |
| 2 | that PR merges | publishes to the registry | verify the versions resolve |

**The link lives in the run's annotations**, not in the PR list and not in the run's
conclusion:

```
[notice] Version Packages: Ready to review — open the PR at
         https://github.com/usetheokit/theokit/compare/main...changeset-release/main?expand=1
```

Look there after pass 1. A run that versioned is green and shows no open PR, which
reads exactly like a run that had nothing to do — the difference is the annotation.
Two releases were cut on 2026-09-07 by someone who found the branch by hand and
filed the design as a defect (#673) before reading the notice that was already
there. Reading the run's annotations is one API call; concluding from the PR list
that the run did nothing is the same "right answer, wrong object" mistake this file
warns about for `node_modules/@theokit/sdk`.

If the branch exists and no PR is open, the release is not stuck: it is waiting for
that click.

### After publishing: check the examples still teach the truth

```sh
# in the theokit-examples checkout
cd framework/agent-endpoint && npm test   # ~40s, no credential, no network
```

This boots a real `theokit dev` against local stubs and asserts what the example
*teaches* — not what the framework compiles. The suite here proves the code
works; only this proves the documentation did not rot underneath a release.

Two limits a green does not carry:

- **The example pins an exact version**, so it does not see a release until
  someone bumps it. Bump, then run — in the other order the green is about the
  previous version.
- **A failure here is usually a rotted lesson, not a broken release.** The remedy
  is normally in `theokit-examples`, not in this repository. Read the failure
  before assuming which side is wrong.

Written down rather than agreed between people: this step began as an
arrangement between two sessions, which works exactly as long as both are
around. A release cut on a quiet week would have skipped it with nothing to
say so — the failure mode is the absence of the step, not the step.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to abide by its terms.

## Security

Security vulnerabilities go through the process in [SECURITY.md](SECURITY.md),
NOT a public issue. Please respect the disclosure flow.
