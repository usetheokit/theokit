/**
 * Tests for the typed-error-assertion guard.
 *
 * The guard sits in the `npm run lint` chain and had none — measured 2026-09-10. It is the sharpest
 * instance of the class, because this checker's whole job is to catch a test that reports green
 * while guarding nothing, and it was itself a gate that could have been reporting green while
 * inspecting nothing. A checker that mis-globs, throws early, or matches no line still exits 0, and
 * a green build is read as evidence.
 *
 * The first two tests are the poles: a line that MUST be flagged, and one that MUST NOT. Without
 * the second, a regex broadened until it matches everything still passes; without the first, a
 * regex narrowed into a no-op does. Both failures have happened in this repository's guards before
 * — the English-only one reported clean over 144 identifiers — which is why the anti-vacuity floor
 * is a convention here rather than a nicety.
 */
import { describe, expect, it } from 'vitest'

import {
  ROOTS,
  SELF,
  isBareThrowAssertion,
  isTestFile,
  scan,
  testFilesUnder,
} from './check-typed-error-assertions.mjs'

describe('isBareThrowAssertion', () => {
  it('test_a_bare_toThrow_is_flagged', () => {
    // The measured case: config/memory-default.test.ts asserted that a non-boolean is rejected
    // and would have kept passing if the rejection decayed into a TypeError.
    expect(isBareThrowAssertion('expect(() => load(cfg)).toThrow()')).toBe(true)
  })

  it('test_a_typed_assertion_is_not_flagged', () => {
    // Anti-vacuity floor. A guard that flags every `toThrow` passes the test above and makes the
    // correct form impossible to write.
    for (const line of [
      'expect(() => load(cfg)).toThrow(ConfigError)',
      "expect(() => load(cfg)).toThrow(/must be a boolean/)",
      'await expect(run()).rejects.toThrow(TurnError)',
    ]) {
      expect(isBareThrowAssertion(line), line).toBe(false)
    }
  })

  it('test_bare_toThrowError_is_flagged_too', () => {
    expect(isBareThrowAssertion('expect(fn).toThrowError()')).toBe(true)
  })

  it('test_rejects_toThrow_is_flagged', () => {
    expect(isBareThrowAssertion('await expect(p).rejects.toThrow()')).toBe(true)
  })

  it('test_not_toThrow_is_never_flagged', () => {
    // Documented in the guard's header: there is no error to name when the assertion is that none
    // arrives. Flagging it would demand a type for a thing that does not exist.
    expect(isBareThrowAssertion('expect(() => ok()).not.toThrow()')).toBe(false)
  })

  it('test_a_line_that_only_talks_about_the_bare_form_is_not_an_assertion', () => {
    // This guard's own prose, and any comment explaining why an assertion was tightened, contain
    // the literal it looks for. Flagging them makes the check fire on the documentation of its
    // own rule — the false positive that gets a guard deleted.
    for (const line of [
      '// a bare toThrow() is satisfied by any throw',
      ' * `expect(fn).toThrow()` is satisfied by ANY throw',
    ]) {
      expect(isBareThrowAssertion(line), line).toBe(false)
    }
  })

  it('test_whitespace_inside_the_call_does_not_hide_it', () => {
    // `toThrow( )` is the same assertion. A guard that can be evaded by a space is one that
    // reports clean while the contract it protects is gone.
    expect(isBareThrowAssertion('expect(fn).toThrow(  )')).toBe(true)
  })
})

/**
 * The other half of the guard: WHICH files the predicate is applied to.
 *
 * The seven tests above are all single-line predicate cases, and a predicate is worth exactly the
 * file set it runs over. Measured 2026-09-10: `ROOTS` declared `tools` while the test pattern was
 * `/\.test\.tsx?$/`, and every test file under `tools/` is `.mjs` — eleven of them — so the
 * declared root contributed ZERO files on every run. A bare `toThrow()` written in a tools test
 * was invisible while the identical assertion in `packages/` was flagged.
 *
 * A guard that walks a directory and finds nothing is indistinguishable from one that walks it and
 * finds nothing wrong. Only a test over the walk can tell them apart, and none existed.
 */
describe('file discovery', () => {
  it('test_a_mjs_test_file_is_discovered_under_a_declared_root', () => {
    // This file is itself the case: `tools/` is a declared root and every test in it is `.mjs`.
    // Deliberately asserted against the real tree rather than a fixture — the defect was that the
    // declared scope and the real one had drifted apart, which a fixture cannot see.
    const found = [...testFilesUnder('tools')]
    expect(found).toContain('tools/check-typed-error-assertions.test.mjs')
  })

  it('test_every_declared_root_contributes_at_least_one_file', () => {
    // The anti-vacuity floor for the CONFIGURATION. A root that can never match is a scope nobody
    // is scanning while the header says otherwise; silence from it is not evidence.
    for (const root of ROOTS) {
      expect([...testFilesUnder(root)].length, `declared root: ${root}`).toBeGreaterThan(0)
    }
  })

  it('test_a_non_test_source_file_is_not_discovered', () => {
    // The floor in the other direction: a pattern broadened until it matches every file would
    // pass both tests above while making the scan a whole-repository grep.
    const found = [...testFilesUnder('tools')]
    expect(found).not.toContain('tools/check-typed-error-assertions.mjs')
  })

  it('test_the_test_file_pattern_accepts_the_extensions_this_repository_writes_tests_in', () => {
    for (const name of ['a.test.ts', 'a.test.tsx', 'a.test.mjs', 'a.test.cjs']) {
      expect(isTestFile(name), name).toBe(true)
    }
    for (const name of ['a.ts', 'a.mjs', 'test.md', 'a.test.md', 'atest.mjs']) {
      expect(isTestFile(name), name).toBe(false)
    }
  })
})

/**
 * The self-exemption, which the scope widening made necessary and which must stay narrow.
 *
 * A guard whose test file necessarily writes the form it detects will flag its own fixtures the
 * moment it can read them. Exempting the two files by NAME is the local precedent
 * (`check-english-only.mjs` does the same, for the same sentence). Exempting by pattern would be
 * how the guard quietly stops covering `tools/` a second time.
 */
describe('self-exemption', () => {
  it('test_the_guards_own_files_do_not_flag_their_own_fixtures', () => {
    const ownHits = scan(['tools']).found.filter((f) =>
      f.startsWith('tools/check-typed-error-assertions'),
    )
    expect(ownHits).toEqual([])
  })

  it('test_the_exemption_covers_only_this_guards_two_files', () => {
    // The anti-vacuity floor for the exemption itself: a set that grew would silence real files.
    expect([...SELF].sort()).toEqual([
      'tools/check-typed-error-assertions.mjs',
      'tools/check-typed-error-assertions.test.mjs',
    ])
  })

  it('test_an_exempt_file_is_still_discovered_by_the_walk', () => {
    // The exemption belongs to the scan, not to discovery. Hiding these files from the walk would
    // make the walk's own test — the one that catches a dead root — assert against a doctored set.
    expect([...testFilesUnder('tools')]).toContain('tools/check-typed-error-assertions.test.mjs')
  })
})
