import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import { afterAll, describe, expect, it, vi } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { startTheoClaw } from '../src/composition.js'
import { capturingStream, fakeBuilders, noAgent, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAgent, assistant, finished, waitFor } from './fakes.js'
import { fakeMcpEventsServer } from './mcp-events-fake-server.js'

const SCRATCH = mkdtempSync(join(tmpdir(), 'theoclaw-mcp-events-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

describe('MCP events through startTheoClaw', () => {
  it('a configured MCP server event makes TheoClaw post "event received" to the owner chat', async () => {
    const server = await fakeMcpEventsServer()
    const file = join(SCRATCH, 'external-tools.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { feed: { url: server.url } } }))
    const { adapters, builders } = fakeBuilders()
    const signals = new EventEmitter()
    const app = await startTheoClaw({
      cwd: SCRATCH,
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_EXTERNAL_TOOLS: file, THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:42' },
      agentFactory: noAgent,
      triggerAgentFactory: async () => new FakeAgent({ frames: [assistant('Done.'), finished()] }) as unknown as TurnAgent,
      builders,
      signals,
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    try {
      await app.loop.ready
      expect(server.methods).toContain('events/subscribe')
      expect(await server.emit({ type: 'ping' })).toBe(204)
      await waitFor(() => (adapters.get('telegram')?.sent.length ?? 0) >= 1, 3000, 'event received')
      expect(adapters.get('telegram')?.sent[0]?.text).toContain('event received')
    } finally {
      await app.loop.stopAll()
      await app.close()
      await server.close()
    }
  })
})
