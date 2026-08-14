import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { doctorCommand } from '../../packages/theo/src/cli/commands/doctor.js'

/**
 * M84 — `theokit doctor` composes the checks the framework knows.
 *
 * The mechanism (`diagnose`, `renderDiagnosis`, `secretPresence`) comes from
 * `@theokit/agents/doctor`; the LIST is here, because which things to check is what differs per
 * product.
 */

let projectRoot: string
const lines: string[] = []
const write = (text: string): void => {
  lines.push(text)
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'doctor-'))
  lines.length = 0
})
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('the credential check never prints a value', () => {
  it('test_a_present_key_is_reported_WITHOUT_its_value', async () => {
    // The rule the whole command rests on: this output is meant to be pasted into an issue.
    await doctorCommand({ projectRoot, env: { OPENAI_API_KEY: 'sk-VERYSECRET' }, write })
    const report = lines.join('\n')
    expect(report).toContain('OPENAI_API_KEY')
    expect(report).toContain('present')
    expect(report).not.toContain('sk-')
    expect(report).not.toContain('VERYSECRET')
  })

  it('test_no_credential_at_all_FAILS_and_says_what_to_do', async () => {
    const code = await doctorCommand({ projectRoot, env: {}, write })
    expect(code).not.toBe(0)
    expect(lines.join('\n')).toMatch(/theokit auth login|OPENAI_API_KEY/)
  })
})

describe('the mcp check distinguishes absent from broken', () => {
  it('test_no_mcp_file_is_a_WARNING_not_a_failure', async () => {
    // Most projects use no MCP server. Failing here would make a healthy install exit non-zero, and
    // CI would learn to ignore the command.
    const code = await doctorCommand({ projectRoot, env: { OPENAI_API_KEY: 'k' }, write })
    expect(code).toBe(0)
    expect(lines.join('\n')).toMatch(/no \.mcp\.json/)
  })

  it('test_an_UNPARSEABLE_mcp_file_is_a_failure', async () => {
    // The operator believes it is in effect. Reporting it as merely absent hides that belief.
    writeFileSync(join(projectRoot, '.mcp.json'), '{ broken', 'utf8')
    const code = await doctorCommand({ projectRoot, env: { OPENAI_API_KEY: 'k' }, write })
    expect(code).not.toBe(0)
    expect(lines.join('\n')).toMatch(/unreadable/)
  })

  it('test_a_valid_mcp_file_reports_how_many_servers', async () => {
    writeFileSync(
      join(projectRoot, '.mcp.json'),
      JSON.stringify({ mcpServers: { github: {}, linear: {} } }),
      'utf8',
    )
    await doctorCommand({ projectRoot, env: { OPENAI_API_KEY: 'k' }, write })
    expect(lines.join('\n')).toMatch(/2 server/)
  })
})

describe('subagents are part of "what will this installation do"', () => {
  it('test_defined_subagents_are_named', async () => {
    mkdirSync(join(projectRoot, '.theokit', 'agents'), { recursive: true })
    writeFileSync(
      join(projectRoot, '.theokit', 'agents', 'reviewer.md'),
      '---\nname: reviewer\ndescription: reviews\n---\nbody',
      'utf8',
    )
    await doctorCommand({ projectRoot, env: { OPENAI_API_KEY: 'k' }, write })
    expect(lines.join('\n')).toContain('reviewer')
  })
})

describe('a product composes its own checks on top', () => {
  it('test_extra_checks_appear_and_can_fail_the_run', async () => {
    // The list is the product's. Absorbing it would make this a framework for one app.
    const code = await doctorCommand({
      projectRoot,
      env: { OPENAI_API_KEY: 'k' },
      write,
      extraChecks: [{ name: 'my-thing', status: 'fail', detail: 'not wired' }],
    })
    expect(code).not.toBe(0)
    expect(lines.join('\n')).toContain('my-thing')
  })
})
