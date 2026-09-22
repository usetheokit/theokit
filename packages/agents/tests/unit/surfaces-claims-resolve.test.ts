import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * B-181 — the README's surfaces table claims things, and a claim is what drifts.
 *
 * `README.md § Foreign configuration surfaces` is the copy that travels: `.claude/rules/` is
 * gitignored, so nothing written there reaches anyone who installs this package. The table's own
 * rule is that a surface is either READ or REFUSED WITH A REASON, never accepted and ignored — and
 * its anti-pattern list records the sharper failure by name:
 *
 *   "Claiming a surface is read when a function merely exists to read it. Worse than either half
 *    of the rule above: an author checks the claim before writing the key, so the claim IS the
 *    control."
 *
 * That happened, to `agent-memory/`: the reader was real, the route was refused one package over,
 * and the table said `read` for three days.
 *
 * ## What this checks, and what it deliberately does not
 *
 * It does NOT generate the verdict column. That column carries judgement a compiler cannot supply —
 * `read when the dialect is declared`, `parsed, not applied`, `out of scope HERE`. The
 * `capability-map` generator pattern works because its oracle is the compiler enumerating exports,
 * and no compiler answers "is this surface in scope for this package".
 *
 * What it checks is the EVIDENCE BEHIND a verdict. A row claiming `read` names a reader; that
 * reader either resolves in the source with a caller outside its own tests, or the claim is
 * unsupported. Verifying the claim is a different job from generating it, and it is the one that
 * can actually be done.
 *
 * ## Why a caller and not just a definition
 *
 * A function that exists and nobody calls reads nothing. That distinction is the entire finding
 * this test exists to keep from recurring.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const readme = join(repoRoot, 'packages', 'agents', 'README.md')

/** One row of the surfaces table: the surface, and what the README says about it. */
interface SurfaceRow {
  readonly surface: string
  readonly verdict: string
}

function surfaceRows(): SurfaceRow[] {
  const text = readFileSync(readme, 'utf8')
  const section = /^## Foreign configuration surfaces$([\s\S]*?)^## /m.exec(text)
  if (section === null) return []
  return [...section[1].matchAll(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)]
    .map((m) => ({ surface: m[1] ?? '', verdict: m[2] ?? '' }))
    .filter((r) => !/^-+$/.test(r.surface) && r.surface !== 'Surface')
}

/**
 * A verdict CLAIMS the surface is read when it says so and does not withdraw it in the same breath.
 *
 * `parsed, not applied` and `out of scope HERE` both contain the word, and both are refusals. The
 * negations are listed rather than inferred, because a regex that guesses at English would fail
 * open — and failing open here means the check passes on exactly the row it was written for.
 */
function claimsRead(verdict: string): boolean {
  const lowered = verdict.toLowerCase()
  if (!/\bread\b/.test(lowered)) return false
  const withdrawals = [
    'not applied',
    'out of scope',
    'refused',
    'read by the consumer',
    'read neither',
  ]
  return !withdrawals.some((w) => lowered.includes(w))
}

/** Every backticked identifier in the verdict — the reader the row names, when it names one. */
function namedReaders(verdict: string): string[] {
  return [...verdict.matchAll(/`([A-Za-z_$][\w$]*)`/g)]
    .map((m) => m[1] ?? '')
    .filter((id) => id.length > 2)
}

/** Files that mention a symbol, from git's own index so nothing untracked can satisfy a claim. */
function tracked(symbol: string): string[] {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- reads the local index only
    const out = execFileSync('git', ['grep', '-l', '-w', '--', symbol, '--', '*.ts', '*.tsx'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return out.split('\n').filter(Boolean)
  } catch {
    // `git grep` exits 1 when nothing matches, which is an answer and not a failure.
    return []
  }
}

const isTest = (path: string): boolean => /(^|\/)tests?\//.test(path) || /\.test\.tsx?$/.test(path)

describe('every surface the README claims is read names a reader that resolves (B-181)', () => {
  const rows = surfaceRows()

  it('test_the_table_was_found_and_is_not_empty', () => {
    // Guards the check itself. A regex that stops matching would make every assertion below pass
    // over an empty list — a green run that measured nothing, which is the shape this whole file
    // exists to refuse.
    expect(rows.length, 'the surfaces table was not found in README.md').toBeGreaterThan(8)
  })

  const claiming = rows.filter((r) => claimsRead(r.verdict))

  it('test_at_least_one_row_claims_read', () => {
    expect(
      claiming.length,
      'no row claims `read` — the parser or the table changed',
    ).toBeGreaterThan(2)
  })

  for (const row of claiming) {
    const readers = namedReaders(row.verdict)
    if (readers.length === 0) continue

    it(`test_${row.surface.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}_names_a_reader_with_a_caller`, () => {
      const resolved = readers.filter((symbol) => {
        const files = tracked(symbol)
        // Defined somewhere, AND mentioned in at least one file that is not a test. A function
        // nobody calls outside its own tests reads nothing, which is precisely the drift this
        // package's README recorded against `agent-memory/`.
        return files.length > 0 && files.some((f) => !isTest(f))
      })

      const named = readers.map((r) => '`' + r + '`').join(', ')
      expect(
        resolved.length,
        `${row.surface} claims it is read and names ${named}, but none of them resolves to a ` +
          `tracked non-test file. Either the reader was renamed and the claim is now false, or ` +
          `the claim was never true.`,
      ).toBeGreaterThan(0)
    })
  }
})
