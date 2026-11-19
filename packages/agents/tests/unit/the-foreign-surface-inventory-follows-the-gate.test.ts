import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSkills } from '@theokit/sdk/skills'
import { describe, expect, it } from 'vitest'

import { foreignSurfaceInventory } from '../../src/bridge/index.js'
import { reportUnloadedSurfaces } from '../../src/bridge/unloaded-surfaces.js'

function project(): string {
  return mkdtempSync(join(tmpdir(), 'foreign-inventory-'))
}
function put(cwd: string, rel: string, text = ''): void {
  const path = join(cwd, '.claude', rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
function entry(
  cwd: string,
  dir: string,
  enabled?: Parameters<typeof foreignSurfaceInventory>[0]['enabled'],
) {
  const found = foreignSurfaceInventory({ cwd, ...(enabled !== undefined && { enabled }) }).find(
    (e) => e.dir === dir,
  )
  if (found === undefined) throw new Error(`no entry for ${dir}`)
  return found
}

describe('the foreign surface inventory follows the gate', () => {
  it('agents counts only top-level .md files with frontmatter', () => {
    const cwd = project()
    put(cwd, 'agents/reviewer.md', '---\nname: reviewer\ndescription: x\n---\nbody')
    put(cwd, 'agents/README.md', '# not an agent')
    put(cwd, 'agents/review-1/nested.md', '---\nname: n\n---\n')
    const agents = entry(cwd, 'agents')
    expect(agents).toMatchObject({ state: 'read', count: 1, unreadable: [] })
  })

  it('workflows is reported refused with its reason and a count of scripts', () => {
    const cwd = project()
    put(cwd, 'workflows/a.js')
    put(cwd, 'workflows/b.mjs')
    put(cwd, 'workflows/notes.txt')
    const workflows = entry(cwd, 'workflows')
    expect(workflows.state).toBe('refused')
    expect(workflows.count).toBe(2)
    expect(workflows.reason).toContain('a workflow file is code')
    const warnings: string[] = []
    reportUnloadedSurfaces({ cwd, onWarn: (w) => warnings.push(w) })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(workflows.reason)
  })

  it('plugins counts bundles that ship a skills folder', () => {
    const cwd = project()
    put(cwd, 'plugins/with-skills/skills/one/SKILL.md')
    put(cwd, 'plugins/without/plugin.json', '{}')
    expect(entry(cwd, 'plugins')).toMatchObject({ state: 'read', count: 1 })
  })

  it('an unreadable definition is listed in unreadable and does not throw', () => {
    const cwd = project()
    put(cwd, 'agent-memory/good/MEMORY.md', '# memory')
    // A directory where the file belongs: it exists, and reading it fails even for root.
    mkdirSync(join(cwd, '.claude', 'agent-memory', 'broken', 'MEMORY.md'), { recursive: true })
    const memory = entry(cwd, 'agent-memory')
    expect(memory.count).toBe(1)
    expect(memory.unreadable).toEqual(['agent-memory/broken/MEMORY.md'])
  })

  it('a surface left out of enabled is reported refused', () => {
    const cwd = project()
    put(cwd, 'commands/ship.md', '---\ndescription: ship\n---\nGo')
    expect(entry(cwd, 'commands', ['commands'])).toMatchObject({ state: 'read', count: 1 })
    const refused = entry(cwd, 'commands', ['skills'])
    expect(refused.state).toBe('refused')
    expect(refused.reason).toBeDefined()
    expect(entry(cwd, 'agents', ['skills']).state).toBe('refused')
  })

  it('skills counts what the SDK loader accepts', async () => {
    const cwd = project()
    put(cwd, 'skills/valid/SKILL.md', '---\nname: valid\ndescription: does a thing\n---\nbody')
    put(cwd, 'skills/no-description/SKILL.md', '---\nname: no-description\n---\nbody')
    put(cwd, 'skills/blank-description/SKILL.md', '---\ndescription:\n---\nbody')
    put(cwd, 'skills/no-frontmatter/SKILL.md', 'just text')
    put(cwd, 'skills/unclosed/SKILL.md', '---\ndescription: x\nbody')
    put(cwd, 'skills/bad-flag/SKILL.md', '---\ndescription: x\nuser-invocable: maybe\n---\nbody')
    const skills = entry(cwd, 'skills')
    const sdk = await discoverSkills(join(cwd, '.claude', 'skills'))
    expect(skills.count).toBe(sdk.length)
    expect(skills.count).toBe(1)
  })

  it('honours a different root', () => {
    const cwd = project()
    mkdirSync(join(cwd, '.other', 'agents'), { recursive: true })
    writeFileSync(join(cwd, '.other', 'agents', 'a.md'), '---\nname: a\n---\n')
    const found = foreignSurfaceInventory({ cwd, root: '.other' }).find((e) => e.dir === 'agents')
    expect(found?.count).toBe(1)
  })
})
