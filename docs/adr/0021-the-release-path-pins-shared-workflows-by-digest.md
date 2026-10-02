# 0021: The release path pins shared-workflows by digest; every other caller rides `v1`

- Status: Accepted
- Date: 2026-10-02
- Deciders: the repository owner, closing #881

## Context

Twenty-nine `uses:` lines in `.github/workflows/` resolved `usetheokit/shared-workflows@v1`, each
with a bare `# zizmor: ignore[unpinned-uses]`. `v1` is a tag, and nothing protects it: the
repository has no ruleset, and its own CI fast-forwards `v1` onto `main` with `GITHUB_TOKEN`
(`shared-workflows/.github/workflows/ci.yml`). Anyone who can push to that repository can move
what all twenty-nine lines execute, and no diff lands here when they do.

The moving tag is deliberate, and the reason is recorded beside several of the call sites: a
policy correction in shared-workflows has to reach every caller without one pull request per
caller, which is why the repository exists. That reason holds for a lint job or a back-merge.

It does not hold for every line. The blast radius is uneven:

- `release.yml` runs `actions/npm-oidc`, the step that sets up the npm publish credential, and
  `actions/setup` in the same job, before `pnpm release` publishes to the registry.
- `release.yml` also runs `actions/release-channel`, which decides what channel a release goes
  out on.
- `ci.yml`'s dependency audit runs `actions/setup` before the gate that decides whether a
  production advisory blocks a merge. Its own comment already said the job was "SHA-pinned,
  unlike the tag references elsewhere", which was not true of that line.

A tag protection rule was considered and not adopted. The tag is moved by a workflow running on
`GITHUB_TOKEN`, so a ruleset would have to let GitHub Actions bypass it, and anyone who can push a
branch can run a workflow. That narrows almost nothing.

## Decision

The four lines above pin `usetheokit/shared-workflows` to a 40-character commit, with `# v1` as
the trailing comment, the convention the rest of this repository uses for third-party actions.
Renovate's `config:recommended` (through `github>usetheokit/.github`) proposes a digest update when
`v1` moves, so a change to what the release path runs arrives as a pull request somebody reviews.

The other twenty-five keep `@v1`. Their suppression now names this record on the same line, since
zizmor reads the comment there:

```yaml
uses: usetheokit/shared-workflows/actions/setup@v1 # zizmor: ignore[unpinned-uses] first-party moving major, ADR-0021
```

## Consequences

- A fix in shared-workflows reaches the release path one reviewed pull request later than it
  reaches everything else. That delay is what this decision buys.
- Moving `v1` no longer changes what publishes to npm or what the dependency audit runs.
- A new call site to shared-workflows has to choose: rides `v1` with the ADR-0021 suppression, or
  pins, if it handles a credential or gates a merge on supply-chain findings.
