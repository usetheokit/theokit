/**
 * #72 — MCP servers that belong to the operator, not to the repository.
 *
 * Only `<project>/.mcp.json` was read, so an operator's own servers had to be declared again in every
 * repository they worked in — and could not be declared at all for a repository they do not own.
 * Claude Code, which this product is trying to be adoptable from, keeps personal servers in
 * `~/.claude.json` and applies them everywhere.
 *
 * Two decisions here are security decisions and are pinned as tests rather than left to prose:
 *
 * 1. The personal scope is NOT gated on project trust. That gate asks whether THIS REPOSITORY's code
 *    is trusted; the operator's own home is not the repository — the reasoning `user-agents-md.ts`
 *    sets out for the user instruction layer, which #65 established. Gating it would also make the
 *    feature useless for its main case: a repository you have not vouched for yet is exactly where
 *    you still want your own tools.
 * 2. On a name collision the PERSONAL definition wins. Project-wins would let a repository shadow a
 *    server the operator trusts by reusing its name with a different command — a hijack with no
 *    visible symptom. The shadowing attempt is warned about rather than silently dropped.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mcpServersFor } from '../src/mcp-scopes.js'

let home: string
let project: string

const TRUSTED = { allows: { mcp: true } } as Parameters<typeof mcpServersFor>[0]['posture']
const UNTRUSTED = { allows: { mcp: false } } as Parameters<typeof mcpServersFor>[0]['posture']

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-mcp-home-'))
  project = mkdtempSync(join(tmpdir(), 'theocode-mcp-proj-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

function declare(dir: string, name: string, command: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { [name]: { command, args: [] } } }),
  )
}

const noWarn = (): void => {}

describe('#72 — the personal MCP scope', () => {
  it('test_a_personal_server_is_started_in_a_project_that_declares_none', () => {
    declare(join(home, '.theokit'), 'mine', 'my-server')

    expect(Object.keys(mcpServersFor({ posture: TRUSTED, cwd: project, home, env: {}, onWarn: noWarn }).servers)).toEqual(
      ['mine'],
    )
  })

  it('test_both_scopes_are_started_together', () => {
    declare(join(home, '.theokit'), 'mine', 'my-server')
    declare(project, 'theirs', 'their-server')

    expect(
      Object.keys(mcpServersFor({ posture: TRUSTED, cwd: project, home, env: {}, onWarn: noWarn }).servers).sort(),
    ).toEqual(['mine', 'theirs'])
  })

  it('test_a_personal_server_still_runs_in_an_untrusted_directory', () => {
    declare(join(home, '.theokit'), 'mine', 'my-server')

    expect(
      Object.keys(mcpServersFor({ posture: UNTRUSTED, cwd: project, home, env: {}, onWarn: noWarn }).servers),
    ).toEqual(['mine'])
  })

  it('test_an_untrusted_project_server_is_still_withheld', () => {
    // The anti-vacuity floor for the test above: if the gate had simply stopped applying, that test
    // would pass for the wrong reason.
    declare(project, 'theirs', 'their-server')

    expect(
      Object.keys(mcpServersFor({ posture: UNTRUSTED, cwd: project, home, env: {}, onWarn: noWarn }).servers),
    ).toEqual([])
  })

  it('test_a_repository_cannot_shadow_a_personal_server_by_reusing_its_name', () => {
    declare(join(home, '.theokit'), 'shared', 'mine')
    declare(project, 'shared', 'theirs')

    const { servers } = mcpServersFor({ posture: TRUSTED, cwd: project, home, env: {}, onWarn: noWarn })
    expect((servers.shared as { command: string }).command).toBe('mine')
  })

  it('test_the_shadowing_attempt_is_said_out_loud', () => {
    declare(join(home, '.theokit'), 'shared', 'mine')
    declare(project, 'shared', 'theirs')
    const warnings: string[] = []

    mcpServersFor({ posture: TRUSTED, cwd: project, home, env: {}, onWarn: (w) => warnings.push(w) })

    expect(warnings.join('\n'), 'a dropped server was dropped in silence').toContain('shared')
  })

  it('test_the_personal_scope_follows_the_configured_root', () => {
    declare(join(home, '.claude'), 'mine', 'my-server')

    expect(
      Object.keys(
        mcpServersFor({
          posture: TRUSTED,
          cwd: project,
          home,
          env: { THEOKIT_HOME: join(home, '.claude') },
          onWarn: noWarn,
        }).servers,
      ),
    ).toEqual(['mine'])
  })

  it('test_a_broken_personal_file_does_not_take_the_project_down_with_it', () => {
    mkdirSync(join(home, '.theokit'), { recursive: true })
    writeFileSync(join(home, '.theokit', '.mcp.json'), '{ not json')
    declare(project, 'theirs', 'their-server')
    const warnings: string[] = []

    const { servers } = mcpServersFor({
      posture: TRUSTED,
      cwd: project,
      home,
      env: {},
      onWarn: (w) => warnings.push(w),
    })

    expect(Object.keys(servers), 'one bad file in the home silenced the whole project').toEqual([
      'theirs',
    ])
    expect(warnings.join('\n'), 'the unreadable file was not named').toContain('.mcp.json')
  })

  it('test_the_personal_names_are_reported_apart_from_the_project_ones', () => {
    // The wiring record needs them separately: the personal scope is not gated on project trust, so
    // reporting it through the gate says "not wired" about a server that is running.
    declare(join(home, '.theokit'), 'mine', 'my-server')
    declare(project, 'theirs', 'their-server')

    expect(
      mcpServersFor({ posture: TRUSTED, cwd: project, home, env: {}, onWarn: noWarn }).personal,
    ).toEqual(['mine'])
  })
})

describe('#72 — what trust withheld is named, never started', () => {
  it('test_a_withheld_project_server_is_reported_but_not_in_the_map', () => {
    // Measured before this existed: `suppressedByTrust` was ALWAYS false for MCP, because the flag
    // means "requested and refused" and the project's file was never read when refused. An operator
    // in an untrusted directory saw `mcp: none` with three servers declared, and nothing said why.
    declare(project, 'theirs', 'their-server')

    const result = mcpServersFor({
      posture: UNTRUSTED,
      cwd: project,
      home,
      env: {},
      onWarn: noWarn,
    })

    expect(Object.keys(result.servers), 'a withheld server reached the map').toEqual([])
    expect(result.projectWithheld, 'the withheld server was not named').toEqual(['theirs'])
  })

  it('test_a_trusted_project_withholds_nothing', () => {
    declare(project, 'theirs', 'their-server')

    const result = mcpServersFor({ posture: TRUSTED, cwd: project, home, env: {}, onWarn: noWarn })

    expect(result.projectWithheld).toEqual([])
    expect(Object.keys(result.servers)).toEqual(['theirs'])
  })
})
