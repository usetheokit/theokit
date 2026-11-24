import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveTrustPosture } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { declareAgentShape, applyCapabilities } from '../../src/capability/index.js'
import { codingAgentPreset, codingAgentTools } from '../../src/presets-entry.js'
import { ConfigurationError } from '../../src/errors.js'

const posture = (trusted: boolean) =>
  resolveTrustPosture<'projectSettings'>({
    capabilities: ['projectSettings'],
    isTrusted: () => trusted,
  })
const interactive = { start: () => undefined } as never
const names = (d: ReturnType<typeof applyCapabilities>) => d.tools.map((t) => t.name)
const base = { cwd: '/tmp/proj', posture: posture(true) }

describe('codingAgentPreset', () => {
  it('read-only has no write or shell tool, even with an interactive backend', () => {
    const d = applyCapabilities([
      codingAgentPreset({ ...base, sandboxMode: 'read-only', interactive }),
    ])
    expect(names(d)).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'GitDiff']))
    for (const n of ['ApplyPatch', 'Edit', 'Bash', 'interactive_shell', 'write_stdin']) {
      expect(names(d)).not.toContain(n)
    }
    expect(d.hitl).toBeUndefined()
  })

  it('workspace-write has write and shell tools, gated, with the built-in shell withheld', () => {
    const d = applyCapabilities([
      codingAgentPreset({ ...base, sandboxMode: 'workspace-write', interactive }),
    ])
    expect(names(d)).toEqual(
      expect.arrayContaining(['ApplyPatch', 'Edit', 'Bash', 'interactive_shell', 'write_stdin']),
    )
    expect([...(d.hitl?.keys() ?? [])].sort((a, b) => a.localeCompare(b))).toEqual(
      ['ApplyPatch', 'Bash', 'Edit', 'interactive_shell', 'write_stdin'].sort((a, b) =>
        a.localeCompare(b),
      ),
    )
    expect(d.withheldBuiltinTools).toEqual(['shell'])
  })

  it('omits interactive tools without a backend and overrides a gate question', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        sandboxMode: 'workspace-write',
        approvals: { Bash: { question: 'Run it?' } },
      }),
    ])
    expect(names(d)).not.toContain('interactive_shell')
    expect(d.hitl?.get('Bash')?.question).toBe('Run it?')
  })

  it('refuses an approval for a tool it did not register', () => {
    expect(() =>
      codingAgentPreset({
        ...base,
        sandboxMode: 'read-only',
        approvals: { Bash: { question: 'x' } },
      }),
    ).toThrow(ConfigurationError)
  })

  const project = {
    mcpServers: { files: { command: 'node' } },
    skills: ['review'],
    subagents: { helper: { description: 'h', prompt: 'p' } },
  } as never

  it('untrusted: no project MCP, skills, subagents or project setting source', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        posture: posture(false),
        sandboxMode: 'workspace-write',
        ...(project as object),
      }),
    ])
    expect(d.mcpServers).toBeUndefined()
    expect(d.skills).toBeUndefined()
    expect(d.subagents).toBeUndefined()
    expect(d.settingSources).toEqual(['user'])
  })

  it('trusted: loads them, and hooks stay refused unless a gate approves', async () => {
    const d = applyCapabilities([
      codingAgentPreset({ ...base, sandboxMode: 'workspace-write', ...(project as object) }),
    ])
    expect(d.mcpServers).toBeDefined()
    expect(d.skills?.enabled).toEqual(['review'])
    expect(d.settingSources).toEqual(['user', 'project'])
    expect(await d.hookApproval?.approve?.({} as never)).toBe(false)
  })

  const extra = (name: string) => ({ name }) as never

  it('registers caller web and delegation tools with default gates', () => {
    const d = applyCapabilities([
      codingAgentPreset({
        ...base,
        sandboxMode: 'workspace-write',
        webFetch: extra('web_fetch'),
        webSearch: extra('web_search'),
        delegateToTeam: extra('delegate_to_team'),
      }),
    ])
    expect(names(d)).toEqual(
      expect.arrayContaining(['web_fetch', 'web_search', 'delegate_to_team']),
    )
    expect(d.hitl?.has('web_fetch')).toBe(true)
    expect(d.hitl?.has('delegate_to_team')).toBe(true)
  })

  it('read-only keeps web tools but drops delegation, and says why', () => {
    const shape = declareAgentShape('a', [
      codingAgentPreset({
        ...base,
        sandboxMode: 'read-only',
        webFetch: extra('web_fetch'),
        delegateToTeam: extra('delegate_to_team'),
      }),
    ])
    const n = shape.tools.map((t) => t.name)
    expect(n).toContain('web_fetch')
    expect(n).not.toContain('delegate_to_team')
    expect(shape.offTools?.find((o) => o.name === 'delegate_to_team')?.reason).toMatch(/no writes/)
    expect(shape.offTools?.map((o) => o.name)).toContain('Bash')
  })

  it('reports interactive tools as off without a backend', () => {
    const shape = declareAgentShape('a', [
      codingAgentPreset({ ...base, sandboxMode: 'workspace-write' }),
    ])
    expect(shape.offTools).toEqual([
      { name: 'interactive_shell', reason: expect.stringMatching(/interactive backend/) },
      { name: 'write_stdin', reason: expect.stringMatching(/interactive backend/) },
    ])
  })

  describe('writeRoot, allowAbsolute and defaultTimeoutMs act on the tools', () => {
    type Handler = (input: Record<string, unknown>, ctx: never) => Promise<string>
    const run = (d: ReturnType<typeof applyCapabilities>, name: string, input: object) => {
      const tool = d.tools.find((t) => t.name === name)
      if (tool === undefined) throw new Error(`no ${name}`)
      return (tool.handler as unknown as Handler)(input as never, undefined as never).then(
        (r) => JSON.parse(r) as Record<string, unknown>,
      )
    }
    let project = ''
    let outside = ''
    beforeEach(() => {
      // The project sits inside `outside`: a write root must contain the directory it anchors.
      outside = mkdtempSync(join(tmpdir(), 'preset-outside-'))
      project = join(outside, 'project')
      mkdirSync(project)
    })
    afterEach(() => {
      rmSync(outside, { recursive: true, force: true })
    })
    const build = (extra: object) =>
      applyCapabilities([
        codingAgentPreset({
          cwd: project,
          posture: posture(true),
          sandboxMode: 'workspace-write',
          ...extra,
        }),
      ])
    const add = (path: string) => `*** Begin Patch\n*** Add File: ${path}\n+x\n*** End Patch`

    it('a relative write under a distinct writeRoot lands under cwd', async () => {
      const d = build({ writeRoot: '/' })
      expect(await run(d, 'ApplyPatch', { patch: add('hello.txt') })).toMatchObject({ ok: true })
      expect(readFileSync(join(project, 'hello.txt'), 'utf8')).toBe('x\n')
    })

    it('a write outside writeRoot is refused, and one inside it succeeds', async () => {
      const d = build({ writeRoot: outside })
      const target = join(outside, 'in.txt')
      expect(await run(d, 'ApplyPatch', { patch: add(target) })).toMatchObject({ ok: true })
      expect(readFileSync(target, 'utf8')).toBe('x\n')
      const refused = await run(d, 'ApplyPatch', { patch: add('/etc/theokit-nope.txt') })
      expect(refused.ok).not.toBe(true)
      expect(existsSync('/etc/theokit-nope.txt')).toBe(false)
    })

    it('without writeRoot an absolute write outside cwd is refused', async () => {
      const refused = await run(build({}), 'ApplyPatch', { patch: add(join(outside, 'x.txt')) })
      expect(refused.ok).not.toBe(true)
      expect(existsSync(join(outside, 'x.txt'))).toBe(false)
    })

    it('Read of an absolute path outside cwd works only with allowAbsolute', async () => {
      const file = join(outside, 'r.txt')
      writeFileSync(file, 'secret\n')
      expect(await run(build({ allowAbsolute: true }), 'Read', { path: file })).toMatchObject({
        ok: true,
      })
      expect((await run(build({}), 'Read', { path: file })).ok).not.toBe(true)
    })

    it('defaultTimeoutMs reaches Bash, and a call timeout overrides it', async () => {
      const seen: (number | undefined)[] = []
      const sandbox = {
        execute: (_c: string, o?: { timeoutMs?: number }) => {
          seen.push(o?.timeoutMs)
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0, timedOut: false })
        },
      }
      const d = build({ sandbox, defaultTimeoutMs: 1234 })
      await run(d, 'Bash', { command: 'true' })
      await run(d, 'Bash', { command: 'true', timeout_ms: 99 })
      expect(seen).toEqual([1234, 99])
    })
  })

  it('codingAgentTools exposes the effective gates, overrides included', () => {
    const { gates } = codingAgentTools({
      cwd: '/tmp/proj',
      sandboxMode: 'workspace-write',
      approvals: { Bash: { question: 'Run it?' } },
    })
    expect([...gates.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
      'ApplyPatch',
      'Bash',
      'Edit',
    ])
    expect(gates.get('Bash')?.question).toBe('Run it?')
    expect(codingAgentTools({ cwd: '/tmp/proj', sandboxMode: 'read-only' }).gates.size).toBe(0)
  })
})
