/**
 * The `skill_read` tool of the chat agent, as the framework's REAL runtime wires it (#1925).
 *
 * The tool exists only after `toAgentFactory` builds the SDK agent: `.skills(…, { read: 'advertised' })`
 * makes the framework read the SDK's own skills manager on every call. A test that wants to ask "what
 * does `skill_read` serve" has to go through that path, because a compiled definition does not carry
 * the tool.
 */
const allows = (on: boolean) => ({
  projectConfig: on,
  agentsMd: on,
  hooks: on,
  memory: on,
  mcp: on,
  skills: on,
  subagents: on,
  customCommands: on,
})

export const TRUSTED = { level: 'trusted', allows: allows(true) }
export const UNTRUSTED = { level: 'untrusted', source: 'store', allows: allows(false) }

function skillConfig(skills: string[] = []) {
  return {
    sandbox_mode: 'read-only',
    approval_policy: 'on-request',
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
    hooks: [],
    skills,
    memory: false,
    declaredWindow: undefined,
    contextWindow: { window: 1000 },
    sandboxPosture: { enforced: true, detail: 'test', mode: 'read-only' },
  }
}

export interface BuiltChat {
  tools: { name: string; handler: (input: Record<string, unknown>) => unknown }[]
}

export async function buildThroughRuntime(
  cwd: string,
  home: string,
  posture: unknown,
  skills: string[] = [],
): Promise<BuiltChat> {
  const { buildChatAgent } = await import('../../src/chat/chat.js')
  const { toAgentFactory } = await import('@theokit/agents')
  const def = await buildChatAgent({
    surface: 'headless',
    cwd,
    home,
    posture,
    config: skillConfig(skills),
  } as never)
  const agent = await toAgentFactory(def as never, {
    apiKey: 'sk-test-1925-0000000000',
    approvals: {
      kind: 'auto-approve',
      confinedBy: { mode: 'workspace-write', enforced: true, detail: 'test double' },
      reason: 'test surface',
    },
    overrides: { cwd } as never,
  })(`s-${Math.random()}`)
  return { tools: (agent as unknown as { options: BuiltChat }).options.tools }
}

/** What the model gets back from `skill_read(name)`. */
export async function readSkill(chat: BuiltChat, name: string): Promise<string> {
  const tool = chat.tools.find((t) => t.name === 'skill_read')
  if (tool === undefined) throw new Error('skill_read is missing from the agent')
  return String(await tool.handler({ name }))
}
