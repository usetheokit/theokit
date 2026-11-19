import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Agent } from '@theokit/sdk'
import type { ImportedSetup } from '../src/migration/import-store.js'
import { theoClawAgentOptions, withSdkSkills, type TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { startModelStub, type ModelStub } from './model-stub.js'

const skillFile = (name: string, body: string, key = '', bins = '') =>
  `---\nname: ${name}\ndescription: ${name} skill\n${bins === '' ? '' : `${key}: ${bins}\n`}---\n${body}\n`

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, 'SKILL.md'), text)
  }
  return dir
}

const stubs: ModelStub[] = []
afterEach(async () => {
  for (const stub of stubs.splice(0)) await stub.close()
})

type Extra = { approvedHooks?: ReadonlySet<string>; pluginWorkspace?: string; userSkillsDir?: string; custodian?: boolean; imported?: { setup: ImportedSetup; mcp: boolean } }

/** What the model is sent in the first request of one turn, with the real SDK reading `skillsDir` (and the rest). */
async function firstRequest(skillsDir: string, extra: Extra = {}): Promise<string> {
  const stub = await startModelStub([{ text: 'ok' }])
  stubs.push(stub)
  const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir, ...extra })
  const agent = await Agent.create(withSdkSkills(options) as never)
  try {
    await (await agent.send('hello')).wait()
  } finally {
    await agent[Symbol.asyncDispose]()
  }
  return JSON.stringify(stub.requests[0])
}

async function skillRead(options: TheoClawAgentOptions, name: string): Promise<string> {
  const tool = options.tools?.find((t) => t.name === 'skill_read')
  return JSON.stringify(await (tool?.handler as unknown as (input: unknown, ctx: unknown) => unknown)({ name }, {}))
}

const importOf = (...skills: Array<{ name: string; description: string; instructions: string }>): { setup: ImportedSetup; mcp: boolean } => ({
  setup: { instructions: '', memory: '', mcpServers: {}, skills } as unknown as ImportedSetup,
  mcp: false,
})

function withBin(bin: string): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'bin-'))
  writeFileSync(join(dir, bin), '#!/bin/sh\n')
  chmodSync(join(dir, bin), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${dir}${delimiter}${path ?? ''}`
  return () => {
    process.env.PATH = path
  }
}

describe('skills through the SDK (OC-70..72, OC-74)', () => {
  it('offers the bundled skills', async () => {
    const text = await firstRequest(dirWith({}))
    expect(text).toContain('summarize-text')
    expect(text).toContain('git-helper')
  })

  it('offers git-helper only while git is on PATH', async () => {
    const path = process.env.PATH
    const empty = mkdtempSync(join(tmpdir(), 'nobin-'))
    try {
      process.env.PATH = empty
      const without = await firstRequest(dirWith({}))
      expect(without).toContain('summarize-text')
      expect(without).not.toContain('git-helper')
    } finally {
      process.env.PATH = path
    }
    const restore = withBin('git')
    try {
      expect(await firstRequest(dirWith({}))).toContain('git-helper')
    } finally {
      restore()
    }
  })

  it('with the project source on, the SDK reads only our folders: a project skill cannot shadow the workspace one', async () => {
    const cwd = dirWith({})
    mkdirSync(join(cwd, '.theokit', 'skills', 'dup'), { recursive: true })
    writeFileSync(join(cwd, '.theokit', 'skills', 'dup', 'SKILL.md'), skillFile('dup', 'p').replace('dup skill', 'PROJECT-DESCRIPTION'))
    const workspace = dirWith({ dup: skillFile('dup', 'w').replace('dup skill', 'WORKSPACE-DESCRIPTION') })
    const text = await firstRequest(workspace, { approvedHooks: new Set(['fingerprint']), pluginWorkspace: cwd })
    expect(text).toContain('WORKSPACE-DESCRIPTION')
    expect(text).not.toContain('PROJECT-DESCRIPTION')
  })

  it('with the project source on, a legacy skill in a project root is not offered ungated', async () => {
    const cwd = dirWith({})
    mkdirSync(join(cwd, '.theokit', 'skills', 'ungated'), { recursive: true })
    writeFileSync(join(cwd, '.theokit', 'skills', 'ungated', 'SKILL.md'), skillFile('ungated', 'p', 'requires', 'theoclaw-no-such-bin'))
    const text = await firstRequest(dirWith({}), { approvedHooks: new Set(['fingerprint']), pluginWorkspace: cwd })
    expect(text).not.toContain('ungated skill')
  })

  it('offers a requires-bins skill only while its binary is on PATH', async () => {
    const dir = dirWith({ needy: skillFile('needy', 'x', 'requires-bins', 'theoclaw-fake-bin') })
    expect(await firstRequest(dir)).not.toContain('needy skill')
    const restore = withBin('theoclaw-fake-bin')
    try {
      expect(await firstRequest(dir)).toContain('needy skill')
    } finally {
      restore()
    }
  })

  it('lets a workspace skill override a bundled one, and a user skill sit between them', async () => {
    const workspace = dirWith({ 'summarize-text': skillFile('summarize-text', 'w').replace('summarize-text skill', 'WORKSPACE-DESCRIPTION') })
    const user = dirWith({ 'summarize-text': skillFile('summarize-text', 'u').replace('summarize-text skill', 'USER-DESCRIPTION'), 'git-helper': skillFile('git-helper', 'u').replace('git-helper skill', 'USER-GIT') })
    const text = await firstRequest(workspace, { userSkillsDir: user })
    expect(text).toContain('WORKSPACE-DESCRIPTION')
    expect(text).not.toContain('USER-DESCRIPTION')
    expect(text).toContain('USER-GIT')
    expect(text).not.toContain('Inspect repository state')
  })

  it('keeps a skill with the old requires: key working: offered with its binary, hidden without, warned by file', async () => {
    const dir = dirWith({ old: skillFile('old', 'x', 'requires', 'theoclaw-legacy-bin') })
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(await firstRequest(dir)).not.toContain('old skill')
      const restore = withBin('theoclaw-legacy-bin')
      try {
        expect(await firstRequest(dir)).toContain('old skill')
      } finally {
        restore()
      }
      const warnings = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('deprecated'))
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(join(dir, 'old', 'SKILL.md'))
      expect(warnings[0]).toContain('requires-bins')
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps what the SDK parsed from a legacy skill: disable-model-invocation still hides it', async () => {
    const restore = withBin('theoclaw-hidden-bin')
    try {
      const file = skillFile('quiet', 'x', 'requires', 'theoclaw-hidden-bin').replace('---\nname', '---\ndisable-model-invocation: true\nname')
      expect(await firstRequest(dirWith({ quiet: file }))).not.toContain('quiet skill')
    } finally {
      restore()
    }
  })

  it('decides a name clash on the skills the SDK accepts: an invalid workspace skill does not hide a legacy user skill from its gate', async () => {
    const workspace = dirWith({ dup: '---\nname: dup\n---\nno description, so the SDK skips it\n' })
    const user = dirWith({ dup: skillFile('dup', 'x', 'requires', 'theoclaw-no-such-bin') })
    expect(await firstRequest(workspace, { userSkillsDir: user })).not.toContain('dup skill')
  })

  it('matches an import against the declared skill name, not the folder name', async () => {
    const workspace = dirWith({ other: skillFile('dup', 'workspace body') })
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: workspace, imported: importOf({ name: 'dup', description: 'imported', instructions: 'imported body' }) })
    expect(await skillRead(options, 'dup')).toContain('workspace body')
    const invalid = dirWith({ dup: '---\nname: dup\n---\nbroken\n' })
    const kept = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: invalid, imported: importOf({ name: 'dup', description: 'imported', instructions: 'imported body' }) })
    expect(await skillRead(kept, 'dup')).toContain('imported body')
  })

  it('lets a workspace skill replace a custodian skill of the same name', async () => {
    const text = await firstRequest(dirWith({ 'diagnose-gateway': skillFile('diagnose-gateway', 'x').replace('diagnose-gateway skill', 'WORKSPACE-DIAGNOSE') }), { custodian: true })
    expect(text).toContain('WORKSPACE-DIAGNOSE')
  })

  it('has skill_read refuse a skill whose binary is missing', async () => {
    const dir = dirWith({ needy: skillFile('needy', 'NEEDY-BODY', 'requires-bins', 'theoclaw-fake-bin'), ok: skillFile('ok', 'OK-BODY') })
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: dir })
    expect(await skillRead(options, 'ok')).toContain('OK-BODY')
    expect(await skillRead(options, 'needy')).not.toContain('NEEDY-BODY')
    expect(await skillRead(options, 'nope')).not.toContain('needy')
  })
})
