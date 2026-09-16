/**
 * B-015 — the working directory is one fact, read once.
 *
 * `buildChatAgent` called `process.cwd()` at six independent points: the trust posture, the
 * effective config, the tool scope, the project instructions, the approved-hook set and the MCP
 * manifest. Meanwhile the CLI composition root resolves a directory and injects `config`/`posture`
 * built FROM it — so two of the four call sites supplied a directory and the function ignored it for
 * the other four reads.
 *
 * Nothing forces those six reads to agree. They agree today because `process.cwd()` happens not to
 * change mid-build, which is a property of the current callers rather than of this function.
 *
 * That is the same shape of defect as B-001: four composition sites, four different argument sets,
 * and a surface that silently got a profile nobody chose for it.
 */
import { readFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTrustPosture = vi.fn(() => ({
  level: 'trusted',
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
}))
const resolveEffectiveConfig = vi.fn(() => ({
  sandbox_mode: 'read-only',
  approval_policy: 'on-request',
  model: 'gpt-5.4',
  reasoning_effort: 'medium',
  hooks: [],
  skills: [],
  declaredWindow: undefined,
  contextWindow: { window: 1000 },
  sandboxPosture: { enforced: true, detail: 'test', mode: 'read-only' },
}))
const loadAgentsMd = vi.fn(() => '')
const loadRules = vi.fn(() => ({ text: '' }))
const loadApprovedHooks = vi.fn(() => new Map())
const createDelegateToTeamTool = vi.fn(() => ({ name: 'delegate_to_team' }))

vi.mock('../../src/config/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveTrustPosture,
  resolveEffectiveConfig,
}))
vi.mock('../../src/context/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadAgentsMd,
  loadRules,
}))
vi.mock('../../src/delegation/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createDelegateToTeamTool,
}))
vi.mock('../../src/hooks/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadApprovedHooks,
}))

const INJECTED = '/injected/project'

/**
 * B-167 — the operator root, injected for the same reason `INJECTED` is. This file already controlled
 * the PROJECT side and left the operator side ambient, so it read whatever `~/.theokit/rules` the
 * machine happened to hold: four truncation warnings here, and coverage that moved with the size of
 * the maintainer's own configuration.
 */
const INJECTED_HOME = '/injected/home'

describe('B-015 — an injected working directory reaches every resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('test_the_trust_posture_is_resolved_for_the_injected_directory', async () => {
    const { buildChatAgent } = await import('../../src/chat/chat.js')

    buildChatAgent({ surface: 'headless', cwd: INJECTED, home: INJECTED_HOME })

    expect(
      resolveTrustPosture,
      'the trust posture was resolved for process.cwd() while the caller supplied a directory — ' +
        'the agent could be built with one directory trusted and another one configured',
    ).toHaveBeenCalledWith(INJECTED)
  })

  it('test_the_effective_config_is_resolved_for_the_injected_directory', async () => {
    const { buildChatAgent } = await import('../../src/chat/chat.js')

    buildChatAgent({ surface: 'headless', cwd: INJECTED, home: INJECTED_HOME })

    expect(resolveEffectiveConfig).toHaveBeenCalledWith(expect.objectContaining({ cwd: INJECTED }))
  })

  it('test_the_project_instructions_come_from_the_injected_directory', async () => {
    const { buildChatAgent } = await import('../../src/chat/chat.js')

    buildChatAgent({ surface: 'headless', cwd: INJECTED, home: INJECTED_HOME })

    expect(loadAgentsMd).toHaveBeenCalledWith(INJECTED)
  })

  it('test_the_builder_reads_no_directory_of_its_own', async () => {
    // B-059 — this REPLACES `test_omitting_the_directory_still_falls_back_to_the_process_one`,
    // which asserted the opposite and was correct until now.
    //
    // B-015 and B-032 closed the six ambient reads but left the parameter optional, so the default
    // stayed reachable and the defect could return without anyone editing this file. `cwd` is
    // required now, which makes "the builder resolved its own directory" unrepresentable rather
    // than merely absent — the same move B-006 made for `ToolScope.sandbox`.
    //
    // The guarantee is enforced by the compiler, so what is left to assert at runtime is that no
    // second, hidden read crept back in. Shaped after B-057's DoD, which counts `process.cwd()`
    // sites rather than asserting a call.
    // Comments are stripped first. The prose in `chat.ts` legitimately CITES `process.cwd()` while
    // explaining why it is gone — the first version of this assertion read that history and failed
    // on it, which is a detector that punishes documenting the defect it guards against.
    const source = await readFile(new URL('../../src/chat/chat.ts', import.meta.url), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(
      code.includes('process.cwd()'),
      'chat.ts resolves a working directory of its own again. Every caller now supplies one, and a ' +
        'read here can disagree with it — which is the whole of B-015, B-032 and this bullet of ' +
        'B-059. If a new site genuinely needs the process directory, it belongs at the composition ' +
        'root that chooses it, as `chat-acp.ts` does.',
    ).toBe(false)
  })
})

describe('B-032 — the injected directory reaches the delegated team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveEffectiveConfig.mockReturnValue({
      sandbox_mode: 'workspace-write',
      approval_policy: 'on-request',
      model: 'gpt-5.4',
      reasoning_effort: 'medium',
      hooks: [],
      skills: [],
      declaredWindow: undefined,
      contextWindow: { window: 1000 },
      sandboxPosture: { enforced: true, detail: 'test', mode: 'workspace-write' },
    })
  })

  it('test_delegate_to_team_is_built_with_the_injected_directory', async () => {
    // `resolveToolScope` derives BOTH the writeRoot and the sandbox workDir from the directory it is
    // given, so a team built against `process.cwd()` confines its worker to the wrong tree. This is
    // the one B-015 bypass with a confinement consequence rather than a configuration one.
    const { buildChatAgent } = await import('../../src/chat/chat.js')

    buildChatAgent({ surface: 'headless', cwd: INJECTED, home: INJECTED_HOME })

    expect(
      createDelegateToTeamTool,
      'the delegated team was built without the injected directory, so its worker resolves its ' +
        'write root and sandbox from process.cwd()',
    ).toHaveBeenCalledWith(expect.objectContaining({ cwd: INJECTED }))
  })
})
