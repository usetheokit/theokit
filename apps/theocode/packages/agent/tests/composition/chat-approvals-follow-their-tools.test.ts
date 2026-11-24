/**
 * #1915 — each approval is registered beside its tool, so the compiled approvals map equals what
 * `approvalGates` produced for every combination of `writes` and `searchConfigured`, and the
 * permissions plugin is handed the same gated set as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { codingAgentTools } from '@theokit/agents/presets'
import {
  createGenericHttpSearchAdapter,
  createWebFetchTool,
  createWebSearchTool,
} from '@theokit/agents/tools'

import { tempRoot } from '../helpers/temp-root.js'

const TRUSTED = {
  level: 'trusted',
  source: 'store',
  allows: {
    projectConfig: true,
    agentsMd: true,
    hooks: true,
    memory: true,
    mcp: true,
    skills: true,
    subagents: true,
    customCommands: true,
  },
}

function config(sandbox_mode: string) {
  return {
    sandbox_mode,
    approval_policy: 'on-request',
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
    hooks: [],
    skills: [],
    memory: false,
    declaredWindow: undefined,
    contextWindow: { window: 1000 },
    sandboxPosture: { enforced: true, detail: 'test', mode: sandbox_mode },
  }
}

const resolveTrustPosture = vi.fn(() => TRUSTED)
const resolveEffectiveConfig = vi.fn(() => config('workspace-write'))
const permissionsSpy = vi.fn()

vi.mock('../../src/config/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveTrustPosture,
  resolveEffectiveConfig,
}))

vi.mock('../../src/composition/agent-spec.js', async (orig) => {
  const real = await orig<typeof import('../../src/composition/agent-spec.js')>()
  return {
    ...real,
    permissionsPluginsFor: (...args: Parameters<typeof real.permissionsPluginsFor>) => {
      permissionsSpy(...args)
      return real.permissionsPluginsFor(...args)
    },
  }
})

/** The gate set per mode, written out literally. */
const WRITE_GATES = {
  ApplyPatch: { question: 'Apply this file patch?' },
  Edit: { question: 'Apply this edit?' },
  delegate_to_team: { question: 'Delegate this task to the team (the worker may edit/run files)?' },
}
const ALWAYS_GATES = {
  Bash: { question: 'Run this shell command?' },
  interactive_shell: { question: 'Start this interactive session?' },
  write_stdin: { question: 'Send this input to the interactive session?' },
  web_fetch: { question: 'Fetch this URL?' },
}
const SEARCH_GATE = { web_search: { question: 'Search the web for this?' } }

const delegateTool = {
  name: 'delegate_to_team',
  description: 'x',
  inputSchema: {},
  handler: async () => '',
}

const realHome = process.env.HOME

beforeEach(() => {
  vi.clearAllMocks()
  process.env.HOME = tempRoot('chat-approvals-home-')
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
})

async function compile(writes: boolean, searchConfigured: boolean, env: NodeJS.ProcessEnv = searchConfigured ? { BRAVE_API_KEY: 'test-key' } : {}) {
  resolveEffectiveConfig.mockReturnValue(config(writes ? 'workspace-write' : 'read-only'))
  const { buildChatAgent } = await import('../../src/chat/chat.js')
  const { withCapabilities } = await import('../helpers/with-capabilities.js')
  return withCapabilities(
    await buildChatAgent({ surface: 'headless', cwd: tempRoot('chat-approvals-cwd-'), env } as never),
  ) as unknown as {
    approvals: Record<string, { question: string }>
    tools: { name: string }[]
  }
}

describe('the compiled approvals map', () => {
  for (const writes of [true, false]) {
    for (const searchConfigured of [true, false]) {
      it(`test_equals_approval_gates_when_writes_${writes}_and_search_${searchConfigured}`, async () => {
        const agent = await compile(writes, searchConfigured)
        const expected = {
          ...(writes ? WRITE_GATES : {}),
          ...ALWAYS_GATES,
          ...(searchConfigured ? SEARCH_GATE : {}),
        }

        expect(agent.approvals).toEqual(expected)
        // The gate set the preset declares for this mode is the same map, so the card and the set the
        // permissions plugin receives cannot drift apart (the check `approvalGates` used to carry).
        const declared = codingAgentTools({
          cwd: '/tmp/proj',
          sandboxMode: writes ? 'workspace-write' : 'read-only',
          shellInReadOnly: true,
          interactive: { start: () => undefined } as never,
          webFetch: createWebFetchTool(),
          ...(searchConfigured && {
            webSearch: createWebSearchTool({ search: createGenericHttpSearchAdapter() }),
          }),
          ...(writes && { delegateToTeam: delegateTool as never }),
        })
        expect(Object.fromEntries(declared.gates)).toEqual(expected)
        const tools = new Set(agent.tools.map((t) => t.name))
        for (const name of Object.keys(agent.approvals)) expect(tools.has(name)).toBe(true)
      })
    }
  }
})

describe('an explicit off switch', () => {
  it('test_declares_no_web_search_when_THEOKIT_SEARCH_is_off_even_with_a_url', async () => {
    const agent = await compile(false, false, {
      THEOKIT_SEARCH: 'off',
      THEOKIT_SEARCH_API_URL: 'http://search.invalid',
      THEOKIT_SEARCH_API_KEY: 'k',
    })
    expect(agent.tools.some((t) => t.name === 'web_search')).toBe(false)
    expect(agent.approvals).not.toHaveProperty('web_search')
  })
})

describe('the permissions plugin', () => {
  it('test_receives_the_full_gated_set', async () => {
    await compile(false, false)

    expect(permissionsSpy).toHaveBeenCalledTimes(1)
    const gated = permissionsSpy.mock.calls[0]?.[3] as ReadonlySet<string>
    expect([...gated].sort()).toEqual(
      [
        ...Object.keys(WRITE_GATES),
        ...Object.keys(ALWAYS_GATES),
        ...Object.keys(SEARCH_GATE),
      ].sort(),
    )
  })
})
