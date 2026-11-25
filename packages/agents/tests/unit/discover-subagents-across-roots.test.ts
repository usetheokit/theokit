import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveTrustPosture } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { discoverSubagentsAcrossRoots } from '../../src/config/operator-roots.js'

let cwd: string
let home: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'across-cwd-'))
  home = mkdtempSync(join(tmpdir(), 'across-home-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

function role(root: string, name: string, description: string, dir = '.theokit'): void {
  mkdirSync(join(root, dir, 'agents'), { recursive: true })
  writeFileSync(
    join(root, dir, 'agents', `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`,
  )
}

const posture = (trusted: boolean) =>
  resolveTrustPosture({ capabilities: ['projectSettings'] as const, isTrusted: () => trusted })

describe('discoverSubagentsAcrossRoots', () => {
  it('returns both roots with their origins', async () => {
    role(home, 'reviewer', 'op')
    role(cwd, 'builder', 'proj')
    const { definitions } = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: { trustedBy: posture(true) },
    })
    expect(definitions.reviewer?.origin).toBe('operator')
    expect(definitions.builder?.origin).toBe('project')
  })

  it('reads only the operator root when the project is untrusted, and names the withheld one', async () => {
    role(home, 'reviewer', 'op')
    role(cwd, 'builder', 'proj')
    const { definitions, withheld } = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: { trustedBy: posture(false) },
    })
    expect(Object.keys(definitions)).toEqual(['reviewer'])
    expect(withheld.map((w) => w.root)).toEqual([join(cwd, '.theokit', 'agents')])
  })

  it('reads no project root when project is false', async () => {
    role(cwd, 'builder', 'proj')
    const { definitions } = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: false,
    })
    expect(definitions).toEqual({})
  })

  it('lets the project win a name clash', async () => {
    role(home, 'shared', 'from operator')
    role(cwd, 'shared', 'from project')
    const { definitions } = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: { trustedBy: posture(true) },
    })
    expect(definitions.shared?.origin).toBe('project')
    expect(definitions.shared?.description).toBe('from project')
  })

  it('withholds ~/.claude/agents unless the operator grants claude-code', async () => {
    role(home, 'foreign', 'x', '.claude')
    const denied = await discoverSubagentsAcrossRoots({ cwd, homeDir: home, project: false })
    expect(denied.definitions).toEqual({})
    expect(denied.withheld.map((w) => w.root)).toEqual([join(home, '.claude', 'agents')])

    const granted = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: false,
      compatSources: { operator: [{ kind: 'claude-code', import: ['subagents'] }] },
    })
    expect(Object.keys(granted.definitions)).toEqual(['foreign'])
    expect(granted.withheld).toEqual([])
  })

  it('returns the operator definition a project one replaced as shadowed', async () => {
    role(home, 'shared', 'from operator')
    role(cwd, 'shared', 'from project')
    const { shadowed } = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: { trustedBy: posture(true) },
    })
    expect(shadowed.shared?.origin).toBe('operator')
    expect(shadowed.shared?.description).toBe('from operator')
  })

  it('treats a trusted project without .theokit/agents as empty, with nothing withheld', async () => {
    role(home, 'reviewer', 'op')
    const { definitions, withheld } = await discoverSubagentsAcrossRoots({
      cwd,
      homeDir: home,
      project: { trustedBy: posture(true) },
    })
    expect(Object.keys(definitions)).toEqual(['reviewer'])
    expect(withheld).toEqual([])
  })

  it('reads a directory that is both home and project once, as the project, and withholds nothing', async () => {
    role(home, 'solo', 'x')
    const untrusted = await discoverSubagentsAcrossRoots({
      cwd: home,
      homeDir: home,
      project: { trustedBy: posture(false) },
    })
    expect(untrusted.definitions.solo?.origin).toBe('operator')
    expect(untrusted.withheld).toEqual([])

    const trusted = await discoverSubagentsAcrossRoots({
      cwd: home,
      homeDir: home,
      project: { trustedBy: posture(true) },
    })
    expect(trusted.definitions.solo?.origin).toBe('project')
  })
})
