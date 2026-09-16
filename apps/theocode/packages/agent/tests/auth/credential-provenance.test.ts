/**
 * Finding #46 — credential provenance, at 0% of 30 lines and named by no test in the tree.
 *
 * This module answers WHERE the credential the session is running under came from. `credentialSource()`
 * (`packages/tui/src/agent-session/credential-helpers.ts:24`) renders its answer in the footer, so the
 * user can tell an account login from a pasted API key from a value their `.env` set. Four files in
 * `src/auth/` are at 100% and this one was at zero.
 *
 * The failure mode it guards against is a WRONG label rather than a crash: telling someone their key
 * came from `.env` when it came from the shell (or the reverse) sends them to edit the wrong place
 * while the real source keeps winning. `dotenvNames` is the whole basis of that distinction — the
 * footer says `(.env)` if and only if the variable's name is in the set this function returns.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { describeSource, dotenvNames } from '../../src/auth/credential-provenance.js'

let dir: string
let envPath: string

/** Write a `.env` and return the names the reader harvests from it. */
function namesIn(contents: string): string[] {
  writeFileSync(envPath, contents)
  return [...dotenvNames(envPath)].sort()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theocode-provenance-'))
  envPath = join(dir, '.env')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the names a .env file declares', () => {
  it('test_dotenv_names_does_not_harvest_a_name_from_inside_a_multiline_value', () => {
    // Anti-vacuity floor, and the case that would actually mislead someone: a line that LOOKS like
    // an assignment but sits inside a quoted value is not a declaration. Harvesting it makes the
    // footer report `ANTHROPIC_API_KEY (.env)` for a key the shell supplied, and the user edits a
    // file that is not the source. A reader that scanned every line for `=` — the obvious
    // implementation — passes every other assertion in this file and fails this one.
    const names = namesIn('NOTE="first line\nANTHROPIC_API_KEY=not-a-declaration\nlast line"\n')

    expect(names, 'a name inside a quoted value was read as a declaration').toEqual(['NOTE'])
  })

  it('test_dotenv_names_is_empty_when_the_file_does_not_exist', () => {
    // The common case — most projects have no `.env` — and it must be "nothing declared here",
    // never a throw: this runs at module load in `credential-helpers.ts:9`.
    expect([...dotenvNames(join(dir, 'absent'))]).toEqual([])
  })

  it('test_dotenv_names_collects_plain_assignments', () => {
    expect(namesIn('ANTHROPIC_API_KEY=sk-ant-x\nOPENAI_API_KEY=sk-y\n')).toEqual([
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
    ])
  })

  it('test_dotenv_names_strips_the_export_prefix_and_surrounding_space', () => {
    // `export FOO=bar` is how a `.env` meant to be `source`d is written, and the name is `FOO`.
    expect(namesIn('export A=1\n  export  B =2\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_ignores_comments_blank_lines_and_lines_with_no_name', () => {
    expect(namesIn('# a comment\n\n=VALUE_WITH_NO_NAME\nNO_EQUALS_SIGN\nGOOD=y\n')).toEqual(['GOOD'])
  })

  it('test_dotenv_names_rejects_a_name_that_is_not_an_identifier', () => {
    // `1BAD` cannot be an environment variable, so a credential can never arrive through it;
    // accepting it would put a name in the set that no `varName` will ever match.
    expect(namesIn('1BAD=x\nGOOD=y\n')).toEqual(['GOOD'])
  })

  it('test_dotenv_names_reads_the_declaration_after_a_quoted_value_closed_on_its_own_line', () => {
    // A quote that opens and closes on one line is not multiline, and the next line is a normal
    // declaration. Treating it as multiline would swallow everything below it.
    expect(namesIn('A="one line"\nB=2\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_resumes_after_a_multiline_value_that_closes_with_content', () => {
    expect(namesIn('A="first\nmiddle\nlast"\nB=2\n')).toEqual(['A', 'B'])
    expect(namesIn("A='first\nlast'\nB=2\n")).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_reads_a_crlf_file', () => {
    // `.env` files authored on Windows, and the reason the split is `/\r?\n/`.
    expect(namesIn('A=1\r\nB=2\r\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_stops_at_an_unterminated_quote', () => {
    // Nothing closes the value, so every following line belongs to it. Guessing otherwise would
    // invent declarations out of a malformed file.
    expect(namesIn('A="never closed\nB=2\n')).toEqual(['A'])
  })

  it('test_dotenv_names_keeps_the_declarations_after_a_value_closed_by_a_lone_quote', () => {
    // `closesQuote` served two questions with one implementation, and only one of them wanted the
    // leading quote stripped. On the line that OPENS a value, stripping is what tells `"one line"`
    // (closed) from `"still` (open). On a CONTINUATION line it is wrong: a line that is just `"`
    // has its only quote removed and reads as "still open", so the scan swallowed the rest of the
    // file — every declaration below a value closed in the conventional style was lost, and the
    // footer reported `(shell)` for a variable the `.env` declares.
    //
    // Two questions, two predicates. This case was pinned as `loses` on 2026-09-10 by the change
    // that covered this file, and fixed the same day.
    expect(namesIn('A="first\nmiddle\n"\nB=2\n')).toEqual(['A', 'B'])
  })

  it('test_a_value_that_opens_and_closes_on_one_line_does_not_swallow_the_next', () => {
    // Anti-vacuity, and the arm that keeps the strip where it belongs: dropping it from the OPENING
    // line would make `"one line"` read as unterminated and eat `B` — the same data loss, entering
    // from the other side.
    expect(namesIn('A="one line"\nB=2\n')).toEqual(['A', 'B'])
  })
})

describe('the label a credential source is given', () => {
  const dotenvPath = '/proj/.env'

  it('test_describe_source_says_shell_when_the_variable_is_not_in_the_dotenv_file', () => {
    // Anti-vacuity floor for this half: a labeller hard-wired to `(.env)` — or one that ignored the
    // declared set — passes the `.env` assertion below and fails this one. It is also the direction
    // that wastes the user's time, sending them to edit a file that is not the source.
    const label = describeSource({ kind: 'env', varName: 'ANTHROPIC_API_KEY' }, new Set(), dotenvPath)

    expect(label, 'a shell variable was attributed to the .env file').toBe(
      'ANTHROPIC_API_KEY (shell)',
    )
  })

  it('test_describe_source_names_the_dotenv_file_when_the_variable_is_declared_there', () => {
    const label = describeSource(
      { kind: 'env', varName: 'ANTHROPIC_API_KEY' },
      new Set(['ANTHROPIC_API_KEY']),
      dotenvPath,
    )

    expect(label).toBe(`ANTHROPIC_API_KEY (${dotenvPath})`)
  })

  it('test_describe_source_names_the_provider_of_an_oauth_session_and_carries_no_token', () => {
    const label = describeSource({ kind: 'oauth', provider: 'anthropic' }, new Set(), dotenvPath)

    expect(label).toBe('oauth (anthropic)')
    // The type carries the provider name and nothing else, and this is the surface that renders it.
    // A label is printed to a terminal and copied into bug reports; a token must never reach it.
    expect(label).not.toMatch(/sk-|Bearer|[A-Za-z0-9_-]{32,}/)
  })

  it('test_describe_source_returns_the_path_of_a_file_credential', () => {
    const path = '/home/someone/.theocode/auth.json'

    // A stored credential is identified by WHERE it is, and the `.env` set has no bearing on it.
    expect(describeSource({ kind: 'file', path }, new Set(['ANYTHING']), dotenvPath)).toBe(path)
  })
})
