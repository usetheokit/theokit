import { describe, expect, it, vi } from 'vitest'

/**
 * SDK 4.0 (SE40) EC-3 — the native transcript is written to `local.baseDir`. If that dir is
 * unwritable (read-only mount, no perms) the SDK raises during the run. theokit MUST surface it
 * (fail-loud per `error-handling.md`), NOT swallow it into a silent empty stream. Same contract as
 * EC-4 (malformed config) — proven here by a mocked SDK that rejects with a filesystem write error
 * when a `baseDir` is threaded.
 */
vi.mock('@theokit/sdk', () => ({
  Tool: { create: (s: unknown) => s },
  Agent: {
    getOrCreate: () =>
      Promise.reject(
        new Error(
          "EACCES: permission denied, mkdir '/read-only/.data/agent-sessions/projects' — cannot write session transcript",
        ),
      ),
  },
}))

import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'
import { agent } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'

describe('EC-3 — an unwritable transcript baseDir surfaces a typed error, never swallowed', () => {
  it('test_transcript_write_surfaces_typed_error_when_baseDir_unwritable', async () => {
    const compiled = compileAgentDefinition(agent().model('m').build())
    const events: Array<{ type: string; code?: string; message?: string }> = []
    for await (const e of createSdkAgentStream(compiled, [], 'test-key', {
      baseDir: '/read-only/.data/agent-sessions',
    })('hi', 'sess-ec3')) {
      events.push(e as { type: string; code?: string; message?: string })
    }

    const errorEvent = events.find((e) => e.type === 'error')
    // Fail-loud: the stream MUST yield a typed error carrying the write failure — not end silently
    // (which would look like a successful empty run and lose the operator's data on the floor).
    expect(errorEvent).toBeDefined()
    expect(errorEvent?.code).toBe('SDK_ERROR')
    expect(errorEvent?.message).toContain('EACCES')
  })
})
