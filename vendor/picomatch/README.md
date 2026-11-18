# picomatch 4.0.7 with the fix for GHSA-fc5q-39xc-vjpf

This is [picomatch](https://github.com/micromatch/picomatch) at tag `4.0.7` with one change, the fix
proposed upstream in [micromatch/picomatch#266](https://github.com/micromatch/picomatch/pull/266)
(commit `cad55d0`). The root `package.json` points every `picomatch` from 4.0.0 to 4.0.7 in this
repository at this copy (`pnpm.overrides`).

## Why

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (high): a repeated extglob
with one branch, such as `+(*a)` or `*(*a)`, compiles to a regular expression that backtracks
exponentially. Every release up to 4.0.7 is affected and none is fixed. `vite`, `vitest`,
`tinyglobby`, `fdir` and `packages/theo` itself depend on the 4.x line, so the production audit in CI
(`pnpm audit --prod --audit-level=high`) was red with no version to move to.

The patch adds `classifyWildcardStarBranch` to `lib/parse.js`: a single-branch repeated extglob whose
body ends in `*` is either compiled as `@(...)`, which matches the same strings, or treated as a
literal when it cannot be. `isMatch` against 29-character inputs that do not match, one run each:

| Pattern  | 4.0.7  | This copy |
| -------- | ------ | --------- |
| `+(*a)`  | 89 s   | 23 ms     |
| `*(*a)`  | 83 s   | 7.7 ms    |
| `+(*)`   | 285 s  | 0.8 ms    |

Upstream's own suite passes here: 1,988 tests, against 1,983 on 4.0.7 (the five new ones come with the
patch, as `test/options.maxExtglobRecursion.js` upstream). `packages/theo/tests/route-rules-extglob.test.ts`
fails on 4.0.7 and passes on this copy.

## What it does not cover

- Only this repository. A project that installs a published `@theokit/*` package still resolves
  `picomatch` from the registry, and gets 4.0.7 until upstream releases a fix.
- `picomatch@2.3.2`, which `micromatch` and `anymatch` bring in. It sits outside the production tree,
  so it does not fail the production audit, and its 2.x API differs from 4.x, so this copy cannot
  replace it.

## When it goes

When picomatch publishes a release with the fix: delete this directory, the override and the two
ignore entries (`eslint.config.js`, `.prettierignore`), and require that version instead. Tracked in
usetheokit/theokit#2165.

The code is MIT, Copyright (c) 2017-present, Jon Schlinkert. See `LICENSE`.
