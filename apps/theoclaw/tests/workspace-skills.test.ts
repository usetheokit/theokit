import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { agentOptionsFor } from '../src/control-plane/agent-factory.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('workspace skills (OC-70)', () => {
  it('offers <workspace>/skills/<name>/SKILL.md to every agent without an import', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-skills-'))
    dirs.push(workspace)
    mkdirSync(join(workspace, 'skills', 'canary-word'), { recursive: true })
    writeFileSync(join(workspace, 'skills', 'canary-word', 'SKILL.md'), '---\nname: canary-word\ndescription: The canary word.\n---\nreply with exactly ZEBRA-7731\n')
    const env = { THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', THEOCLAW_WORKSPACE: workspace }
    const skills = agentOptionsFor(env).skills?.inline ?? []
    expect(skills.map((skill) => skill.name)).toEqual(['canary-word'])
    expect(agentOptionsFor({ THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k' }).skills).toBeUndefined()
  })
})
