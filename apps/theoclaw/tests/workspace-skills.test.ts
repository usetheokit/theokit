import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { agentOptionsFor, createAgentFactory, type CreateAgent } from '../src/control-plane/agent-factory.js'
import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import type { ImportedSetup } from '../src/migration/import-store.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-skills-'))
  dirs.push(dir)
  return dir
}

function skill(root: string, name: string, body: string, extra = ''): void {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: About ${name}.\n${extra}---\n${body}\n`)
}

async function readBody(options: { tools?: Array<{ name: string; handler: (...a: never[]) => unknown }> }, name: string): Promise<string> {
  const tool = options.tools?.find((t) => t.name === 'skill_read')
  expect(tool).toBeDefined()
  return JSON.stringify(await (tool?.handler as (input: unknown, ctx: unknown) => unknown)({ name }, {}))
}

describe('workspace skills (OC-70)', () => {
  it('offers workspace and user skills with a skill_read that returns the body, no import', async () => {
    const workspace = tmp()
    const home = tmp()
    skill(join(workspace, 'skills'), 'canary-word', 'reply with exactly ZEBRA-7731')
    skill(join(home, '.theoclaw', 'skills'), 'canary-word', 'user version')
    skill(join(home, '.theoclaw', 'skills'), 'from-user', 'user only')
    skill(join(workspace, 'skills'), 'needs-missing', 'x', 'requires: no-such-binary-xyz\n')
    const env = { THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', THEOCLAW_WORKSPACE: workspace, HOME: home }
    const options = agentOptionsFor(env)
    expect(options.skills?.inline.map((s) => s.name).sort()).toEqual(['canary-word', 'from-user'])
    expect(await readBody(options as never, 'canary-word')).toContain('ZEBRA-7731')
    expect(await readBody(options as never, 'from-user')).toContain('user only')
  })

  it('reaches the /control agent through createAgentFactory', async () => {
    const workspace = tmp()
    skill(join(workspace, 'skills'), 'canary-word', 'reply with exactly ZEBRA-7731')
    let seen: unknown
    const create = ((options: unknown) => {
      seen = options
      return Promise.resolve({ send: () => Promise.reject(new Error('unused')), dispose: () => Promise.resolve() })
    }) as unknown as CreateAgent
    await createAgentFactory({ THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', THEOCLAW_WORKSPACE: workspace, HOME: tmp() }, create)()
    expect(await readBody(seen as never, 'canary-word')).toContain('ZEBRA-7731')
  })

  it('lets a workspace skill beat an imported one of the same name, and reads both', async () => {
    const workspace = tmp()
    skill(workspace, 'dup', 'workspace body')
    const setup = {
      instructions: '',
      memory: '',
      mcpServers: {},
      skills: [
        { name: 'dup', description: 'd', instructions: 'imported body' },
        { name: 'only-imported', description: 'd', instructions: 'imported only' },
      ],
    } as unknown as ImportedSetup
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'k', skillsDir: workspace, imported: { setup, mcp: false } })
    expect(options.skills?.inline.map((s) => s.name).sort()).toEqual(['dup', 'only-imported'])
    expect(await readBody(options as never, 'dup')).toContain('workspace body')
    expect(await readBody(options as never, 'only-imported')).toContain('imported only')
  })
})

describe('custodian skills (OC-137)', () => {
  it('are offered to the /control agent only, not to a chat agent', async () => {
    const env = { THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', HOME: tmp() }
    let seen: { skills?: { inline: Array<{ name: string }> } } = {}
    const create = ((options: typeof seen) => {
      seen = options
      return Promise.resolve({ dispose: () => Promise.resolve() })
    }) as unknown as CreateAgent
    await createAgentFactory(env, create, undefined, true)()
    expect(seen.skills?.inline.map((s) => s.name)).toEqual(
      expect.arrayContaining(['diagnose-gateway', 'add-model-provider', 'configure-channel', 'cloud-image-bake']),
    )
    expect(await readBody(seen as never, 'diagnose-gateway')).toContain('theoclaw doctor')
    expect(agentOptionsFor(env).skills).toBeUndefined()
    seen = {}
    await createAgentFactory(env, create)()
    expect(seen).not.toHaveProperty('skills')
  })
})
