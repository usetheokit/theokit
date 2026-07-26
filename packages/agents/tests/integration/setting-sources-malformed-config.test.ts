import { describe, expect, it, vi } from 'vitest'

/**
 * theokit-file-based-config EC-4 — a malformed `.theokit/` file makes the SDK raise a
 * `ConfigurationError` during agent creation. theokit MUST surface it (fail-loud), NOT swallow it
 * into a silent clean end. The SDK owns discovery + the ConfigurationError; theokit's contract is
 * only "don't swallow" — proven here by a mocked SDK that rejects on create.
 */
vi.mock('@theokit/sdk', () => ({
  Tool: { create: (s: unknown) => s },
  Agent: {
    getOrCreate: () =>
      Promise.reject(
        new Error(
          'ConfigurationError: malformed .theokit/skills/bad/SKILL.md — frontmatter missing required `name`',
        ),
      ),
  },
}))

import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'
import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'

describe('EC-4 — malformed .theokit/ config surfaces a typed error, never swallowed', () => {
  it('test_malformed_theokit_file_surfaces_configuration_error', async () => {
    const compiled = compileAgentDefinition(
      AgentBuilder.create().model('m').settingSources(['project']).build(),
    )
    const events: Array<{ type: string; message?: string }> = []
    for await (const e of createSdkAgentStream(compiled, [], 'test-key', { cwd: '/app/root' })(
      'hi',
      'sess-1',
    )) {
      events.push(e as { type: string; message?: string })
    }

    const errorEvent = events.find((e) => e.type === 'error')
    // The stream MUST yield an error event carrying the SDK's ConfigurationError message —
    // not end silently (which would look like a successful empty run).
    expect(errorEvent).toBeDefined()
    expect(errorEvent?.message).toContain('ConfigurationError')
    expect(errorEvent?.message).toContain('malformed')
  })
})
