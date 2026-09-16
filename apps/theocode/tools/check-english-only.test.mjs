/**
 * Tests for the English-only guard.
 *
 * The guard is the instrument this whole engagement is about, and until now it had none. It
 * reported `clean` over 144 Portuguese identifiers, and every fix to it was verified by running it
 * once and reading the output — which is exactly how the denylist survived four extensions.
 *
 * Two of these tests are anti-vacuity floors. Without them, a guard that flags everything and a
 * guard that flags nothing would both pass.
 */
import { describe, expect, it } from 'vitest'

import {
  EXTS,
  portugueseConstruction,
  portugueseIdentifierPair,
  isPortuguese,
  portugueseInComments,
  portugueseWordsInFilename,
  wordParts,
} from './check-english-only.mjs'

describe('T0.1 — a Portuguese filename is a violation', () => {
  it('test_a_portuguese_filename_is_flagged', () => {
    // The gap this closes: `hooks-para-membro.ts` shipped for months and was found by a human
    // reading the tree, not by any detector. Every detector reads file CONTENTS; a path is
    // written text under the same rule.
    //
    // Only `membro` is returned, and that is correct: `para` is in `/usr/share/hunspell/en_US.dic`
    // (English "para", as in parachute/paragraph), so it is a genuine EN/PT collision the lexicon
    // test must clear — the same class as `cli` (to click) and `repo` (cabbage). One flagged word
    // is enough to flag the path, which is what the guard needs.
    expect(portugueseWordsInFilename('packages/agent/src/delegation/hooks-para-membro.ts')).toEqual(
      ['membro'],
    )
  })

  it('test_an_english_filename_is_not_flagged', () => {
    // ANTI-VACUITY FLOOR: returning every word would satisfy the assertion above.
    expect(portugueseWordsInFilename('packages/tui/src/terminal-io/input-router.ts')).toEqual([])
  })

  it('test_the_file_extension_is_never_treated_as_a_word', () => {
    // `ts`/`tsx`/`mjs` must not enter the word stream. They are currently below the 3-char floor,
    // which makes passing accidental — this pins it against a future floor change.
    const words = portugueseWordsInFilename('a/instrucao.tsx')
    expect(words).toContain('instrucao')
    expect(words).not.toContain('tsx')
  })
})

describe('T0.1 / M4 — KNOWN_PORTUGUESE matches whole words only', () => {
  it('test_the_portuguese_singular_is_flagged', () => {
    // `índice` — present in no installed lexicon and matching no suffix rule, which is why it
    // survived in hooks.ts after the package was declared clean.
    expect(isPortuguese('indice')).toBe(true)
  })

  it('test_a_backslash_escape_does_not_glue_onto_the_next_word', () => {
    // `\n` inside a string literal is an escape, not two letters. Splitting on [^A-Za-z] left the
    // `n` glued to the following word: "\nno json here" yielded `nno`, a Portuguese word, and the
    // line was reported. Same shape as `\b` in a regex source gluing into `bpa`.
    expect([...wordParts('just plain text\\nno json here')]).not.toContain('nno')
    expect([...wordParts('/\\bpa-[A-Za-z0-9_-]{20,}/g')]).not.toContain('bpa')
  })

  it('test_a_uuid_is_not_a_source_of_words', () => {
    // A UUID group is an opaque token. The hex rule below requires a digit, so all-letter groups
    // survived it: `run-36f0a620-0199-432b-bebe-1701bdcd0496.md` yielded `bebe`, and 37 generated
    // session files were reported as having Portuguese names.
    expect(portugueseWordsInFilename('run-36f0a620-0199-432b-bebe-1701bdcd0496.md')).toEqual([])
    expect(portugueseWordsInFilename('run-4bb3a63d-feda-4a3e-a2e1-afb160699727.md')).toEqual([])
  })

  it('test_a_portuguese_word_next_to_a_uuid_is_still_flagged', () => {
    // ANTI-VACUITY FLOOR: dropping the UUID must not drop the rest of the name.
    expect(portugueseWordsInFilename('rascunho-36f0a620-0199-432b-bebe-1701bdcd0496.md')).toContain(
      'rascunho',
    )
  })

  it('test_a_unicode_escape_is_decoded_rather_than_erased', () => {
    // Blanking `\u00ed` split `Bras\u00edlia` into `Bras` + `lia`, and `lia` is Portuguese — the
    // erasure manufactured the very word it was meant to avoid. Decoding to the character and
    // then unaccenting keeps the word whole.
    expect([...wordParts('Bras\\u00edlia')]).toEqual(['brasilia'])
  })

  it('test_an_opaque_alphanumeric_blob_is_not_split_into_words', () => {
    // A base64 key blob is not prose. Case-boundary splitting turned
    // `MIIEvQIBADANBgkqhkiG...` into `mii`, a Portuguese verb form. Generalizes the git-SHA rule
    // already applied below: a long alphanumeric run containing a digit is an opaque token.
    expect([...wordParts('MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC')]).toHaveLength(0)
    expect([...wordParts('app_EMoamEEZ73f0CkXaXp7hrann')]).toEqual(['app'])
  })

  it('test_an_ordinary_long_identifier_is_still_split', () => {
    // ANTI-VACUITY FLOOR for the rule above: without the digit requirement it would swallow real
    // camelCase names, and the lexicon would stop seeing the words inside them.
    expect([...wordParts('createInteractiveShellToolFactory')]).toContain('interactive')
  })

  it('test_the_english_plural_of_index_is_not_flagged', () => {
    // ANTI-VACUITY FLOOR and the reason the match is exact rather than substring: `indices` is
    // the English plural and appears legitimately in packages/agent/src/session/backtrack.ts.
    // A substring rule would flag correct English and get the whole mechanism deleted.
    expect(isPortuguese('indices')).toBe(false)
  })
})

describe('T0.1 — the lexicon test decides by dictionary, not by a word list', () => {
  it('test_a_portuguese_word_absent_from_english_is_flagged', () => {
    expect(isPortuguese('padrao')).toBe(true)
    expect(isPortuguese('endurecendo')).toBe(true)
  })

  it('test_an_english_word_is_not_flagged', () => {
    // ANTI-VACUITY FLOOR for the assertion above.
    expect(isPortuguese('default')).toBe(false)
    expect(isPortuguese('window')).toBe(false)
  })

  it('test_an_english_term_that_collides_with_a_portuguese_word_is_not_flagged', () => {
    // `cli` is "to click", `repo` is "cabbage", `todo` is "all", `num` is "in the". All four are
    // real Portuguese dictionary entries, so the lexicon test alone cannot clear them.
    for (const w of ['cli', 'repo', 'todo', 'num']) expect(isPortuguese(w)).toBe(false)
  })
})

describe('T0.1 — identifiers are split before they are judged', () => {
  it('test_camel_case_is_split_into_words', () => {
    expect([...wordParts('varrerMarkdownComGuardas')]).toEqual([
      'varrer',
      'markdown',
      'com',
      'guardas',
    ])
  })

  it('test_screaming_snake_case_is_split_into_words', () => {
    expect([...wordParts('THREAD_PADRAO')]).toEqual(['thread', 'padrao'])
  })
})

describe('Detector 6 — Portuguese PROSE in a comment, but not a Portuguese QUOTATION', () => {
  it('test_portuguese_prose_in_a_comment_is_flagged', () => {
    // The real defect this closes: seven lines of Portuguese sat in `tools/build-cli.mjs` explaining
    // why `proper-lockfile` stays external, and every detector was blind to it because comments were
    // exempt wholesale.
    expect(portugueseInComments('// o lock desligado e corrida silenciosa')).toContain('desligado')
  })

  it('test_a_backtick_quotation_of_portuguese_is_not_flagged', () => {
    // ANTI-VACUITY FLOOR, and the reason the exemption existed at all. A JSDoc block legitimately
    // quotes the Portuguese it explains — all four surviving citations in `packages/` are inside a
    // backtick span. Flagging the quotation would make the check fire on correct code.
    expect(
      portugueseInComments('// the old code did `perfis = layer.profiles` and that was the bug'),
    ).toEqual([])
  })

  it('test_an_english_comment_is_not_flagged', () => {
    // Second anti-vacuity floor: flagging every comment would satisfy the first assertion.
    expect(portugueseInComments('// the team receives what the ROOT resolved')).toEqual([])
  })

  it('test_a_jsdoc_continuation_line_is_scanned_too', () => {
    // Block comments continue with ` * `, and that line carries no `//` or `/*` marker.
    //
    // Asserts on `desligado`, not `corrida`: "corrida" is in the ENGLISH dictionary (the loanword
    // for a bullfight), so the lexicon correctly clears it. Getting that wrong once is how a test
    // ends up pinning the tester's assumption instead of the code's behaviour.
    expect(portugueseInComments(' * o lock desligado e corrida silenciosa')).toContain('desligado')
  })

  it('test_a_line_that_is_not_a_comment_is_ignored', () => {
    // Identifiers are detector 3's job; double-reporting the same word twice is noise.
    expect(portugueseInComments('const x = 1')).toEqual([])
  })
})

describe('B-065 — the detector looks at every module extension the repos use', () => {
  it('test_mts_and_cts_are_scanned', () => {
    // The hole this closes was not hypothetical: two Portuguese EXPORTS lived in a `.mts` file in
    // the framework and this detector reported clean on every run until a manual grep found them.
    // A guard that silently skips a file type reports absence of evidence as evidence of absence.
    for (const ext of ['.mts', '.cts']) {
      expect(
        EXTS.has(ext),
        `${ext} is not scanned — a Portuguese identifier there is invisible`,
      ).toBe(true)
    }
  })

  it('test_the_extensions_a_typescript_repo_can_use_are_all_covered', () => {
    // Anti-vacuity floor: asserting only the two above would pass a list that had lost `.ts`.
    for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs']) {
      expect(EXTS.has(ext), `${ext} is not scanned`).toBe(true)
    }
  })
})

/**
 * B-084 — the Portuguese POSSESSIVE construction, not a list of sixteen words.
 *
 * Sixteen identifiers shipped built on `Do`/`Da`/`De` and every detector here reported the tree
 * clean. Correctly: the identifier scan decides per WORD, and `do`, `da` and `de` are all in
 * `/usr/share/hunspell/en_US.dic`. Each word was declined right and the construction survived —
 * B-083's blind spot in another hat. Renaming the sixteen without this leaves the seventeenth to
 * be found by eye, which is how they lasted this long.
 */
describe('B-084 — the Portuguese possessive construction', () => {
  it('test_flags_the_construction_in_both_casings', () => {
    for (const name of [
      'pluginDeHooks',
      'propsDoSlot',
      'timelineDaTui',
      'specsDosHooks',
      'TOOLS_DO_REVIEWER',
      'OPT_OUT_DE_ENV',
    ]) {
      expect(portugueseConstruction(name), name).toBe(true)
    }
  })

  it('test_does_not_flag_english_identifiers', () => {
    // The false-positive floor, scored BEFORE this landed. A guard that cries wolf is what this
    // file's own docstring says killed version one — and `do` opens plenty of English names.
    for (const name of [
      'doSomething',
      'undo',
      'redoLayout',
      'DOM_ELEMENT',
      'readFile',
      'DEFAULT_MODE',
      'decodeUrl',
      'daemonStart',
      'encodeProjectDir',
    ]) {
      expect(portugueseConstruction(name), name).toBe(false)
    }
  })
})

describe('T7 — bare Portuguese function words used as identifiers', () => {
  // The gap this closes, measured on 2026-09-10: `fork: (de, para) => forkSession(de, para)`
  // shipped in packages/tui/src/agent-session/composition-root.ts:125 and the guard reported
  // `english-only: clean`, exit 0.
  //
  // The mechanism is not a missing word. `isPortuguese` short-circuits on `EN.words.has(w)`, and
  // BOTH words are in the English lexicons the guard loads — `de` in all three
  // (/usr/share/dict/words, /usr/share/hunspell/en_US.dic, /usr/share/dict/american-english) and
  // `para` in en_US.dic. They are outside the rule the guard implements, so no denylist entry
  // could reach them; adding one would also be the goalpost-moving that
  // rules/english-only.md § Anti-patterns forbids.
  //
  // Detector 6 (portugueseConstruction) already exists for the neighbouring shape —
  // `pluginDeHooks`, where the same words hide inside a compound. This is the other shape: the
  // function word standing ALONE as a whole identifier.
  //
  // Why a PAIR and not a single word. rules/english-only.md § "Detection is precise, not
  // exhaustive" makes a deliberate call: `para`, `de` and `com` are NOT matched in prose,
  // because "the first thing anyone does with a noisy gate is turn it off". That call is right
  // and this must not reverse it. `para` alone is a real English identifier — the standard
  // abbreviation for paragraph, `para.textContent`. Two bare Portuguese function words on one
  // line is not ambiguous: it is someone naming parameters in Portuguese.

  it('test_a_portuguese_parameter_pair_is_flagged', () => {
    expect(portugueseIdentifierPair('fork: (de, para) => forkSession(de, para)')).toBe(true)
  })

  it('test_other_portuguese_pairs_are_flagged', () => {
    for (const line of [
      'const copy = (origem, destino) => move(origem, destino)',
      'function run(com, sem) { return com }',
    ]) {
      expect(portugueseIdentifierPair(line), line).toBe(true)
    }
  })

  it('test_a_lone_ambiguous_word_is_not_flagged', () => {
    // `para` for paragraph and `de` inside a name are the false positives the pair rule exists
    // to avoid. Flagging these is what makes a guard get switched off.
    for (const line of [
      'const para = document.createElement("p")',
      'para.textContent = title',
      'const decoded = decode(mode, data)',
      'export function parameters(mode) { return mode }',
    ]) {
      expect(portugueseIdentifierPair(line), line).toBe(false)
    }
  })

  it('test_english_code_is_never_flagged', () => {
    // Anti-vacuity floor: a detector that flags everything passes the tests above.
    for (const line of [
      'fork: (from, to) => forkSession(from, to)',
      'const merge = (source, target) => ({ ...source, ...target })',
      'function compare(first, second) { return first < second }',
    ]) {
      expect(portugueseIdentifierPair(line), line).toBe(false)
    }
  })

  it('test_the_words_must_be_whole_identifiers', () => {
    // Substring matching is what would turn `parameters`/`decode`/`comment` into violations.
    expect(portugueseIdentifierPair('const comment = decodeParams(mode)')).toBe(false)
  })

  it('test_prose_is_left_to_the_prose_detectors', () => {
    // A comment is stripped before the identifier scan; this detector must not reach into it,
    // or it reverses the documented decision to tolerate these words in prose.
    expect(portugueseIdentifierPair('// mapeia de origem para destino')).toBe(false)
  })
})
