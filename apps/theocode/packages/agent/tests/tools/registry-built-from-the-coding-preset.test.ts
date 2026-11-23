import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { REGISTRY_TOOL_NAMES, ToolRegistry } from '../../src/tools/registry.js'
import { resolveToolScope } from '../../src/tools/tool-scope.js'

/**
 * The registry builds its tools from `codingAgentTools` in `@theokit/agents/presets`. These pin what
 * the move must not change: the names and their order, the frozen tools, and the three options the
 * preset gained so this registry could adopt it — a write root apart from the project, absolute
 * reads, and the shell's default timeout.
 */
type Handler = (input: Record<string, unknown>, ctx: never) => Promise<string>
type Name = Parameters<ToolRegistry['get']>[0]

const call = async (registry: ToolRegistry, name: Name, input: object) =>
  JSON.parse(
    await (registry.get(name).handler as unknown as Handler)(input as never, undefined as never),
  ) as Record<string, unknown>

let outside: string
let project: string

beforeEach(() => {
  outside = mkdtempSync(join(tmpdir(), 'theocode-registry-'))
  project = join(outside, 'project')
  mkdirSync(project)
})
afterEach(() => rmSync(outside, { recursive: true, force: true }))

const registryFor = (mode: 'workspace-write' | 'danger-full-access' | 'read-only') =>
  new ToolRegistry(resolveToolScope({ sandbox_mode: mode } as never, project))

describe('the registry built from the coding preset', () => {
  it.each(['read-only', 'workspace-write', 'danger-full-access'] as const)(
    'holds exactly the registry tools, in order, all frozen, in %s',
    (mode) => {
      const registry = registryFor(mode)
      expect(registry.names()).toEqual([...REGISTRY_TOOL_NAMES])
      for (const name of REGISTRY_TOOL_NAMES) {
        expect(registry.get(name).name).toBe(name)
        expect(Object.isFrozen(registry.get(name))).toBe(true)
      }
    },
  )

  it('Read honours an absolute path outside the project', async () => {
    const file = join(outside, 'abs.txt')
    writeFileSync(file, 'far\n')
    expect(await call(registryFor('workspace-write'), 'Read', { path: file })).toMatchObject({
      ok: true,
    })
  })

  it('writes are confined to the write root: workspace-write refuses outside the project', async () => {
    const target = join(outside, 'no.txt')
    const result = await call(registryFor('workspace-write'), 'ApplyPatch', {
      patch: `*** Begin Patch\n*** Add File: ${target}\n+x\n*** End Patch`,
    })
    expect(result.ok).not.toBe(true)
  })

  it('a relative write under danger-full-access lands in the project, an absolute one outside', async () => {
    const registry = registryFor('danger-full-access')
    const add = (p: string) => `*** Begin Patch\n*** Add File: ${p}\n+x\n*** End Patch`
    expect(await call(registry, 'ApplyPatch', { patch: add('rel.txt') })).toMatchObject({
      ok: true,
    })
    expect(readFileSync(join(project, 'rel.txt'), 'utf8')).toBe('x\n')
    const far = join(outside, 'far.txt')
    expect(await call(registry, 'ApplyPatch', { patch: add(far) })).toMatchObject({ ok: true })
    expect(readFileSync(far, 'utf8')).toBe('x\n')
  })

  it('the scope default timeout reaches Bash', async () => {
    const seen: (number | undefined)[] = []
    const sandbox = {
      execute: (_c: string, o?: { timeoutMs?: number }) => {
        seen.push(o?.timeoutMs)
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0, timedOut: false })
      },
    }
    const scope = { ...resolveToolScope({ sandbox_mode: 'workspace-write' } as never, project) }
    const registry = new ToolRegistry({
      ...scope,
      sandbox: sandbox as never,
      defaultTimeoutMs: 777,
    })
    await call(registry, 'Bash', { command: 'true' })
    expect(seen).toEqual([777])
  })
})
