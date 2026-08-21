/**
 * A planted symlink does not redirect a scaffolded write.
 *
 * CodeQL flags this package's writes under `js/insecure-temporary-file`, seven of them high
 * severity. The finding is narrower than the rule's name and it is real: the scaffolder writes
 * predictably-named files into `resolve(process.cwd(), projectName)`, so somebody running
 * `npx create-theokit myapp` from a world-writable directory can have a symlink waiting at one of
 * those names.
 *
 * The test writes the attack rather than describing it. The negative case matters as much as the
 * positive one: `wx` would also refuse the symlink, and would break the four sites that legitimately
 * overwrite a file the scaffolder just produced — so "refuses a symlink" alone does not distinguish
 * the right fix from the one that breaks `--bare`.
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeScaffoldFile } from '../../src/write-file.js'

describe('writeScaffoldFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scaffold-write-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_creates_a_file_that_does_not_exist', () => {
    writeScaffoldFile(join(dir, 'a.txt'), 'one')

    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one')
  })

  it('test_overwrites_a_file_the_scaffolder_already_wrote', () => {
    // The case `wx` would have broken: `bare-transform.ts` rewrites the `package.json` it read, and
    // materialising a `.tmpl` writes its destination. Both overwrite by design.
    const p = join(dir, 'package.json')
    writeScaffoldFile(p, '{"a":1}')
    writeScaffoldFile(p, '{"a":2}')

    expect(readFileSync(p, 'utf8')).toBe('{"a":2}')
  })

  it('test_truncates_rather_than_appending', () => {
    const p = join(dir, 'a.txt')
    writeScaffoldFile(p, 'longer original')
    writeScaffoldFile(p, 'short')

    expect(readFileSync(p, 'utf8')).toBe('short')
  })

  it('test_a_planted_symlink_is_refused_and_its_target_is_untouched', () => {
    const victim = join(dir, 'victim.txt')
    const planted = join(dir, 'package.json')
    writeFileSync(victim, 'original')
    symlinkSync(victim, planted)

    expect(() => writeScaffoldFile(planted, 'HIJACKED')).toThrow(
      expect.objectContaining({ code: 'ELOOP' }) as Error,
    )
    expect(readFileSync(victim, 'utf8')).toBe('original')
  })

  it('test_the_plain_api_would_have_followed_it', () => {
    // The counter-proof. Without it the assertion above could pass against a `writeScaffoldFile`
    // that refuses everything, and the test would not know the difference.
    const victim = join(dir, 'victim.txt')
    const planted = join(dir, 'package.json')
    writeFileSync(victim, 'original')
    symlinkSync(victim, planted)

    writeFileSync(planted, 'HIJACKED')

    expect(readFileSync(victim, 'utf8')).toBe('HIJACKED')
  })
})
