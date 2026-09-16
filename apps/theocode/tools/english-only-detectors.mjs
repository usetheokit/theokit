/**
 * Detection library for `check-english-only.mjs` — lexicons and the seven detectors.
 *
 * Split out of the CLI entry when the file crossed 700 lines with the highest churn in `tools/`:
 * the checker keeps the walker, the allowlist and the reporting; this module owns WHAT counts as
 * Portuguese. Adding a detector means adding an entry to `LINE_DETECTORS` below — not editing a
 * dispatch chain (the pre-split shape grew detectors four times, and each addition was surgery on
 * one CC-20 closure).
 *
 * IMPORT-SAFE BY CONTRACT: this module loads the system word lists at import time (they back the
 * exported pure functions) but never exits the process. Whether missing lexicons are fatal is the
 * CLI's decision, made in its own frame — see `lexiconReport()`.
 */
import { existsSync, readFileSync } from 'node:fs'

const ACCENTED = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/

/** Where the system keeps word lists. Missing entries are skipped; all missing is for the CLI to judge. */
export const LEXICONS = {
  en: [
    '/usr/share/dict/american-english',
    '/usr/share/dict/words',
    '/usr/share/hunspell/en_US.dic',
  ],
  pt: ['/usr/share/dict/brazilian', '/usr/share/dict/portuguese', '/usr/share/hunspell/pt_BR.dic'],
}

/**
 * English technical vocabulary that collides with a Portuguese dictionary entry. Each one is a real
 * word in Portuguese, which is why the lexicon test alone cannot clear it.
 */
const TECHNICAL = new Set([
  'cli', // pt: "to click"
  'pre', // pt: prefix particle
  'repo', // pt: "cabbage"
  'uri', // pt: "urine"
  'acp', // agent client protocol
  'todo', // pt: "all" — here it is the English task marker (`TodoItem`)
  'num', // pt: contraction of "em um" — here it abbreviates "number" (`parseNum`)
  'proto', // pt: a prefix — here it is `__proto__`, the prototype-pollution guard
  'ino', // pt: "inn" — here it is `Stats.ino`, the POSIX inode number
  'https', // pt: conjugation of "hipar" in some lists — here it is the URL scheme
  'distro', // pt: a verb form — here it is the Linux-distribution abbreviation
  'eval', // present in pt_BR.dic — here it is the English evaluate/eval abbreviation
  'coalescer', // pt: a verb form — here it is the English agent noun for something that coalesces
  'renormalize', // present in /usr/share/dict/portuguese — an English verb either way
  // Tool and protocol names that collide with a Portuguese dictionary entry. Measured against the
  // theokit repositories, where they accounted for ~19% of all matches.
  'vite',
  'astro',
  'cron',
  'param',
  'params',
  'abi',
  'goto',
  'stringify',
  'enum',
  // Syntax-highlighter language identifiers. Each is a Portuguese dictionary entry and each
  // appears in a language list, never as prose.
  'mdx',
  'cpp',
  'apl',
  'lua',
  'imba',
  'vala',
  'prisma',
  'abap',
  // Other measured collisions across the theokit repositories.
  'topo', // `topoSort` — topological, not pt "top"
  'sao',
  'paulo', // the IANA timezone `America/Sao_Paulo`
  'sms',
  'btn',
  'mdc',
  'jina',
  'rgb',
  'intra',
  // English derived forms absent from en_US.dic (it ships without its .aff affix rules) and
  // present in pt_BR.dic. Measured against the theokit corpus; each is unambiguously English here.
  'subclasses',
  'subclass',
  'multimodal',
  'responder',
  'responders',
  'transcode',
  // Abbreviations measured in the gateway/plugin repositories.
  'ipc', // inter-process communication
  'tpc', // "topic" in a session-id scheme
  'paras', // "paragraphs" in a chunker test
  'ses',
  'saas',
  'bps',
  'cta',
  'rhf',
  'mui',
  // Terminal and image-format vocabulary measured in theokit-tui.
  'csi', // Control Sequence Introducer (ANSI/CSI-2026)
  'seps', // "separators" in a status-bar test
  'todos', // pt "all" — here the plural of the English TodoItem
  'sof',
  'soi',
  'uno',
  'mis', // the English prefix in "mis-splits" — wordParts breaks on the hyphen
  'ico', // the .ico file extension in a MIME map
  'ccc', // a CSS hex colour (#ccc) — three-letter hex runs read as words
  'gru', // the IATA code for Guarulhos airport, used in flight-search fixtures
  'facto', // the Latin in "de-facto"
  'wai',
  'wcag', // WAI-ARIA and WCAG
  'dlg', // "dialog" in a test id
  'tri', // the English prefix in "tri-state" — wordParts breaks on the hyphen
  'mantissas', // the English plural of mantissa (the 1/2/5 nice-number ladder)
  'cmp', // "compare" in a sort comparator
  'cas', // compare-and-swap
  'xai', // the xAI provider
  'aip', // Google API Improvement Proposal (AIP-193)
  'metas', // regex metacharacters, plural of "meta"
  'ver', // SemVer, and `<ver>` in a path placeholder
  'scp', // secure copy
  'entra', // Microsoft Entra ID
  'pojo', // plain old JavaScript object
  'fsm', // finite state machine
  'mcd', // `McdFrontmatterSchema` — a transposition of `mdc`, not a word
  'bom', // byte order mark
  'tpm', // tokens per minute
  'iam', // AWS / GCP identity and access management
  'aci', // agent-computer interface
  'ecma', // ECMAScript
  'cnpj', // the Brazilian company registry id — same reason as cpf
  'noir', // a theme name shipped by @theokit/ui
  'correlator', // the tool-card correlator
  'crm', // customer relationship management
  'consolas', // the font, in a font stack
  'reviver', // the JSON.parse reviver argument
  'ans', // "answer", a test fixture string
  'cti', // a fragment of a `<function=…>` tag split across stream chunks
  'eln', // the grep flags -rEln
  'dlx', // pnpm dlx
  'xhtml', // the XHTML namespace in an SVG sanitizer fixture
  'mono', // monospace, in a font stack
  'vero', // `vero_id`, a cache-key field name
  'cpf', // the Brazilian taxpayer id — a proper noun, and a thing PII redaction must name
  'sdk',
  'api',
  'url',
  'dir',
  'tmp',
  'src',
  'min',
  'max',
  'doc',
  'ref',
  'dev',
  'log',
])

/** Strip combining marks so `seleção` also indexes as `selecao`. */
const unaccent = (w) => w.normalize('NFD').replace(/\p{Mn}/gu, '')

function loadLexicon(paths, alsoUnaccented) {
  const words = new Set()
  let loaded = 0
  for (const p of paths) {
    if (!existsSync(p)) continue
    loaded++
    for (const line of readFileSync(p, 'latin1').split('\n')) {
      // hunspell `.dic` lines are `word/FLAGS`; plain dict files are bare words.
      const w = (line.split('/')[0] ?? '').trim().toLowerCase()
      if (w.length < 3 || !/^[a-zà-ÿ]+$/.test(w)) continue
      words.add(w)
      if (alsoUnaccented) words.add(unaccent(w))
    }
  }
  return { words, loaded }
}

const EN = loadLexicon(LEXICONS.en, false)
const PT = loadLexicon(LEXICONS.pt, true)

/**
 * Whether the lexicons could be loaded, for the CLI to act on IN ITS OWN FRAME.
 *
 * This used to be a `process.exit(1)` at module scope: any import on a machine without the
 * dictionaries terminated the importing process — including the test runner the import guard on
 * `main()` exists to serve. The guard's contract (exit 1 rather than report clean when it cannot
 * check) is unchanged; it is enforced by the CLI entry, where an exit belongs.
 */
export function lexiconReport() {
  return { enLoaded: EN.loaded, ptLoaded: PT.loaded, enForms: EN.words.size, ptForms: PT.words.size }
}

/** Split an identifier into lowercase word parts: `varrerMarkdown` -> [varrer, markdown]. */
export function* wordParts(identifier) {
  // A git SHA is not a word. `50fafe2` splits to `fafe`, which is a Portuguese verb form, and a
  // changelog citing a commit would be reported as Portuguese prose. Hex runs adjacent to digits
  // are dropped before splitting.
  // A backslash escape is not a letter. `\n` in a string literal and `\b` in a regex source were
  // being split as `[^A-Za-z]` boundaries, leaving the escape letter glued to the next word:
  // `"\nno json here"` yielded `nno` and `/\bpa-/` yielded `bpa`, both Portuguese words.
  const withoutEscapes = identifier.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|.)/g,
    (_m, brace, u4, x2) => {
      // A numeric escape names a CHARACTER — decode it. Blanking it split `Brasília` into
      // `Bras` + `lia`, manufacturing a Portuguese word out of a correctly spelled proper noun.
      const hex = brace ?? u4 ?? x2
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16))
      // Everything else (`\n`, `\t`, `\b`) is a control escape, not a letter: it separates words.
      return ' '
    },
  )
  // An opaque token is not a word. Generalizes the git-SHA case: any alphanumeric run of 20+ chars
  // containing a digit (base64 key blobs, OAuth client ids) is dropped whole, because splitting it
  // on case boundaries manufactures fragments — `MIIEvQIBADAN...` produced `mii`.
  const withoutBlobs = withoutEscapes.replace(/[A-Za-z0-9+/=]{20,}/g, (run) =>
    /\d/.test(run) ? ' ' : run,
  )
  // A UUID is one opaque identifier, not five words. The hex rule below requires a digit, so
  // all-letter groups slipped past it: `bebe`, `daca`, `feda` and `abda` are all valid hex AND
  // Portuguese, and 37 generated session filenames were reported because of it.
  const withoutUuids = withoutBlobs.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    ' ',
  )
  const withoutHex = withoutUuids.replace(/\b[0-9a-f]*\d[0-9a-f]*\b/gi, ' ')
  // Strip diacritics BEFORE splitting. Without this, the split on `[^A-Za-z]` chops an accented
  // word in half: `façade` became `fa` + `ade`, and `ade` is a Portuguese word — so a correctly
  // spelled English noun was reported as Portuguese. Unaccenting also matches how the Portuguese
  // lexicon is indexed, so `seleção` still resolves to `selecao` and stays detectable.
  const flat = unaccent(withoutHex)
  for (const chunk of flat.split(/[^A-Za-z]+/)) {
    for (const w of chunk.match(/[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+/g) ?? []) {
      if (w.length >= 3) yield w.toLowerCase()
    }
  }
}

/**
 * Suffixes that end Portuguese words and do not end English ones. Applied ONLY to words absent from
 * BOTH lexicons, which is what makes them safe: an English word ending in `-ndo` ("commando",
 * "innuendo") is in the English lexicon and never reaches this test.
 *
 * This exists because the installed lexicons are `.dic` files without their `.aff` affix rules, so
 * derived forms are missing — `localização` is in no list on this machine, and `localizacao` was
 * therefore invisible to the lexicon test despite being named in the engagement scope. No hunspell
 * binary and no Portuguese aspell dictionary are installed to expand them properly.
 *
 * HEURISTIC, and labelled as such. Measured on this repository: 11 hits, 0 false positives
 * (`selecao`, `localizacao`, `instrucao`, `delegacao`, `continuacao`, `interrupcao`, `inspecao`,
 * `conducao`, `instancia`, `disponivel`, `intocaveis`) out of 949 words in neither lexicon.
 */
const PT_SUFFIX =
  /^.{3,}(?:cao|coes|acoes|mento|mentos|dade|dades|agem|agens|ncia|ncias|avel|ivel|aveis|iveis|ndo|ao|oes)$/

/**
 * Portuguese words that NO installed dictionary contains and NO suffix rule reaches, found by
 * reading all 189 entries of `--list-unknown` on 2026-08-09. Each one's accented form is absent
 * from `/usr/share/dict/*` and `/usr/share/hunspell/pt_BR.dic`, which is why the lexicon test
 * cannot see them.
 *
 * This IS a denylist, and the whole point of the 2026-08-09 rewrite was that a denylist cannot be
 * the ONLY detector. It is acceptable here for two reasons the original list did not have:
 * it is a SUPPLEMENT to two open-ended detectors rather than the sole one, and every entry was
 * MEASURED against a real occurrence rather than imagined. A word missing from all three
 * detectors is not a hole this list closes permanently — it is the residue, and the residue is
 * small and enumerated instead of unknown.
 *
 * Exact match only. `indice` (pt: índice) is Portuguese; `indices` is the English plural of index
 * and appears legitimately in `packages/agent/src/session/backtrack.ts` — a substring rule would
 * flag it.
 */
const KNOWN_PORTUGUESE = new Set([
  'cabecalho',
  'cabecalhos', // cabeçalho — header
  'codigo', // código — code
  'espaco', // espaço — space
  'indice', // índice — index (NOT `indices`, the English plural)
  'resetar', // to reset — Portuguese verb form of an English loanword
  'rotulo',
  'rotulos', // rótulo — label
])

/**
 * A word is Portuguese when a Portuguese lexicon has it and an English one does not, or — for words
 * neither lexicon knows — when it carries a Portuguese-only suffix.
 */
export const isPortuguese = (w) => {
  if (TECHNICAL.has(w) || EN.words.has(w)) return false
  return PT.words.has(w) || PT_SUFFIX.test(w) || KNOWN_PORTUGUESE.has(w)
}

/** Whether a word is in neither lexicon nor the technical list — the `--list-unknown` residue. */
const isUnknownWord = (w) => !EN.words.has(w) && !PT.words.has(w) && !TECHNICAL.has(w)

/**
 * Portuguese POSSESSIVE construction in an identifier — B-084.
 *
 * Sixteen identifiers shipped built on `Do`/`Da`/`De` (`pluginDeHooks`, `propsDoSlot`,
 * `TOOLS_DO_REVIEWER`) and every detector here reported the tree clean. Correctly, too: the
 * identifier scan splits camelCase and decides per WORD, and `do`, `da` and `de` are all in
 * `/usr/share/hunspell/en_US.dic` — `do` the verb, `de` the prefix. Each word was declined right
 * and the construction survived, which is B-083's blind spot wearing a different hat.
 *
 * This detects the SHAPE instead: an INTERIOR `Do|Da|De|Dos|Das` segment between two other
 * segments. English does not build identifiers that way; Portuguese builds `X do Y` constantly.
 *
 * Interior is load-bearing — `doSomething` and `DOM_ELEMENT` start with it and are English, so a
 * head match would be the false-positive flood that killed version one of this guard.
 */
const PT_POSSESSIVE_CAMEL = /[a-z0-9](?:Do|Da|De|Dos|Das)[A-Z]/
const PT_POSSESSIVE_SNAKE = /[A-Za-z0-9]_(?:DO|DA|DE|DOS|DAS)_[A-Za-z0-9]/

export function portugueseConstruction(identifier) {
  return PT_POSSESSIVE_CAMEL.test(identifier) || PT_POSSESSIVE_SNAKE.test(identifier)
}

/**
 * Portuguese inside STRING LITERALS — the text that reaches a user.
 *
 * The accent detector misses unaccented prose, and the identifier scan strips strings before it
 * runs, so `'↻ continuando o goal…'` shipped to the timeline and a dozen error messages
 * (`maxSessions deve ser inteiro >= 1`, `APLICADO — N artefato(s) removido(s)`) sat in the product
 * while the guard printed `clean`.
 *
 * Comments are removed BEFORE this runs, for a measured reason: a JSDoc block legitimately quotes
 * Portuguese it is explaining — the old code `perfis = layer.profiles` in a regression test, and
 * the SDK's own `ListOptionsSemPaginacao` type name. Flagging a quotation of the defect makes the
 * check fire on correct code. The cost is stated rather than hidden: unaccented Portuguese PROSE
 * in a comment is caught by nothing here. It does not reach users, which is why it ranks below a
 * false positive that would get this detector deleted.
 *
 * Import/export specifiers are skipped — a Portuguese path is detector 4's job, not this one's.
 *
 * SECOND LIMIT, stated because it admits USER-FACING text and is therefore worse than the comment
 * one above (B-083). This detector decides per WORD, and a word is Portuguese only when a PT
 * lexicon has it and an EN lexicon does not. So a Portuguese SENTENCE built entirely from EN/PT
 * homographs is invisible to it. Measured, not hypothetical: `(use /model <name> para trocar)`
 * shipped to a toast while this guard printed `clean`, because every word in it is in
 * `/usr/share/hunspell/en_US.dic` — including `para` (paragraph/parachute) and `trocar` (a surgical
 * instrument). Each word was declined CORRECTLY; the sentence still got through.
 *
 * Do NOT close this by adding those words to a Portuguese list: `para` is documented in this
 * guard's own test suite as a deliberate EN/PT collision, and forcing either word would break the
 * collision handling version two was written to get right.
 *
 * THIRD INSTANCE, 2026-08-10: `ultimoUsage` shipped and was found by eye, not by this guard.
 * `ultimo` is in `en_US.dic` (English commercial usage, "of last month"), so `isPortuguese` returns
 * false at the EN check — BEFORE `KNOWN_PORTUGUESE` is consulted, which is why adding it there does
 * nothing. That ordering is correct: it is what stops `cli`, `repo` and `para` from firing. The
 * lesson is that this is one blind spot with three faces — a sentence (B-083), a possessive
 * construction (B-084, now detected), and a single homograph noun — and only the middle one had a
 * shape worth detecting. Closing it needs a phrase-level or
 * grammar-level signal, scored for false positives against this corpus BEFORE it lands — a guard
 * that cries wolf is what killed version one.
 */
function portugueseInStrings(line) {
  if (/^\s*(?:import|export)\s.*\sfrom\s/.test(line)) return []
  const found = []
  for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    for (const w of wordParts(m[2] ?? '')) if (isPortuguese(w)) found.push(w)
  }
  return found
}

/**
 * Portuguese PROSE inside comments.
 *
 * Comments were exempt until 2026-08-09, and the exemption was justified: a JSDoc block legitimately
 * QUOTES the Portuguese it explains — the old `perfis = layer.profiles` in a regression test, the
 * SDK's `ListOptionsSemPaginacao`, the rename table in `delegation-cap.test.ts`. Flagging a
 * quotation of the defect makes the check fire on correct code.
 *
 * The exemption was also wrong, and a probe proved it: a seven-line Portuguese comment sat in
 * `tools/build-cli.mjs` explaining why `proper-lockfile` stays external, and nothing could see it.
 *
 * The resolution is that every one of those legitimate citations is inside a BACKTICK CODE SPAN —
 * measured, all four of them. So the span is removed and the surrounding prose is judged. A comment
 * may quote Portuguese; it may not be written in it.
 */
export function portugueseInComments(line) {
  const m = /(?:^\s*\*(?!\/)|\/\/|\/\*)(.*)$/.exec(line)
  if (m === null) return []
  const prose = (m[1] ?? '').replace(/`[^`]*`/g, ' ')
  const found = []
  for (const w of wordParts(prose)) if (isPortuguese(w)) found.push(w)
  return found
}

/**
 * Portuguese words in a file's own NAME.
 *
 * Every other detector reads file contents, which is how `hooks-para-membro.ts` shipped and was
 * eventually found by a human reading the tree rather than by tooling. A path is written text under
 * the same English-only rule as prose.
 *
 * The extension is dropped before splitting so `ts`/`tsx`/`mjs` never enter the word stream — they
 * are below the 3-character floor today, which makes relying on that accidental.
 */
export function portugueseWordsInFilename(path) {
  const base = path.split('/').pop() ?? ''
  const withoutExt = base.includes('.') ? base.slice(0, base.indexOf('.')) : base
  // Strip UUIDs BEFORE splitting on separators — the split would shatter them into groups first,
  // and `wordParts` would never see the shape. `bebe`, `daca`, `feda` and `abda` are valid hex
  // AND Portuguese, so 37 generated session filenames were reported on that basis alone.
  const withoutUuids = withoutExt.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '-',
  )
  const found = []
  for (const part of withoutUuids.split(/[-_]+/)) {
    for (const w of wordParts(part)) if (isPortuguese(w)) found.push(w)
  }
  return found
}

/**
 * Blank out string literals and comments so the identifier scan sees only code. They are not ignored
 * — the accent detector reads the raw line, which is where Portuguese prose almost always shows up.
 */
function codeOnly(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
}

/**
 * Portuguese function words used as BARE IDENTIFIERS — the fourth face.
 *
 * The string-literal doc above names this blind spot as having three faces: a sentence (B-083), a
 * possessive construction (B-084, detected), and a single homograph noun. Measured on 2026-09-10,
 * there is a fourth, and it shipped:
 *
 *     fork: (de, para) => forkSession(de, para)
 *         — packages/tui/src/agent-session/composition-root.ts:125
 *
 * The guard printed `english-only: clean`, exit 0. Correctly, by its own rule: `isPortuguese`
 * short-circuits on `EN.words.has(w)`, and both words are in the English lexicons it loads — `de`
 * in all three, `para` in `en_US.dic`. No denylist entry can reach them, and the comment above
 * forbids trying: forcing `para` would break the EN/PT collision handling this guard was rewritten
 * to get right.
 *
 * So this detects a SHAPE, the way the possessive detector does. Not the word — the CO-OCCURRENCE.
 * Two bare Portuguese function words standing as whole identifiers on one line is somebody naming
 * parameters in Portuguese; there is no English reading of `(de, para)`.
 *
 * The pair is what makes it safe, and the safety is the point. `rules/english-only.md`
 * § "Detection is precise, not exhaustive" made a deliberate call not to match `para`, `de` or
 * `com`, because "the first thing anyone does with a noisy gate is turn it off". That call stands:
 * `para` ALONE is a real English identifier — the standard abbreviation for paragraph,
 * `para.textContent` — and a lone match would be exactly the noise the rule refuses. Requiring two
 * costs the single-word case, which is stated here rather than hidden, and buys a detector nobody
 * has a reason to disable.
 *
 * Whole identifiers only, and code only: `parameters`, `decode` and `comment` contain these
 * letters and are English, and a comment is prose, which the comment/string detectors own.
 */
const PT_BARE_WORDS = new Set([
  // Prepositions and conjunctions that name nothing on their own in English code.
  'de', 'da', 'do', 'dos', 'das', 'para', 'com', 'sem', 'ate', 'pelo', 'pela',
  'num', 'numa', 'nos', 'nas', 'aos', 'pra', 'por',
  // The from/to pair a Portuguese speaker reaches for when naming a copy or a move.
  'origem', 'destino', 'entrada', 'saida', 'valor', 'nome', 'lista', 'texto',
])

export function portugueseIdentifierPair(line) {
  const identifiers = codeOnly(line).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  const hits = new Set()
  for (const identifier of identifiers) {
    if (PT_BARE_WORDS.has(identifier.toLowerCase())) hits.add(identifier.toLowerCase())
  }
  return hits.size >= 2
}

/**
 * The identifier scan — possessive construction first, then per-word lexicon classification.
 * Words in neither lexicon are reported through `onUnknown` for the `--list-unknown` sweep.
 */
function detectInIdentifiers(line, onUnknown) {
  for (const identifier of codeOnly(line).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    // The possessive construction (B-084) is checked per IDENTIFIER: the word loop below cannot
    // see it — `do`, `da` and `de` are all English dictionary entries, so every part of
    // `pluginDeHooks` is declined correctly and the identifier passes whole.
    if (portugueseConstruction(identifier)) {
      return { why: `Portuguese possessive construction in "${identifier}"` }
    }
    for (const w of wordParts(identifier)) {
      if (isPortuguese(w)) return { why: `Portuguese word "${w}" in \`${identifier}\`` }
      if (onUnknown !== undefined && isUnknownWord(w)) onUnknown(w)
    }
  }
  return null
}

/**
 * The per-line detectors, IN ORDER, as data. First hit wins — the ordering is the same one the
 * pre-split dispatch chain maintained by hand, and each entry documents why it runs where it does.
 *
 * Adding a detector is an ADDITION here (open/closed): write the function above, insert an entry
 * at the right rank, and the walker never changes.
 */
const LINE_DETECTORS = [
  {
    name: 'accent',
    detect: (line) => (ACCENTED.test(line) ? { why: 'accented character' } : null),
  },
  {
    // Prose inside comments, with backtick code spans removed (see portugueseInComments). Runs
    // before the string detector so a doc block quoting a string is judged as prose.
    name: 'comment-prose',
    detect: (line) => {
      const found = portugueseInComments(line)
      return found.length > 0 ? { why: `Portuguese word "${found[0]}" in a comment` } : null
    },
  },
  {
    // String literals, with comments removed first (see portugueseInStrings). A JSDoc
    // continuation line (` * …`) is a comment too — without this, a backtick code span quoting
    // Portuguese inside a doc block reads as a string literal.
    name: 'string-literal',
    detect: (line) => {
      const noComments = /^\s*\*(?!\/)/.test(line)
        ? ''
        : line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const found = portugueseInStrings(noComments)
      return found.length > 0 ? { why: `Portuguese word "${found[0]}" in a string literal` } : null
    },
  },
  {
    // Bare Portuguese function words naming things (2026-09-10). Runs before the identifier scan
    // for the same reason the possessive check does: the word loop decides per WORD, and each of
    // these words is declined CORRECTLY as English, so the pair survives it intact.
    name: 'identifier-pair',
    detect: (line) =>
      portugueseIdentifierPair(line)
        ? { why: 'Portuguese function words used as identifiers on one line' }
        : null,
  },
  {
    name: 'identifiers',
    detect: detectInIdentifiers,
  },
]

/** Run the detector table over one line. Returns the first hit's `{ why }`, or `null`. */
export function detectLine(line, onUnknown) {
  for (const detector of LINE_DETECTORS) {
    const hit = detector.detect(line, onUnknown)
    if (hit !== null) return hit
  }
  return null
}
