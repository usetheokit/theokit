/**
 * B-001 — the ACP surface must declare its own tool profile.
 *
 * `profileTools` (chat.ts) defaults to `'interactive'` when no surface is declared, and the
 * interactive profile registers `request_user_input` against the module-level `AskBridge`. Only the
 * TUI subscribes to that bridge (`tui/src/agent-session/ConversationSlot.tsx`), so on any other
 * surface `ask()` never resolves and the call stalls on the built-in's 5-minute timeout.
 *
 * `chat.ts` documents this hazard for the headless profile one screen above the default, and the ACP
 * entry hit the identical condition by omitting the argument entirely.
 *
 * The assertion is on the ARGUMENT the entry passes, not on the resulting tool list: the defect is
 * that the surface is left undeclared, and a test that inspected the tools would keep passing if
 * someone later changed the default instead of declaring the profile.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildChatAgent = vi.fn(() => ({ kind: 'fake-agent' }))
const toAgentFactory = vi.fn((factory: unknown, _options?: unknown) => factory)
const resolveFreshCredential = vi.fn()

vi.mock('../../src/chat/chat.js', () => ({ buildChatAgent }))
vi.mock('@theokit/agents', () => ({
  toAgentFactory,
  setDiagnosticsSink: vi.fn(),
}))
vi.mock('@theocode/shared/diagnostic-sink', () => ({ installDiagnosticSink: vi.fn() }))
vi.mock('../../src/auth/index.js', () => ({ resolveFreshCredential }))

describe('B-001 — the ACP entry declares the headless profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('test_acp_builds_the_agent_with_the_headless_surface', async () => {
    await import('../../src/chat/chat-acp.js')

    // `toAgentFactory` receives the builder; invoking it is what reaches `buildChatAgent`.
    const factory = toAgentFactory.mock.calls[0]?.[0] as () => Promise<unknown>
    expect(factory, 'the ACP entry did not hand a factory to `toAgentFactory`').toBeTypeOf(
      'function',
    )
    await factory()

    expect(
      buildChatAgent,
      'the ACP entry built the agent WITHOUT declaring a surface, so `profileTools` falls through ' +
        "to the 'interactive' default and registers `request_user_input` against a bridge only the " +
        'TUI answers. Every such call stalls for the built-in 5-minute timeout.',
    ).toHaveBeenCalledWith(expect.objectContaining({ surface: 'headless' }))
  })
})

/**
 * B-007 — a credential failure must stay a credential failure.
 *
 * The entry caught every error from `resolveFreshCredential`, wrote the message to stderr and
 * returned `''`. An empty string is a VALID value for the SDK's `apiKey` resolver, so "I could not
 * authenticate" was handed downstream as "here is your key" — the request then fails later, at the
 * provider, with a message that describes neither the cause nor the fix.
 *
 * That is Unbreakable Rule 8 in its plainest form: never degrade a typed error into a magic value.
 * On a headless surface it is worse than on the TUI, because there is no operator watching stderr.
 */
describe('B-007 — credential failure is not degraded to an empty key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('test_credential_failure_rejects_instead_of_returning_an_empty_key', async () => {
    const boom = new Error('no credential found for provider openai')
    resolveFreshCredential.mockRejectedValueOnce(boom)

    await import('../../src/chat/chat-acp.js')
    const options = toAgentFactory.mock.calls[0]?.[1] as { apiKey: () => Promise<string> }

    await expect(
      options.apiKey(),
      'the ACP entry swallowed a credential error and resolved with a value. An empty key is ' +
        'indistinguishable from a real one to the SDK, so the failure resurfaces later at the ' +
        'provider with an irrelevant message (Unbreakable Rule 8).',
    ).rejects.toThrow(boom)
  })

  it('test_a_resolved_credential_still_yields_its_key', async () => {
    // Anti-vacuity floor: a resolver that always threw would satisfy the test above.
    resolveFreshCredential.mockResolvedValueOnce({ apiKey: 'sk-real-key' })

    await import('../../src/chat/chat-acp.js')
    const options = toAgentFactory.mock.calls[0]?.[1] as { apiKey: () => Promise<string> }

    await expect(options.apiKey()).resolves.toBe('sk-real-key')
  })
})
