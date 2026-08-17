/**
 * Lint test — the codebase is English-only. Bans Portuguese in source and
 * tests: identifiers, comments, JSDoc and string literals alike.
 *
 * Why this is a gate and not a style preference:
 *
 * - JSDoc on an exported symbol is emitted into the published `.d.ts`, so a
 *   Portuguese comment ships to every consumer and shows up on editor hover.
 *   Those declarations are the canonical public contract; a contract nobody
 *   outside this repo can read is not a contract.
 * - A Portuguese identifier in the public surface is worse still — one shipped
 *   in `@theokit/sdk/compaction` for several releases before this gate existed,
 *   and renaming it was a breaking change. The cost compounds with every
 *   release that carries it.
 * - Test names are executable documentation.
 *
 * Detection is two-tier so precision is auditable:
 *
 * - Tier 1 (near-deterministic): Latin letters carrying diacritics that
 *   Portuguese uses and English does not. Loanwords English genuinely borrows
 *   are in `WORD_ALLOWLIST`.
 * - Tier 2 (lexical): unaccented Portuguese words with no English homograph.
 *   Deliberately conservative — short words and cross-language homographs
 *   (`com`, `para`, `mais`, `de`, `os`, `em`, `no`) are NOT listed, because a
 *   false BLOCK on a lint gate is worse than a miss. A Portuguese comment
 *   written entirely without accents can slip past tier 1; tier 2 narrows that
 *   gap without closing it. Stated honestly rather than claimed complete.
 *
 *   `logo` was removed from the lexicon after it flagged `logo.png`: it is a
 *   common English noun as well as Portuguese, and a lexicon entry that fires
 *   on ordinary English is a gate that teaches people to ignore it.
 *
 * @internal
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')

/**
 * Scanned roots, relative to the repository root. `"."` means the whole repository.
 *
 * It scans the whole tree rather than an explicit list because the first version listed
 * `sdk/{src,tests}` and `sdk-tools/{src,tests}` — and silently missed `sdk-pty` and `sdk-budget`,
 * which carried 60 Portuguese lines nobody was watching. A gate whose coverage is a hand-kept list
 * decays the moment a package is added.
 *
 * The root moved out of `packages/` for the same reason, one level up: scoped to packages, the gate
 * could not see `docs/`, `tools/`, `scripts/`, `examples/` or the root `README.md` / `CHANGELOG.md`,
 * so nothing stopped a Portuguese document from landing there. It found exactly that — a 2156-line
 * course that stayed invisible for as long as the scope was narrower than the repository.
 */
/**
 * B-065 — SOURCE and its tests. Deliberately not the whole repository, and the exclusions are the
 * argument rather than convenience:
 *
 * - `wiki/` is the historical record — plans, reviews, decisions and grills written as the work
 *   happened. Rewriting them would edit what was said at the time, which is the opposite of what a
 *   record is for. New wiki pages are written in English; this gate cannot tell a 2026-06 review
 *   from one written today, so it does not judge them at all.
 * - `CHANGELOG.md` (root and per package) — entries for a RELEASED version are immutable under
 *   Unbreakable Rule 6.
 * - `ROADMAP*.md`, `CONTRIBUTING.md` — same category as the wiki.
 *
 * What this DOES cover is every line that ships or executes: `packages/*` source and tests, plus
 * the root test suite including the lint tests themselves. That is the surface where a Portuguese
 * identifier becomes a consumer's problem, and it is clean.
 */
const SCAN_ROOTS = ['packages', 'tests']

/**
 * Loanwords English legitimately borrows with their diacritics. `façade` is a
 * locked term of the architecture vocabulary ("Agent façade"), so it is not a violation.
 */
const WORD_ALLOWLIST = new Set(['façade', 'façades', 'naïve', 'café', 'résumé'])

/** Files exempt from the scan, relative to the repository root. */
/** B-065 — every CHANGELOG, root or per package. Released entries are immutable (Rule 6). */
const isChangelog = (rel: string): boolean =>
  rel === 'CHANGELOG.md' || rel.endsWith('/CHANGELOG.md')

const FILE_ALLOWLIST = new Set<string>([
  // This file names Portuguese words in order to ban them.
  'tests/lint/no-ptbr.test.ts',
  // B-065 — the repository CHANGELOG. Entries for a RELEASED version are immutable (Unbreakable
  // Rule 6): translating one would rewrite a record of what shipped, which is the discipline this
  // gate exists to serve rather than to override. New entries are written in English; the gate
  // cannot tell a released entry from a fresh one, so the file is exempt and the rule carries it.
  'CHANGELOG.md',
  // B-065 — a SIBLING lint test. Its fixtures are Portuguese sentences containing the word "todo",
  // present so it can prove it distinguishes Portuguese prose from an English `TODO:` marker.
  // Translating them removes the cases the test exists for — the same reason this file exempts
  // itself one line above.
  'tests/lint/task-marker.test.ts',
  // B-065 — `What&apos;s new` is an HTML apostrophe entity; the lexicon reads it as Portuguese
  // "apos". Escaping it differently to satisfy the gate would change the rendered banner.
  'packages/create-theokit/tests/unit/scaffold-surface.test.ts',
  // Two entries were removed on 2026-08-06, each on the condition its own comment had set. The
  // Portuguese course was decomposed into the `wiki/` bundle in English, and the recall probe that
  // matched a Brazilian city name in both spellings went with it. The gate now covers every word
  // that replaced them, and no exempt prose is left in the repository.
])

/**
 * Portuguese words with no English homograph. Every entry earns its place by
 * being unambiguous — see the honesty note in the file header for what is
 * deliberately excluded.
 */
const PT_LEXICON = new Set([
  'nao',
  'sao',
  'estao',
  'entao',
  'tambem',
  'porque',
  'porem',
  'apenas',
  'somente',
  'sempre',
  'agora',
  'aqui',
  'ainda',
  'quando',
  'onde',
  'quem',
  'isso',
  'isto',
  'esse',
  'essa',
  'aquele',
  'aquilo',
  'muito',
  'deve',
  'pode',
  'fazer',
  'usar',
  'precisa',
  'garante',
  'devolve',
  'retorna',
  'chama',
  'cria',
  'criar',
  'grava',
  'gravar',
  'escreve',
  'arquivo',
  'arquivos',
  'erro',
  'erros',
  'falha',
  'falhas',
  'dono',
  'chave',
  'caminho',
  'linha',
  'mesmo',
  'outro',
  'depois',
  'antes',
  'sobre',
  'durante',
  'atraves',
  'pelo',
  'pela',
  'pelos',
  'pelas',
  'nesse',
  'neste',
  'nessa',
  'desta',
  'deste',
  'disso',
  'seu',
  'sua',
  'seus',
  'suas',
  'nosso',
  'nossa',
  'voce',
  'eles',
  'elas',
  'cada',
  'usuario',
  'funcao',
  'nivel',
  'versao',
  'razao',
  'opcao',
  'acao',
  'persistencia',
  'obsolescencia',
  'robustez',
  'correcao',
  'correcoes',
  'possivel',
  'adquirir',
  'soltar',
  'propria',
  'proprio',
  'apos',
  'conteudo',
  'leitura',
  'escrita',
  'sessao',
  'sessoes',
  'janela',
  'motivo',
  'reclamavel',
  'tentativa',
  'teto',
  'montar',
  'parsear',
  'descartar',
  'compartilhado',
  'declarada',
  'efetiva',
  'quebra',
  'pendente',
  'pendencia',
  'resposta',
  'pergunta',
  'saida',
  'entrada',
  'tamanho',
  'vazio',
  'aviso',
  'checar',
  'validar',
  'limpar',
  'buscar',
  'juntar',
  'separar',
  'calcular',
  'aplicar',
  'anterior',
  'proximo',
  'primeiro',
  'ultimo',
  'senao',
  'assim',
  'ambos',
  'ambas',
  'ainda',
  'pois',
  'atual',
  'atualmente',
  'bruto',
  'vistos',
  'espera',
  'trecho',
])

/**
 * Latin letters carrying diacritics that Portuguese uses. Excludes the
 * mathematical `×` (U+00D7) and `÷` (U+00F7), which fall inside the naive
 * Latin-1 range and would otherwise produce false positives.
 */
const DIACRITIC = /[À-ÖØ-öø-ÿ]/

const WORD = /[A-Za-zÀ-ÿ]+/g

/**
 * Identifiers that are not prose and must not be tokenized as words.
 *
 * IANA timezone ids are the live case: `America/Sao_Paulo` is a standardized key, and splitting it
 * yields `Sao`, which the lexicon reads as an unaccented `são`. Mutilating the lexicon to hide that
 * would blind the gate to the real word, so the noise is removed from the line instead.
 */
const NOT_PROSE =
  /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/g

/**
 * Inline code spans — a symbol NAME is not prose in the language its letters happen to spell.
 *
 * The live case is the CHANGELOG announcing the renames this gate motivated: you cannot write
 * "`sessaoTemEscritor` is now `sessionHasWriter`" without naming the symbol being retired. Flagging
 * that would make the gate forbid documenting its own outcome, and the workaround people would reach
 * for — describing the rename without naming it — produces a changelog nobody can act on.
 *
 * Same trade already accepted for {@link NOT_PROSE}: strip the non-prose token from the line rather
 * than weaken the lexicon, so the gate stays sharp on the surrounding sentence. The cost is stated:
 * Portuguese written inside backticks is invisible here. That is the correct call for identifiers
 * and the wrong one for a Portuguese sentence someone chose to wrap in code formatting — a gap this
 * accepts knowingly rather than trading for false positives on every rename note.
 */
const INLINE_CODE = /`[^`\n]*`/g

interface Offender {
  file: string
  line: number
  tier: 'diacritic' | 'lexicon'
  words: string[]
  text: string
}

/**
 * Extensions the gate reads. `.md` and `.mjs` are in scope because `package.json` `files[]`
 * publishes README, docs and the claude-template to npm — Portuguese there reaches consumers
 * exactly like Portuguese in a `.d.ts` does. Scanning only `.ts` left them unwatched.
 */
const SCANNED_EXT = /\.(?:ts|mts|cts|js|mjs|cjs|md)$/

/**
 * Directories that hold build output, dependencies or local runtime state — never source we own.
 *
 * Dot-directories are skipped wholesale: inside a package they are tool or runtime state
 * (`.theokit/memory/sessions/` holds real conversation transcripts, which are Portuguese because
 * the user writes Portuguese). Linting a session transcript would be linting the user.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'docs-json'])

const isSkippedDir = (name: string): boolean => name.startsWith('.') || SKIP_DIRS.has(name)

/**
 * `withFileTypes` matters here, not as a micro-optimization: the first version called `stat` once
 * per entry while walking the whole monorepo, and the test blew a 20 s timeout. A gate slow enough
 * to time out is a gate someone disables.
 */
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  // `Dirent[]` and NOT `Awaited<ReturnType<typeof readdir>>`: `readdir` is overloaded, and the type
  // query collapses to ONE overload — the buffer one — so the annotation contradicted the call every
  // time. `Dirent` defaults its name type to `string`, which is what a string path actually yields.
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // A scan root that does not exist is not a violation — packages come and go.
    return out
  }
  const subdirs: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!isSkippedDir(entry.name)) subdirs.push(full)
    } else if (SCANNED_EXT.test(full) && !full.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  await Promise.all(subdirs.map((d) => walk(d, out)))
  return out
}

/**
 * Split an identifier into its camelCase / PascalCase / snake_case parts.
 *
 * The letter classes are `\p{Lu}` / `\p{Ll}` rather than `A-Z` / `a-z`, and that is the whole point
 * rather than a tidy-up. With the ASCII classes this function silently DROPPED every accented
 * character: `Correção` came back as `['Corre', 'o']` and `não` as `['n', 'o']`. `WORD` admits
 * `À-ÿ` and {@link classifyLine} tests the parts for a diacritic — but the parts had none left by
 * the time it looked, so the diacritic tier could never fire on an accented letter inside a word,
 * which is where Portuguese accents actually live.
 *
 * Measured, not reasoned: `// Correção de um problema que já estava lá.` in a scanned file passed
 * the sweep clean. The tier stayed useful-looking because unaccented lexicon words like `nao` fire
 * the OTHER tier, so every violation that ever failed this gate hid the fact that half of it was
 * dead. Anything written with correct Portuguese orthography walked straight through.
 */
function identifierParts(word: string): string[] {
  return word.split(/[_$]/).flatMap((p) => p.match(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})/gu) ?? [])
}

function stripDiacritics(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Every word-part of a line, with allowlisted loanwords already dropped. */
function candidateParts(line: string): string[] {
  return (line.replace(INLINE_CODE, ' ').replace(NOT_PROSE, ' ').match(WORD) ?? [])
    .filter((token) => !WORD_ALLOWLIST.has(token.toLowerCase()))
    .flatMap(identifierParts)
    .filter((part) => !WORD_ALLOWLIST.has(part.toLowerCase()))
}

/** Tier 1 wins over tier 2 so each line reports its strongest signal once. */
function classifyLine(line: string): Pick<Offender, 'tier' | 'words'> | undefined {
  const parts = candidateParts(line)

  const diacritic = parts.filter((p) => DIACRITIC.test(p))
  if (diacritic.length > 0) return { tier: 'diacritic', words: [...new Set(diacritic)] }

  const lexical = parts.filter((p) => !DIACRITIC.test(p) && PT_LEXICON.has(stripDiacritics(p)))
  if (lexical.length > 0) return { tier: 'lexicon', words: [...new Set(lexical)] }

  return undefined
}

function scanText(rel: string, text: string): Offender[] {
  const offenders: Offender[] = []

  text.split('\n').forEach((line, index) => {
    const hit = classifyLine(line)
    if (hit === undefined) return
    offenders.push({ file: rel, line: index + 1, ...hit, text: line.trim().slice(0, 120) })
  })

  return offenders
}

/** Filenames themselves must be English — a test file name is documentation. */
function scanFilename(rel: string): Offender | undefined {
  const base = rel.split(sep).pop() ?? rel
  const hits = identifierParts(base.replace(/\.[^.]+$/, '').replace(/[.-]/g, '_')).filter(
    (p) => PT_LEXICON.has(stripDiacritics(p)) || DIACRITIC.test(p),
  )
  if (hits.length === 0) return undefined
  return { file: rel, line: 0, tier: 'lexicon', words: [...new Set(hits)], text: base }
}

async function scanFile(file: string): Promise<Offender[]> {
  const rel = relative(REPO_ROOT, file).split(sep).join('/')
  if (FILE_ALLOWLIST.has(rel) || isChangelog(rel)) return []

  const named = scanFilename(rel)
  const inside = scanText(rel, await readFile(file, 'utf8'))
  return named === undefined ? inside : [named, ...inside]
}

async function collectOffenders(): Promise<{
  offenders: Offender[]
  perRoot: Record<string, number>
}> {
  const files: string[] = []
  const perRoot: Record<string, number> = {}
  for (const root of SCAN_ROOTS) {
    const found = await walk(join(REPO_ROOT, root))
    perRoot[root] = found.length
    files.push(...found)
  }
  const perFile = await Promise.all(files.map(scanFile))
  return { offenders: perFile.flat(), perRoot }
}

/**
 * A filesystem sweep of every workspace package, not a unit test — the default 20 s budget is sized
 * for the latter and this blew it twice while the scope widened. Stating the real cost is honest;
 * silently shrinking the scan to fit a unit-test budget would trade coverage for a green clock.
 */
const SWEEP_TIMEOUT_MS = 120_000

describe('codebase is English-only (no PT-BR)', () => {
  it(
    'packages source and tests carry no Portuguese',
    async () => {
      const { offenders, perRoot } = await collectOffenders()

      // Non-vacuity floor, asserted BEFORE the result. Walking a directory that is
      // not there is silent: `walk` returns [], every scan is skipped, and the gate
      // reports clean over nothing. That is how this file's own history records the
      // failure twice — it walked two roots that had been removed and still passed.
      // The floor is a PROPERTY (every declared root contributed a file), not a
      // frozen count, so it needs no edit when the tree legitimately grows.
      for (const root of SCAN_ROOTS) {
        expect(
          perRoot[root],
          `scan root "${root}" matched no file — the sweep is vacuous`,
        ).toBeGreaterThan(0)
      }

      expect(offenders).toEqual([])
    },
    SWEEP_TIMEOUT_MS,
  )

  /**
   * The CHANGELOG exemption above is wider than the reason for it. Released entries are immutable
   * under Unbreakable Rule 6 — that is why the file is exempt. `[Unreleased]` is not released: it is
   * still being written, and at the next version cut it becomes part of the immutable record exactly
   * as it stands.
   *
   * So the blanket exemption had a live consequence, not a theoretical one. A twelve-line Portuguese
   * entry sat under `[Unreleased]` and would have frozen there permanently. This scans the mutable
   * section only, which is the boundary the rule actually draws: the record is untouchable, the draft
   * is not.
   *
   * `scanText` is reused rather than reimplemented — one definition of what counts as Portuguese, or
   * the two drift and the weaker one decides.
   */
  it('the CHANGELOG [Unreleased] section carries no Portuguese', async () => {
    const text = await readFile(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
    const lines = text.split('\n')

    const start = lines.findIndex((l) => l.startsWith('## [Unreleased]'))
    // Released headings are `## [<name> <semver>] - <date>`; `[Unreleased]` is the only one whose
    // bracket does not open with a version. Anchoring on "the next `## [` heading" rather than on a
    // version pattern means a future heading style cannot silently extend the scanned range to the
    // end of the file, nor shrink it to nothing.
    const after = lines.slice(start + 1).findIndex((l) => l.startsWith('## ['))
    const end = after === -1 ? lines.length : start + 1 + after

    // Non-vacuity floor, asserted BEFORE the result — the same failure this file records twice. If
    // the heading is renamed or the section emptied, `slice` yields nothing and the scan reports
    // clean over zero lines. A missing section is a defect in the changelog discipline, not a pass.
    expect(
      start,
      'no `## [Unreleased]` heading in CHANGELOG.md — the scan would be vacuous',
    ).toBeGreaterThanOrEqual(0)
    const section = lines.slice(start, end)
    // Counted from `start + 1`, not `start`. The heading is always present by the assertion above,
    // so counting it would make this floor satisfy itself — a vacuity check that cannot detect the
    // vacuity it is for.
    expect(
      section.slice(1).filter((l) => l.trim() !== '').length,
      '`[Unreleased]` is empty — every change lands there first (Unbreakable Rule 6)',
    ).toBeGreaterThan(0)

    // Line numbers are reported against the real file, so a failure points at the line to edit
    // rather than at an offset into a slice.
    const offenders = scanText('CHANGELOG.md', section.join('\n')).map((o) => ({
      ...o,
      line: o.line + start,
    }))
    expect(offenders).toEqual([])
  })
})
