import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Agent } from '@theokit/sdk'
import type { StoredForeignImport } from '@theokit/agents/foreign-setup'
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

type Extra = { approvedHooks?: ReadonlySet<string>; pluginWorkspace?: string; userSkillsDir?: string; custodian?: boolean; imported?: { setup: StoredForeignImport; mcp: boolean } }

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

const importOf = (...skills: Array<{ name: string; description: string; instructions: string }>): { setup: StoredForeignImport; mcp: boolean } => ({
  setup: { instructions: '', memory: '', mcpServers: {}, skills } as unknown as StoredForeignImport,
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

  it.each([
    ['project', ['.theokit', 'skills']],
    ['plugin', ['.theokit', 'plugins', 'acme', 'skills']],
  ])('with the project source on, a legacy skill in a %s root is gated, warned by file and readable only with its binary', async (_label, parts) => {
    const cwd = dirWith({})
    const root = join(cwd, ...parts)
    mkdirSync(join(root, 'legacy-root'), { recursive: true })
    if (parts.includes('plugins')) writeFileSync(join(root, '..', 'plugin.json'), JSON.stringify({ name: 'acme', version: '1.0.0' }))
    const file = join(root, 'legacy-root', 'SKILL.md')
    writeFileSync(file, skillFile('legacy-root', 'ROOT-BODY', 'requires', 'theoclaw-root-bin'))
    const extra = { approvedHooks: new Set(['fingerprint']), pluginWorkspace: cwd }
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(await firstRequest(dirWith({}), extra)).not.toContain('legacy-root skill')
      const options = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: dirWith({}), ...extra })
      expect(await skillRead(options, 'legacy-root')).not.toContain('ROOT-BODY')
      const restore = withBin('theoclaw-root-bin')
      try {
        expect(await firstRequest(dirWith({}), extra)).toContain('legacy-root skill')
        expect(await skillRead(options, 'legacy-root')).toContain('ROOT-BODY')
      } finally {
        restore()
      }
      const warnings = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('deprecated'))
      expect(warnings.some((line) => line.includes(file))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('with the project source on, keeps the compat sources .theokit/config.json lists: their skills are gated and the SDK keeps loading their hooks and plugins', async () => {
    const cwd = dirWith({})
    mkdirSync(join(cwd, '.theokit'), { recursive: true })
    mkdirSync(join(cwd, '.claude', 'skills', 'foreign'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'skills', 'foreign', 'SKILL.md'), skillFile('foreign', 'FOREIGN-BODY', 'requires-bins', 'theoclaw-foreign-bin'))
    writeFileSync(join(cwd, '.theokit', 'config.json'), JSON.stringify({ compat: { adapters: ['claude-code'] } }))
    const extra = { approvedHooks: new Set(['fingerprint']), pluginWorkspace: cwd }
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: dirWith({}), ...extra })
    expect(options.local).not.toHaveProperty('compatSources')
    expect(await skillRead(options, 'foreign')).not.toContain('FOREIGN-BODY')
    expect(await firstRequest(dirWith({}), extra)).not.toContain('foreign skill')
    const restore = withBin('theoclaw-foreign-bin')
    try {
      expect(await skillRead(options, 'foreign')).toContain('FOREIGN-BODY')
      expect(await firstRequest(dirWith({}), extra)).toContain('foreign skill')
    } finally {
      restore()
    }
  })

  it('with the project source on, offers a plugin skill added between two turns of the same agent', async () => {
    const cwd = dirWith({})
    const stub = await startModelStub([{ text: 'one' }, { text: 'two' }])
    stubs.push(stub)
    const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir: dirWith({}), approvedHooks: new Set(['f']), pluginWorkspace: cwd })
    const agent = await Agent.create(withSdkSkills(options) as never)
    try {
      await (await agent.send('hello')).wait()
      const root = join(cwd, '.theokit', 'plugins', 'acme', 'skills')
      mkdirSync(join(root, 'late-plugin'), { recursive: true })
      writeFileSync(join(root, '..', 'plugin.json'), JSON.stringify({ name: 'acme', version: '1.0.0' }))
      writeFileSync(join(root, 'late-plugin', 'SKILL.md'), skillFile('late-plugin', 'LATE-BODY'))
      await (await agent.send('again')).wait()
    } finally {
      await agent[Symbol.asyncDispose]()
    }
    expect(JSON.stringify(stub.requests[0])).not.toContain('late-plugin skill')
    expect(JSON.stringify(stub.requests[1])).toContain('late-plugin skill')
  })

  it('with the project source on, a workspace skill beats a user skill, which beats a project skill', async () => {
    const cwd = dirWith({})
    mkdirSync(join(cwd, '.theokit', 'skills', 'dup'), { recursive: true })
    writeFileSync(join(cwd, '.theokit', 'skills', 'dup', 'SKILL.md'), skillFile('dup', 'PROJECT-BODY'))
    const user = dirWith({ dup: skillFile('dup', 'USER-BODY') })
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: dirWith({}), userSkillsDir: user, approvedHooks: new Set(['f']), pluginWorkspace: cwd })
    expect(await skillRead(options, 'dup')).toContain('USER-BODY')
  })

  it('warns for the old requires: key even when requires-bins is also set, or the key is empty', async () => {
    const dir = dirWith({
      both: '---\nname: both\ndescription: both skill\nrequires-bins: sh\nrequires: sh\n---\nbody\n',
      blank: '---\nname: blank\ndescription: blank skill\nrequires:\n---\nbody\n',
    })
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await firstRequest(dir)
      const warnings = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('deprecated'))
      expect(warnings.some((line) => line.includes(join(dir, 'both', 'SKILL.md')))).toBe(true)
      expect(warnings.some((line) => line.includes(join(dir, 'blank', 'SKILL.md')))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('has skill_read refuse a skill whose binary name holds a path separator, as the SDK gate does', async () => {
    const dir = dirWith({ sneaky: skillFile('sneaky', 'SNEAKY-BODY', 'requires-bins', '../../bin/sh') })
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'stub-key', skillsDir: dir })
    expect(await skillRead(options, 'sneaky')).not.toContain('SNEAKY-BODY')
  })

  it('does not offer a skill whose required binary is absent, and offers it once present', async () => {
    const dir = dirWith({ needy: skillFile('needy', 'x', 'requires-bins', 'theoclaw-fake-bin') })
    expect(await firstRequest(dir)).not.toContain('needy skill')
    const restore = withBin('theoclaw-fake-bin')
    try {
      expect(await firstRequest(dir)).toContain('needy skill')
    } finally {
      restore()
    }
  })

  it('lets a workspace skill override a bundled one of the same name', async () => {
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
