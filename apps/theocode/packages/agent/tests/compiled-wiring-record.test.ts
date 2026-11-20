/**
 * #1927 — the record `/status` renders is corrected by what the framework says the CREATED agent got.
 *
 * `buildChatAgent` publishes a record at build time, from the inputs. When the framework creates the
 * agent it reports its compiled options through `onWired`; the record must then list those servers,
 * skills and hooks, not the ones the config asked for.
 */
import { describe, expect, it } from 'vitest'

import type { CompiledWiring } from '@theokit/agents'

import { withCompiledWiring } from '../src/composition/composition-record.js'
import { wiredCapabilities } from '../src/wired-capabilities.js'

const compiled = (over: Partial<CompiledWiring>): CompiledWiring => ({
  tools: [],
  skills: { listed: [], readable: [] },
  mcpServers: [],
  hooks: [],
  subagents: [],
  settingSources: { project: true, user: true },
  withheldBuiltinTools: [],
  ...over,
})

const requested = wiredCapabilities({
  posture: { allows: { mcp: true, skills: true, hooks: true, agentsMd: true } },
  projectSourcesAllowed: true,
  mcpServers: { a: {}, b: {} },
  configuredSkills: ['s1', 's2'],
  hookEvents: ['PreToolUse  ./check.sh'],
  agentsMdFiles: ['/p/AGENTS.md'],
  sandboxMode: 'workspace-write',
})

describe('withCompiledWiring', () => {
  it('lists the servers and skills the created agent got, not the ones requested', () => {
    const w = withCompiledWiring(
      requested,
      compiled({
        mcpServers: ['b'],
        skills: { listed: ['s2'], readable: [] },
        hooks: [{ event: 'pre_tool_call' }],
      }),
    )
    expect(w.mcp.active).toEqual(['b'])
    expect(w.skills.active).toEqual(['s2'])
    expect(w.hooks.active).toEqual(['PreToolUse  ./check.sh'])
  })

  it('lists no hook when the agent got none, and keeps the facts that are ours', () => {
    const w = withCompiledWiring(requested, compiled({}))
    expect(w.hooks.active).toEqual([])
    expect(w.mcp.active).toEqual([])
    expect(w.agentsMd).toEqual(requested.agentsMd)
    expect(w.sandboxMode).toBe('workspace-write')
  })
})
