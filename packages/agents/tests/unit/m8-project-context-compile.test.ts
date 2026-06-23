import 'reflect-metadata'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { ProjectContext, getProjectContextConfig } from '../../src/decorators/project-context.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import {
  compileProjectContext,
  projectContextMetadataOnlyKnobs,
} from '../../src/bridge/compile-project-context.js'

// Minimal SystemPromptContext — only `cwd` is read by the resolver.
function ctx(cwd: string | undefined) {
  return {
    agentId: 'test',
    cwd,
    model: undefined,
    skills: [],
    userMessage: '',
    memory: [],
  } as unknown as Parameters<ReturnType<typeof compileProjectContext>>[0]
}

describe('compileProjectContext (M8-2)', () => {
  let repo: string
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'm8-proj-'))
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture' }))
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('test_project_context_resolver_prepends_repo_map', async () => {
    const resolver = compileProjectContext({}, 'BASE_PROMPT')
    const out = await resolver(ctx(repo))
    expect(out).toContain('BASE_PROMPT')
    expect(out).toContain('package.json') // repo map lists the root marker
  })

  it('test_project_context_resolver_no_cwd_returns_base', async () => {
    const resolver = compileProjectContext({}, 'ONLY_BASE')
    const out = await resolver(ctx(undefined))
    expect(out).toBe('ONLY_BASE')
  })

  it('test_project_context_missing_instructions_is_safe', async () => {
    // repo has no THEO.md — resolver must not throw, still returns env+map+base
    const resolver = compileProjectContext({}, 'B')
    const out = await resolver(ctx(repo))
    expect(out).toContain('B')
    expect(typeof out).toBe('string')
  })

  it('test_project_context_unsupported_knobs_metadata_only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    @Agent({ name: 'pc', route: '/pc' })
    @ProjectContext({ indexStrategy: 'tree-sitter' })
    class Pc {
      @MainLoop()
      async run() {}
    }
    walkAgentMetadata(Pc)
    const hits = warn.mock.calls.filter((c) =>
      String(c[0]).includes('THEO_AGENT_PROJECT_CONTEXT_KNOB_METADATA_ONLY'),
    )
    expect(hits).toHaveLength(1)
  })

  it('test_project_context_metadata_only_knobs_listed', () => {
    const knobs = projectContextMetadataOnlyKnobs({
      indexStrategy: 'tree-sitter',
      maxFilesInContext: 5,
    })
    expect(knobs).toContain('indexStrategy')
    expect(knobs).toContain('maxFilesInContext')
  })

  it('test_project_context_options_shape_unchanged', () => {
    @Agent({ name: 's', route: '/s' })
    @ProjectContext({ maxFilesInContext: 3 })
    class S {
      @MainLoop()
      async run() {}
    }
    const cfg = getProjectContextConfig(S)!
    expect(cfg).toHaveProperty('rootMarkers')
    expect(cfg).toHaveProperty('ignorePatterns')
  })
})
