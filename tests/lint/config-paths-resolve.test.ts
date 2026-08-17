/**
 * Lint test — every path a gate's configuration names must exist.
 *
 * ## The failure this exists to catch
 *
 * A configured path that no longer resolves does not error. It matches nothing,
 * and the rule around it reports green over an empty set. Three instances shipped
 * in this repository at the same time:
 *
 * - `.dependency-cruiser.cjs` constrained `packages/theo/src/react-query/` after
 *   that module had been absorbed into `client/`. The rule cruised zero modules.
 * - `eslint.config.js` ignored `references/**` while the study zone is
 *   `knowledge-base/references/`. Root-anchored, so the ignore never fired.
 * - `vitest.config.ts` excluded five source files from coverage by path; five had
 *   moved or been deleted, so files with no test were silently being measured
 *   against the enforced thresholds.
 *
 * None of the three failed. All three were found by reading, which is exactly the
 * property a gate is supposed to remove the need for.
 *
 * ## Why a test and not a lint rule
 *
 * The question is about the FILESYSTEM, and only a check that resolves the paths
 * can answer it. A schema validator confirms the config is well-formed; it cannot
 * know that `src/react-query/` stopped existing three milestones ago.
 *
 * @internal
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')

/**
 * A configured literal is checked only when it names a CONCRETE path — one with a
 * file extension or a trailing slash, and no glob metacharacter. A pattern like
 * `packages/*␑/src/cli/**` is a shape, and asserting that a shape "exists" would be
 * a category error; those are left to the tool that interprets them.
 */
const CONCRETE = /^[\w./@-]+(?:\.[a-z]{2,4}|\/)$/

/** Literals that look like paths but are not repository paths. */
const NOT_A_PATH = new Set(['node_modules/', 'dist/', 'coverage/'])

async function literalsIn(configRelPath: string): Promise<string[]> {
  const text = await readFile(join(REPO_ROOT, configRelPath), 'utf8')
  const out = new Set<string>()
  for (const m of text.matchAll(/'([^'\n]+)'/g)) {
    const raw = m[1]
    if (raw === undefined) continue
    if (!raw.startsWith('packages/') && !raw.startsWith('knowledge-base/')) continue
    if (raw.includes('*') || raw.includes('{')) continue
    if (!CONCRETE.test(raw) || NOT_A_PATH.has(raw)) continue
    out.add(raw)
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}

const CONFIGS = ['vitest.config.ts', '.dependency-cruiser.cjs', 'eslint.config.js']

describe('gate configuration names paths that exist', () => {
  for (const config of CONFIGS) {
    it(`${config}: every concrete path resolves`, async () => {
      const literals = await literalsIn(config)

      // Non-vacuity floor. If the extractor stops matching — a quote style changes,
      // a config is reformatted — this test would pass by examining nothing, which
      // is the same defect it exists to catch, one level up.
      expect(literals.length, `${config}: extracted no path literal to check`).toBeGreaterThan(0)

      const missing = literals.filter((p) => !existsSync(join(REPO_ROOT, p)))
      expect(missing, `${config} names paths that do not exist`).toEqual([])
    })
  }
})
