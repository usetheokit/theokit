import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'

const createSdkAgentStream = vi.hoisted(() => vi.fn())
vi.mock('../../src/bridge/sdk-adapter.js', () => ({ createSdkAgentStream }))

const { delegate } = await import('../../src/bridge/agent-orchestrator.js')

describe('delegate isolation forwards the workspace path to the SDK adapter', () => {
  it('passes cwd = workspace.path, overriding options.cwd', async () => {
    createSdkAgentStream.mockReturnValue(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      },
    }))
    const release = vi.fn(() => Promise.resolve())
    await delegate({ name: 'w', compiled: applyCapabilities([new ModelCapability('m')]) }, 'hi', {
      apiKey: 'k',
      cwd: '/elsewhere',
      isolation: { acquire: () => Promise.resolve({ path: '/tmp/ws', release }) },
    })
    expect(createSdkAgentStream.mock.calls[0]?.[3]).toMatchObject({ cwd: '/tmp/ws' })
    expect(release).toHaveBeenCalledOnce()
  })
})
