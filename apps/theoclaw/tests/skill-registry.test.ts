import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Agent } from '@theokit/sdk'
import { theoClawAgentOptions, withSdkSkills } from '../src/agent/create-agent.js'
import { legacyRequiresSkills } from '../src/skills/legacy-compat.js'
import { BUNDLED_SKILLS_DIR } from '../src/skills/registry.js'
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

/** What the model is told about the skills: the text of the first request of one turn. */
async function firstRequest(skillsDir: string, userSkillsDir?: string): Promise<string> {
  const stub = await startModelStub([{ text: 'ok' }])
  stubs.push(stub)
  const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir, ...(userSkillsDir === undefined ? {} : { userSkillsDir }) })
  const agent = await Agent.create(withSdkSkills(options) as never)
  try {
    await (await agent.send('hello')).wait()
  } finally {
    await agent[Symbol.asyncDispose]()
  }
  return JSON.stringify(stub.requests[0])
}

describe('skills through the SDK (OC-70..72, OC-74)', () => {
  it('offers the bundled skills, and git-helper declares its binary with requires-bins', async () => {
    const text = await firstRequest(dirWith({}))
    expect(text).toContain('summarize-text')
    expect(text).toContain('git-helper')
  })

  it('does not offer a skill whose requires-bins binary is absent, and offers it once present', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'bin-'))
    const dir = dirWith({ needy: skillFile('needy', 'x', 'requires-bins', 'theoclaw-fake-bin') })
    expect(await firstRequest(dir)).not.toContain('needy skill')

    writeFileSync(join(bin, 'theoclaw-fake-bin'), '#!/bin/sh\n')
    chmodSync(join(bin, 'theoclaw-fake-bin'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}${process.platform === 'win32' ? ';' : ':'}${path ?? ''}`
    try {
      expect(await firstRequest(dir)).toContain('needy skill')
    } finally {
      process.env.PATH = path
    }
  })

  it('lets a workspace skill override a bundled one, and a user skill sit between them', async () => {
    const workspace = dirWith({ 'summarize-text': skillFile('summarize-text', 'w').replace('summarize-text skill', 'WORKSPACE-DESCRIPTION') })
    const user = dirWith({ 'summarize-text': skillFile('summarize-text', 'u').replace('summarize-text skill', 'USER-DESCRIPTION'), 'git-helper': skillFile('git-helper', 'u').replace('git-helper skill', 'USER-GIT') })
    const text = await firstRequest(workspace, user)
    expect(text).toContain('WORKSPACE-DESCRIPTION')
    expect(text).not.toContain('USER-DESCRIPTION')
    expect(text).toContain('USER-GIT')
  })

  it('still gates a skill that uses the old requires: key, and warns naming the file', async () => {
    const dir = dirWith({ old: skillFile('old', 'x', 'requires', 'theoclaw-no-such-bin'), fine: skillFile('fine', 'x', 'requires-bins', 'sh') })
    const warnings: string[] = []
    const skills = legacyRequiresSkills([dir], (message) => warnings.push(message))
    expect(skills.map((s) => [s.name, s.requiresBins])).toEqual([['old', ['theoclaw-no-such-bin']]])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(join(dir, 'old', 'SKILL.md'))
    expect(warnings[0]).toContain('requires-bins')
    // Warned once per file, however many turns.
    legacyRequiresSkills([dir], (message) => warnings.push(message))
    expect(warnings).toHaveLength(1)

    const text = await firstRequest(dir)
    expect(text).not.toContain('old skill')
    expect(text).toContain('fine skill')
  })

  it('exposes the bundled folder shipped with the package', () => {
    expect(BUNDLED_SKILLS_DIR.endsWith('skills')).toBe(true)
  })
})
