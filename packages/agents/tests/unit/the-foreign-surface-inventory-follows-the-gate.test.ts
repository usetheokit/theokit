import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverSkills } from '@theokit/sdk/skills'
import { discoverSubagents } from '@theokit/sdk/subagents-loader'
import { describe, expect, it } from 'vitest'

import { foreignSurfaceInventory } from '../../src/bridge/index.js'
import {
  EVERY_SURFACE,
  FOREIGN_FOLDERS,
  SURFACE_FOLDERS,
  surfaceOfFolder,
} from '../../src/bridge/setting-sources-gate.js'
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
    expect(warnings[0]?.startsWith(`${join('.claude', 'workflows')}: found 2`)).toBe(true)
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

  it('every folder the gate declares follows its surface in enabled', () => {
    const cwd = project()
    for (const surface of EVERY_SURFACE) {
      for (const dir of SURFACE_FOLDERS[surface]) {
        const only = foreignSurfaceInventory({ cwd, enabled: [surface] }).find((e) => e.dir === dir)
        const none = foreignSurfaceInventory({ cwd, enabled: [] }).find((e) => e.dir === dir)
        expect(only?.state).toBe('read')
        expect(none?.state).toBe('refused')
      }
    }
  })

  it('admission is whatever the gate lists: a listed folder is read, an unlisted one refused', () => {
    for (const surface of EVERY_SURFACE) {
      for (const dir of SURFACE_FOLDERS[surface]) expect(surfaceOfFolder(dir)).toBe(surface)
    }
    expect(new Set(FOREIGN_FOLDERS).size).toBe(FOREIGN_FOLDERS.length)
    expect(FOREIGN_FOLDERS).toContain('workflows')
    expect(surfaceOfFolder('workflows')).toBeUndefined()
  })

  it('a surface the gate does not know cannot make a folder read', () => {
    const cwd = project()
    const found = foreignSurfaceInventory({
      cwd,
      enabled: ['nonsense' as unknown as 'commands'],
    }).find((e) => e.dir === 'commands')
    expect(found?.state).toBe('refused')
  })

  it('skills fence rules match the SDK at the boundaries', async () => {
    const cwd = project()
    const fixtures: Record<string, string> = {
      'leading-space': ' ---\ndescription: x\n---\nbody',
      'leading-newline': '\n---\ndescription: x\n---\nbody',
      crlf: '---\r\ndescription: x\r\n---\r\nbody',
      'no-newline-after-close': '---\ndescription: x\n---',
      'blank-after-open': '---   \ndescription: x\n---  \nbody',
      'empty-block': '---\n---\nbody',
    }
    for (const [name, text] of Object.entries(fixtures)) put(cwd, `skills/${name}/SKILL.md`, text)
    const sdk = await discoverSkills(join(cwd, '.claude', 'skills'))
    expect(entry(cwd, 'skills').count).toBe(sdk.length)
    expect(sdk.map((k) => k.name).sort((a, b) => a.localeCompare(b))).toContain('crlf')
  })

  it('commands skips an unclosed frontmatter and follows symlinks like the loader', () => {
    const cwd = project()
    put(cwd, 'commands/ok.md', '---\ndescription: ok\n---\nGo')
    put(cwd, 'commands/plain.md', 'no frontmatter at all')
    put(cwd, 'commands/unclosed.md', '---\ndescription: never closes\nGo')
    put(cwd, 'elsewhere/linked.md', 'x')
    symlinkSync(
      join(cwd, '.claude', 'elsewhere', 'linked.md'),
      join(cwd, '.claude', 'commands', 'link.md'),
    )
    symlinkSync(join(cwd, '.claude', 'elsewhere'), join(cwd, '.claude', 'commands', 'dir'))
    expect(entry(cwd, 'commands').count).toBe(4)
  })

  it('a named pipe where a definition belongs does not block the inventory or the reporter', () => {
    const cwd = project()
    mkdirSync(join(cwd, '.claude', 'skills', 's'), { recursive: true })
    mkdirSync(join(cwd, '.claude', 'agent-memory', 'a'), { recursive: true })
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- test fixture, fixed argv
    execFileSync('mkfifo', [join(cwd, '.claude', 'skills', 's', 'SKILL.md')])
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- test fixture, fixed argv
    execFileSync('mkfifo', [join(cwd, '.claude', 'agent-memory', 'a', 'MEMORY.md')])
    expect(entry(cwd, 'agent-memory').unreadable).toEqual(['agent-memory/a/MEMORY.md'])
    expect(entry(cwd, 'skills').unreadable).toEqual(['skills/s/SKILL.md'])
    const warnings: string[] = []
    reportUnloadedSurfaces({ cwd, onWarn: (w) => warnings.push(w) })
    expect(warnings).toEqual([])
  })

  it('rules counts top-level .md files, the pattern the instruction loader reads', () => {
    const cwd = project()
    put(cwd, 'rules/style.md', '# style')
    put(cwd, 'rules/notes.txt', 'x')
    put(cwd, 'rules/nested/deep.md', '# deep')
    expect(entry(cwd, 'rules')).toMatchObject({ state: 'read', count: 1, unreadable: [] })
    expect(entry(cwd, 'rules', ['skills']).state).toBe('refused')
  })

  it('agents skips a definition carrying a Claude Code runtime field, as the SDK does', () => {
    const cwd = project()
    put(cwd, 'agents/ok.md', '---\nname: ok\ndescription: x\n---\nbody')
    put(cwd, 'agents/perm.md', '---\nname: p\ndescription: x\npermissionMode: plan\n---\nbody')
    put(cwd, 'agents/hooked.md', '---\nname: h\ndescription: x\nhooks:\n  - a\n---\nbody')
    expect(entry(cwd, 'agents').count).toBe(1)
  })

  it.skipIf(process.getuid?.() === 0)(
    'commands lists entries of a folder that lists but cannot be searched',
    () => {
      const cwd = project()
      put(cwd, 'commands/ok.md', '---\ndescription: ok\n---\nGo')
      put(cwd, 'commands/locked/inner.md', '---\ndescription: x\n---\nGo')
      put(cwd, 'commands/locked/other.md', '---\ndescription: x\n---\nGo')
      const locked = join(cwd, '.claude', 'commands', 'locked')
      chmodSync(locked, 0o444)
      try {
        const commands = entry(cwd, 'commands')
        expect(commands.count).toBe(1)
        expect(commands.unreadable).toEqual([
          'commands/locked/inner.md',
          'commands/locked/other.md',
        ])
      } finally {
        chmodSync(locked, 0o755)
      }
    },
  )

  it('agents treats comment lines in frontmatter the way the SDK parser does', async () => {
    const cwd = project()
    put(cwd, 'agents/plain.md', '---\nname: plain\n# reviewed twice\ndescription: x\n---\nbody')
    put(cwd, 'agents/colon.md', '---\nname: colon\n# note: reviewed\ndescription: x\n---\nbody')
    const loaded: string[] = []
    for (const name of ['plain', 'colon']) {
      const dir = project()
      put(dir, 'agents/a.md', readFileSync(join(cwd, '.claude', 'agents', `${name}.md`), 'utf8'))
      // The SDK keeps a `# note: x` line as a field named `# note` and refuses the agent.
      const found = await discoverSubagents(dir, {
        settingSources: ['project'],
        compatSources: ['claude-code'],
      }).then(
        (all) => Object.keys(all).length,
        () => 0,
      )
      if (found === 1) loaded.push(`${name}.md`)
    }
    expect(loaded).toEqual(['plain.md'])
    expect(entry(cwd, 'agents').count).toBe(loaded.length)
  })
})
