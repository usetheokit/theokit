import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * The directory holding this repository's `.claude/` kit, or `undefined` when no kit is installed.
 *
 * ## Why a search rather than a path
 *
 * The kit is installed ONCE per repository and `.claude/` is never versioned. While this package was
 * its own repository those two facts made `join(packageRoot, '.claude')` correct; moved under
 * `apps/theocode/` in a monorepo on 2026-09-16 the install sits at the monorepo root, and every
 * lookup written against the package root started reporting the kit as ABSENT while it was one level
 * up.
 *
 * That was not a quiet inconvenience: three call sites read it, and each one turned its wrong answer
 * into a SKIP. Twenty-seven tests stopped exercising the real coverage gate, and two invariants —
 * that the floor's two declarations agree, and that every declared working directory exists —
 * stopped being checked. All three announced the skip honestly; none could know the premise had
 * become false.
 *
 * Extracted on the third call site rather than the first, and the three are why: a walk copied three
 * times is three places for the next layout change to be half-fixed.
 *
 * ## What it deliberately does not do
 *
 * Throw. "No kit anywhere" is the normal state in CI — no workflow installs it, in this layout or
 * the previous one — so the callers' skips stay correct there and `undefined` is the honest answer
 * rather than an error.
 */
export function kitRoot(from = resolve('.')) {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, '.claude'))) return dir
    const up = dirname(dir)
    // The filesystem root is its own parent; stopping there is what bounds the walk.
    if (up === dir) return undefined
    dir = up
  }
}

/** A path inside the installed kit, or `undefined` when no kit is installed. */
export function kitPath(...segments) {
  const root = kitRoot()
  return root === undefined ? undefined : join(root, '.claude', ...segments)
}
