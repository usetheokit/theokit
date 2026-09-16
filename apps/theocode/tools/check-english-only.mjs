#!/usr/bin/env node
/**
 * B-052 / B-058 — fail when Portuguese re-enters the source.
 *
 * The project rule is that everything WRITTEN in the repository is English; only the conversation is
 * Portuguese. This guard enforces it on `packages/**` sources.
 *
 * ## Why this file was rewritten
 *
 * The first version paired an accent regex with a CLOSED LIST of Portuguese words. Its own docstring
 * admitted the gap — "detector 2 is a denylist, not a language model" — and the gap was then measured
 * FOUR times: the list was extended after `ResultadoDFS`/`pilha`, after `mais antiga(s)`, after
 * `loginComMetodo`, and it still reported CLEAN while 70 Portuguese identifiers remained in
 * `packages/agent` (`THREAD_PADRAO`, `varrerMarkdownComGuardas`, `SEGMENTOS_RESERVADOS`, …).
 *
 * A denylist can only find words someone already thought of, so every new Portuguese identifier is
 * invisible by construction and each extension buys exactly one word. The failure mode is silent:
 * it reports success. This version inverts it — a word is flagged when it is in a PORTUGUESE
 * dictionary and absent from an ENGLISH one, so the unforeseen case is the one that fires.
 *
 * ## Method
 *
 * Lexicon-based language identification against dictionaries already installed on the system
 * (`/usr/share/dict`, `/usr/share/hunspell`) — no new dependency, per the parsimony ladder's
 * "reuse what is installed" rung. Portuguese entries are also indexed with accents stripped (NFD,
 * combining marks dropped) because source code writes `selecao` where the dictionary has `seleção`.
 *
 * Identifiers are split on camelCase / snake_case / SCREAMING_SNAKE and each part >= 3 chars is
 * classified. Strings and comments are stripped before the identifier scan and checked separately by
 * the accent detector, which needs no dictionary and has near-zero false positives.
 *
 * The lexicons and the seven detectors live in `english-only-detectors.mjs` — split out when this
 * file crossed 700 lines with the highest churn in `tools/`. This entry keeps the walker, the
 * allowlist, the CLI reporting, and re-exports the detection surface its test suite locks.
 *
 * ## Honest limits
 *
 *   - It flags what is Portuguese-and-not-English. A word in NEITHER dictionary (`cwd`, `pty`, `dfs`)
 *     is not flagged — abbreviations are legitimate, and flagging them would make the check one people
 *     delete. An invented Portuguese-looking token can therefore still pass.
 *   - A handful of English technical abbreviations collide with real Portuguese words (`cli` = to
 *     click, `pre` = a prefix, `repo` = cabbage, `uri` = urine). They are listed in TECHNICAL in the
 *     detectors module; that list is a genuine denylist, but a bounded and auditable one — each
 *     addition weakens the check by exactly one word rather than being the sole thing keeping it
 *     working.
 *   - Without the dictionaries installed the lexicon detector cannot run. It says so and exits 1
 *     rather than reporting clean, because a guard that passes when it cannot check is the failure
 *     this rewrite exists to remove.
 *
 * ## SYSTEM DEPENDENCY, declared here because this is the file that has it (B-073)
 *
 * This tool needs a Portuguese word list on the machine that runs it. That is a real dependency of
 * the repository and it was never written down anywhere — it lived only in an `apt-get install`
 * line inside a CI step, which is how a lint gate ended up able to fail because a Debian mirror was
 * unreachable.
 *
 *   English  ALREADY PRESENT on the CI image. Measured 2026-08-19 on `ubuntu-24.04`:
 *            `/usr/share/hunspell/en_US.dic` ships with it, and LEXICONS.en accepts that path. So
 *            `wamerican` was being installed for nothing — half the download and half the surface
 *            that can stall, bought with no benefit.
 *   Portuguese  GENUINELY ABSENT. `wbrazilian` is the only package actually needed.
 *
 * To run this locally on Debian/Ubuntu: `sudo apt-get install wbrazilian`. On other systems, put
 * any Portuguese word list at one of the LEXICONS.pt paths in the detectors module — the format is
 * one word per line, or hunspell's `word/FLAGS`.
 *
 * NOT VENDORED, and the reason is a decision rather than an omission: `wbrazilian` is not
 * public-domain the way the SCOWL-derived English lists are, so shipping a copy is a licensing
 * question this file cannot answer on its own. Until someone answers it, the dependency is
 * declared rather than hidden — which is the difference between a known cost and a surprise.
 *
 * Usage: node tools/check-english-only.mjs [--quiet] [--list-unknown]
 * Exit 0 when clean, 1 when a violation is found or the lexicons are unavailable.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  LEXICONS,
  detectLine,
  lexiconReport,
  portugueseWordsInFilename,
} from './english-only-detectors.mjs'

// The detection surface, re-exported so the paired test suite (and any other caller) keeps one
// import point. The implementations live in `english-only-detectors.mjs`.
export {
  isPortuguese,
  portugueseConstruction,
  portugueseIdentifierPair,
  portugueseInComments,
  portugueseWordsInFilename,
  wordParts,
} from './english-only-detectors.mjs'

const ROOT = process.cwd()
const SCAN = ['packages', 'tools']
/**
 * B-065 — `.mts` and `.cts` are here because their absence hid real violations.
 *
 * `theokit/packages/agents/scripts/generate-reexports.mts` exported `SUBPATHS_DE_INFRA` and
 * `enumerarSuperficieDaCamada`, and every run of this detector reported the repository as having
 * nothing there. A manual grep found them. A guard's silence is only evidence when you know what
 * it looks at, so the list is exported and locked by a test rather than left inline.
 */
export const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs'])

/**
 * Files the scan skips, each for a reason that would otherwise make the check fire on correct
 * content.
 *
 * This guard and its tests NAME the language they detect — `KNOWN_PORTUGUESE` is a list of
 * Portuguese words, and the tests assert on `indice` and `padrao` by design. A detector that flags
 * its own vocabulary is unusable. The detectors module carries those lists now, so it is exempt
 * for the same reason the checker itself always was.
 *
 * `docs/` is not in SCAN for the same reason and is worth stating: a review reporting that
 * `THREAD_PADRAO` shipped has to write `THREAD_PADRAO`. Documentation about the removal necessarily
 * quotes what was removed.
 */
const SELF = new Set([
  'tools/check-english-only.mjs',
  'tools/check-english-only.test.mjs',
  'tools/english-only-detectors.mjs',
])

/** `path:line` allowances — keyed by line so one cannot silently widen to a whole file. */
const ALLOWED = new Set([
  // A regression test asserting an error message carries no Portuguese. The accented characters ARE
  // the subject: the assertion is that the message contains none of them.
  //
  // The line moved from 76 to 156 when the ask module was migrated to `@theokit/agents/ask` and this
  // file was rewritten, and from 156 to 166 when the dead-export cleanup added a static import at
  // the top of that file. A line-numbered allowlist entry is a citation that rots on any edit above
  // it — twice now it has silently stopped covering anything and turned the check red. It is kept
  // line-numbered on purpose (an entry keyed by file alone would exempt the whole file), so the
  // cost is real and accepted: whoever edits above line 166 fixes this number in the same commit.
  // THIRD ROT, 2026-08-20: 166 -> 160, this time because `prettier` reformatted the file. Nobody
  // edited it — the repository's own formatter did, and there is no `prettier --check` job in CI to
  // have caught the drift at its source. The comment above predicted "whoever edits above line 166
  // fixes this number in the same commit"; the editor turned out to be a tool, which fixes nothing.
  //
  // Kept line-numbered anyway, and that stays the right call: an entry keyed by file alone would
  // exempt every future accented line in this file, and the whole point is that the accents here are
  // the SUBJECT of an assertion rather than prose. The cost of the citation rotting is smaller than
  // the cost of the exemption widening.
  //
  // It rotted on 2026-09-09 by a cause that paragraph did not anticipate: B-162 moved every test
  // out of `src/` into a per-package `tests/` mirror, so the PATH changed while the line did not.
  // A line-anchored exemption survives an edit above it badly and a relocation not at all. Still
  // the right trade — the alternative exempts every future accented line in this file — but the
  // failure mode is a repository-wide move, not only an editor.
  'packages/agent/tests/ask/ask-bridge.test.ts:160',
])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (EXTS.has(extname(p))) yield p
  }
}

/** Scan one file: its NAME first, then every line through the detector table. */
function scanFile(file, rel, violations, onUnknown) {
  // The file's own NAME runs before contents because a Portuguese path is a violation even in an
  // otherwise clean file.
  for (const w of portugueseWordsInFilename(rel)) {
    violations.push({ at: rel, why: `Portuguese word "${w}" in filename`, text: rel })
  }

  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const at = `${rel}:${i + 1}`
      if (ALLOWED.has(at)) return
      const hit = detectLine(line, onUnknown)
      if (hit !== null) {
        violations.push({ at, why: hit.why, text: line.trim().slice(0, 100) })
      }
    })
}

/**
 * CLI entry. Guarded so the module can be imported by its own test suite: before this, importing
 * it ran the whole scan and called `process.exit(1)`, which is why the guard had no tests.
 *
 * The lexicon check lives HERE, not at module scope: for a while the detectors' import itself
 * called `process.exit(1)` on a machine without the dictionaries, terminating the very test
 * process the import guard exists to protect. Exiting 1 rather than reporting clean is still the
 * contract — a guard that passes when it cannot check is worse than no guard, because it is
 * believed — but the exit now fires in the frame that owns exiting.
 */
function main() {
  const lexicons = lexiconReport()
  if (lexicons.enLoaded === 0 || lexicons.ptLoaded === 0) {
    console.error(
      'english-only: CANNOT CHECK — no system word lists found.\n' +
        `  english sources tried: ${LEXICONS.en.join(', ')}\n` +
        `  portuguese sources tried: ${LEXICONS.pt.join(', ')}\n` +
        '  install with: sudo apt-get install wamerican wbrazilian hunspell-pt-br\n' +
        'Exiting 1 rather than reporting clean: a guard that passes when it cannot check is worse\n' +
        'than no guard, because it is believed.',
    )
    process.exit(1)
  }

  const violations = []
  const unknown = new Map()
  const onUnknown = (w) => unknown.set(w, (unknown.get(w) ?? 0) + 1)

  for (const base of SCAN) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue
    for (const file of walk(dir)) {
      const rel = relative(ROOT, file)
      if (SELF.has(rel)) continue
      scanFile(file, rel, violations, onUnknown)
    }
  }

  if (process.argv.includes('--list-unknown')) {
    // Neither-lexicon words. Mostly legitimate abbreviations, and the one place an invented
    // Portuguese-looking token could hide — printed on demand so a human can sweep it.
    console.error(`\nwords in neither lexicon (${String(unknown.size)}):`)
    for (const [w, n] of [...unknown].sort((a, b) => b[1] - a[1]))
      console.error(`  ${w} (${String(n)})`)
  }

  if (violations.length === 0) {
    if (!process.argv.includes('--quiet')) {
      console.log(
        // The two numbers are the LEXICON SIZES, printed as a non-vacuity floor: a clean result
        // over dictionaries that failed to load is the same output as a clean repository. Said as
        // "loaded" because the earlier wording — `484091 PT forms` beside the word `clean` — reads
        // as 484 091 Portuguese words FOUND, which is the opposite of what the line reports.
        `english-only: clean (lexicons loaded: ${String(lexicons.enForms)} EN, ${String(lexicons.ptForms)} PT forms)`,
      )
    }
    process.exit(0)
  }

  console.error(`english-only: ${String(violations.length)} violation(s)\n`)
  for (const v of violations) console.error(`  ${v.at}  (${v.why})\n    ${v.text}`)
  console.error(
    '\nEverything written in this repository is English; only the conversation is Portuguese.\n' +
      'If a match is a false positive, add its `path:line` to ALLOWED in this file with a reason,\n' +
      'or — when an English technical term collides with a Portuguese word — add it to TECHNICAL\n' +
      'in tools/english-only-detectors.mjs.',
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
