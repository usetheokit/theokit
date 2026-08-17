# Contributing to TheoKit

Thanks for your interest in TheoKit. This document is the short, runnable
contract between you and the codebase: what to install, what to test
before opening a PR, and what shape contributions should take.

If you're upgrading an existing TheoKit app from 0.2.x to 0.3.0, see the migration
guides under [`wiki/migration/`](wiki/migration/) — the `0.2-to-0.3` guide referenced
here is **not present in the repo** (verified 2026-08-06). This guide is for changes to
the framework itself.

## Quick start

```bash
git clone https://github.com/usetheodev/theokit.git
cd theokit
pnpm install
pnpm try:scaffold        # generates examples/onda1-hello-theo
pnpm --filter onda1-hello-theo dev
```

If `pnpm try:scaffold` fails, you're missing a dependency or your Node
version is too old. TheoKit targets Node 20+.

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

The release engineer is the only person who runs `npm publish`. If your
PR needs a new release to be visible to users, mention that in the PR
description; the maintainer will queue the publish.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to abide by its terms.

## Security

Security vulnerabilities go through the process in [SECURITY.md](SECURITY.md),
NOT a public issue. Please respect the disclosure flow.
