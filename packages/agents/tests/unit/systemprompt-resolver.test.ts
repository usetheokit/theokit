/**
 * V4-L.1 — `@Agent`'s systemPrompt accepts a per-request `SystemPromptResolver`
 * (Axis-B / COMPUTE of the two-axis dynamic-config design). The decorator and the
 * compile boundary must carry a resolver byref, the static string must still work
 * (backward compat), and `@ProjectContext` must COMPOSE with a resolver base
 * (resolve-then-prepend) rather than dropping it.
 *
 * RED proof: before the union widening, `@Agent({ systemPrompt: resolver })` and the
 * `expectTypeOf` assertions do not type-check (`npx tsc -p tsconfig.test.json` fails).
 */
import 'reflect-metadata'
import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import type { SystemPromptResolver, SystemPromptContext } from '@theokit/sdk'

import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { compileProjectContext } from '../../src/bridge/compile-project-context.js'
import type { AgentOptions } from '../../src/types.js'

// @ProjectContext composition does FS I/O via these optional peers — mock them so the
// compose tests are deterministic and never touch the real filesystem.
vi.mock('@theokit/sdk-tools', () => ({
  buildEnvContext: () => 'ENV',
  buildRepoMap: () => 'REPOMAP',
}))
vi.mock('@theokit/sdk/project', () => ({
  readProjectInstructions: async () => ({ content: 'INSTR' }),
}))

// The composed resolver only reads `ctx.cwd`; build a minimal SystemPromptContext
// (narrowing from unknown is the only permitted assertion per G3) for the call.
const mkCtx = (cwd?: string): SystemPromptContext => ({ cwd }) as unknown as SystemPromptContext

describe('V4-L.1 systemPrompt resolver', () => {
  it('test_agent_options_systemPrompt_accepts_resolver', () => {
    expectTypeOf<AgentOptions['systemPrompt']>().toEqualTypeOf<
      string | SystemPromptResolver | undefined
    >()
  })

  it('test_agent_options_systemPrompt_still_accepts_string', () => {
    // Backward compat: a plain string remains assignable.
    const s: AgentOptions['systemPrompt'] = 'You are a support agent.'
    expect(typeof s).toBe('string')
  })

  it('test_compileAgent_carries_resolver_byref', () => {
    const resolver: SystemPromptResolver = (ctx) => `prompt for ${ctx.cwd ?? '?'}`

    @Agent({ name: 'res', route: '/res', systemPrompt: resolver })
    class ResolverAgent {
      @MainLoop({ strategy: 'simple-chat' })
      async run() {}
    }

    const walk = walkAgentMetadata(ResolverAgent, [])
    const compiled = compileAgent(walk)
    // The exact same function reference must survive the compile boundary.
    expect(compiled.systemPrompt).toBe(resolver)
  })

  it('test_compileAgent_still_carries_string', () => {
    @Agent({ name: 'str', route: '/str', systemPrompt: 'static prompt' })
    class StringAgent {
      @MainLoop({ strategy: 'simple-chat' })
      async run() {}
    }
    const compiled = compileAgent(walkAgentMetadata(StringAgent, []))
    expect(compiled.systemPrompt).toBe('static prompt')
  })

  describe('@ProjectContext composes with a resolver base (ADR D2)', () => {
    it('test_projectContext_composes_resolver_base', async () => {
      const resolve = compileProjectContext({}, (ctx) => `BASE:${ctx.cwd ?? '?'}`)
      const out = await resolve(mkCtx('/r'))
      expect(out.endsWith('BASE:/r')).toBe(true)
      expect(out).toBe('ENV\n\nREPOMAP\n\nINSTR\n\nBASE:/r')
    })

    it('test_projectContext_resolver_base_without_cwd_returns_resolved_base', async () => {
      // No cwd → no repo map; the base resolver is still awaited (not returned as a fn).
      const resolve = compileProjectContext({}, () => 'BASE')
      const out = await resolve(mkCtx())
      expect(out).toBe('BASE')
    })

    it('test_projectContext_resolver_base_rejection_propagates', async () => {
      // EC-1: a failing base resolver must surface (fail-loud), not be swallowed.
      const resolve = compileProjectContext({}, () => {
        throw new Error('boom')
      })
      await expect(resolve(mkCtx())).rejects.toThrow('boom')
    })

    it('test_projectContext_async_resolver_base_is_awaited', async () => {
      // EC-2: an async base (Promise<string>) is awaited, not stringified to [object Promise].
      const resolve = compileProjectContext({}, async () => 'BASE')
      const out = await resolve(mkCtx())
      expect(out).toBe('BASE')
    })

    it('test_projectContext_empty_resolver_base_no_trailing_separator', async () => {
      // EC-3: an empty resolved base is dropped by filter(Boolean) — no trailing join.
      const resolve = compileProjectContext({}, () => '')
      const out = await resolve(mkCtx('/r'))
      expect(out).toBe('ENV\n\nREPOMAP\n\nINSTR')
      expect(out.endsWith('\n\n')).toBe(false)
    })
  })
})
