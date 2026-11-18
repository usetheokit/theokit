# Public-surface gate in CI

`scripts/check-public-surface.mjs` (run as `pnpm check:public-surface`) compares the exported
declarations of `@theokit/agents` with the committed `packages/agents/public-surface-baseline.json`
and with the baseline at the PR base. Removing, renaming, demoting or changing a stable export
fails unless a changeset in `<base>...HEAD` declares the package `major`.

## CI setup

Run it in the `typecheck-build` job, right after `pnpm build:packages` (it reads `dist/*.d.ts`):

```yaml
- uses: actions/checkout@...
  with:
    fetch-depth: 0 # the gate reads the baseline and changesets at the PR base
- run: pnpm build:packages
- run: node scripts/check-public-surface.mjs @theokit/agents --base "origin/${{ github.base_ref || 'main' }}"
```

A shallow checkout cannot resolve `<base>`; the gate then exits 2 (could not run), never a pass.
Exit codes: 0 pass, 1 violation or baseline drift, 2 the check could not run.

After an intended change to a stable export, regenerate the baseline with
`node scripts/check-public-surface.mjs @theokit/agents --write` (after `pnpm build:packages`).

> Status: the workflow step is not yet in `.github/workflows/ci.yml`; that file was out of
> reach for the change that added the gate, so it needs the snippet above.
