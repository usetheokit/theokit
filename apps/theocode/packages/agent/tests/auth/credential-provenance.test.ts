/**
 * Credential provenance: WHERE the credential the session runs under came from, rendered in the footer.
 * The failure mode is a WRONG label: telling someone their key came from `.env` when the shell
 * supplied it. The label says `(.env)` only for a key the bootstrap's project-env step loaded.
 */
import { describe, expect, it } from 'vitest'

import { describeSource } from '../../src/auth/credential-provenance.js'

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
