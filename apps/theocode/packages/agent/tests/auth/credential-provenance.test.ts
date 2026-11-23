/**
 * Credential provenance: WHERE the credential the session runs under came from, rendered in the footer.
 * The failure mode is a WRONG label: telling someone their key came from `.env` when the shell
 * supplied it. The label says `(.env)` only for a key the bootstrap's project-env step loaded.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { describeSource } from '../../src/auth/credential-provenance.js'
import { bootstrapSurface } from '../../src/bootstrap/bootstrap-surface.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Write a `.env` and return the names the bootstrap's project-env step loaded from it (the framework parser). */
async function namesIn(contents: string | undefined): Promise<string[]> {
  const cwd = mkdtempSync(join(tmpdir(), 'theocode-provenance-'))
  dirs.push(cwd)
  if (contents !== undefined) writeFileSync(join(cwd, '.env'), contents)
  const ctx = await bootstrapSurface({ env: {}, cwd, home: cwd, onWarn: () => {} })
  return [...(ctx.projectEnv?.loaded ?? [])].sort()
}

describe('the names a .env file declares, as the bootstrap loads them', () => {
  it('test_dotenv_names_does_not_harvest_a_name_from_inside_a_multiline_value', async () => {
    expect(
      await namesIn('NOTE="first line\nANTHROPIC_API_KEY=not-a-declaration\nlast line"\n'),
    ).toEqual(['NOTE'])
  })

  it('test_dotenv_names_is_empty_when_the_file_does_not_exist', async () => {
    expect(await namesIn(undefined)).toEqual([])
  })

  it('test_dotenv_names_collects_plain_assignments', async () => {
    expect(await namesIn('ANTHROPIC_API_KEY=sk-ant-x\nOPENAI_API_KEY=sk-y\n')).toEqual([
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
    ])
  })

  it('test_dotenv_names_strips_the_export_prefix_and_surrounding_space', async () => {
    expect(await namesIn('export A=1\n  export  B =2\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_ignores_comments_blank_lines_and_lines_with_no_name', async () => {
    expect(await namesIn('# a comment\n\n=VALUE_WITH_NO_NAME\nNO_EQUALS_SIGN\nGOOD=y\n')).toEqual([
      'GOOD',
    ])
  })

  it('test_dotenv_names_accepts_a_name_that_is_not_an_identifier', async () => {
    // Framework parser (looser than the old one): `1BAD` is loaded; no credential varName can match it.
    // Stricter name checking is follow-up #2812.
    expect(await namesIn('1BAD=x\nGOOD=y\n')).toEqual(['1BAD', 'GOOD'])
  })

  it('test_dotenv_names_reads_the_declaration_after_a_quoted_value_closed_on_its_own_line', async () => {
    expect(await namesIn('A="one line"\nB=2\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_resumes_after_a_multiline_value_that_closes_with_content', async () => {
    expect(await namesIn('A="first\nmiddle\nlast"\nB=2\n')).toEqual(['A', 'B'])
    expect(await namesIn("A='first\nlast'\nB=2\n")).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_reads_a_crlf_file', async () => {
    expect(await namesIn('A=1\r\nB=2\r\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_does_not_let_an_unterminated_quote_swallow_the_lines_below', async () => {
    // Framework parser (looser than the old one, which stopped at A): B is still loaded.
    expect(await namesIn('A="never closed\nB=2\n')).toEqual(['A', 'B'])
  })

  it('test_dotenv_names_keeps_the_declarations_after_a_value_closed_by_a_lone_quote', async () => {
    expect(await namesIn('A="first\nmiddle\n"\nB=2\n')).toEqual(['A', 'B'])
  })

  it('test_a_value_that_opens_and_closes_on_one_line_does_not_swallow_the_next', async () => {
    expect(await namesIn('A="one line"\nB=2\n')).toEqual(['A', 'B'])
  })
})

describe('the label a credential source is given', () => {
  const dotenvPath = '/proj/.env'

  it('test_describe_source_says_shell_when_the_variable_is_not_in_the_dotenv_file', () => {
    // Anti-vacuity floor for this half: a labeller hard-wired to `(.env)` — or one that ignored the
    // declared set — passes the `.env` assertion below and fails this one. It is also the direction
    // that wastes the user's time, sending them to edit a file that is not the source.
    const label = describeSource(
      { kind: 'env', varName: 'ANTHROPIC_API_KEY' },
      new Set(),
      dotenvPath,
    )

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
