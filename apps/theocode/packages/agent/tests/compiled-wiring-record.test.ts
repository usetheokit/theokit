/**
 * #1927 — the record `/status` renders is corrected by what the framework says the CREATED agent got.
 *
 * `buildChatAgent` publishes a record at build time, from the inputs. When the framework creates the
 * agent it reports its compiled options through the definition's `onWired`; the record must then list
 * those servers, skills and hooks, not the ones the config asked for.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CompiledWiring } from '@theokit/agents'

import { buildChatAgent } from '../src/chat/chat.js'
import { withCompiledWiring } from '../src/composition/composition-record.js'
import type { WiredCapabilities } from '../src/wired-capabilities.js'
import { wiredCapabilities } from '../src/wired-capabilities.js'
import { tempRoot } from './helpers/temp-root.js'

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
  hookEvents: ['PreToolUse  ./check.sh', 'Stop  ./stop.sh', 'SessionStart  ./start.sh'],
  agentsMdFiles: ['/p/AGENTS.md'],
  sandboxMode: 'workspace-write',
})

describe('withCompiledWiring', () => {
  it('lists the servers and skills the created agent got, not the ones requested', () => {
    const w = withCompiledWiring(
      requested,
      compiled({ mcpServers: ['b'], skills: { listed: ['s2'], readable: [] } }),
    )
    expect(w.mcp.active).toEqual(['b'])
    expect(w.skills.active).toEqual(['s2'])
  })

  it('lists only the hooks whose event reached the agent', () => {
    const w = withCompiledWiring(requested, compiled({ hooks: [{ event: 'pre_tool_call' }] }))
    // `Stop` was configured and never reached the agent; `SessionStart` is delivered by this
    // product, not by the agent, so the agent's list neither confirms nor contradicts it.
    expect(w.hooks.active).toEqual(['PreToolUse  ./check.sh', 'SessionStart  ./start.sh'])
  })

  it('keeps the facts that are ours', () => {
    const w = withCompiledWiring(requested, compiled({}))
    expect(w.agentsMd).toEqual(requested.agentsMd)
    expect(w.sandboxMode).toBe('workspace-write')
  })
})

describe('buildChatAgent registers the framework listener', () => {
  it('re-publishes the record from what the created agent compiled', async () => {
    const cwd = tempRoot('c1927-project-')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { declared: { command: 'x', args: [] } } }),
    )
    const seen: WiredCapabilities[] = []
    const def = (await buildChatAgent({
      cwd,
      home: tempRoot('c1927-home-'),
      surface: 'headless',
      posture: { allows: { mcp: true, skills: true, hooks: true, agentsMd: true } } as never,
      onWired: (w) => seen.push(w),
    })) as unknown as { onWired?: (w: CompiledWiring) => void }

    expect(seen[0]?.mcp.active, 'the build-time record names the declared server').toEqual([
      'declared',
    ])
    expect(typeof def.onWired, 'the build registered no onWired listener').toBe('function')

    // The framework calls the listener with what the created agent has; here that is no server.
    def.onWired?.(compiled({ mcpServers: [] }))
    expect(seen).toHaveLength(2)
    expect(seen[1]?.mcp.active).toEqual([])
  })
})
