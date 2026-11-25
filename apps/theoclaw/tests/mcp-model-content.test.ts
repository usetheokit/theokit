/**
 * OC-60: the text an MCP tool returns must be in the tool message the model receives next. The real
 * SDK runs the real token MCP server; the stub records the request that follows the tool call.
 */
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { startModelStub } from './model-stub.js'
import type { ModelStub } from './model-stub.js'

const SERVER = fileURLToPath(new URL('./fixtures/token-mcp-server.mjs', import.meta.url))
const TOKEN = 'tok-mcp-offline-1234'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')
  return content.map((part) => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('')
}

describe('an MCP tool result reaches the model', () => {
  it('has the returned text in the tool message of the next request', async () => {
    const stub: ModelStub = await startModelStub([{ toolCalls: [{ name: 'mcp_vault_vault_lookup', args: { name: 'release' } }] }, { text: 'done' }])
    cleanups.push(() => stub.close())
    const agent = await createTheoClawAgent(
      theoClawAgentOptions({
        model: { id: 'lmstudio/stub', url: stub.url },
        apiKey: 'stub-key',
        toolOptions: { tools: [], plugins: [], mcpServers: { vault: { command: process.execPath, args: [SERVER], env: { FIXTURE_TOKEN: TOKEN } } } },
      }),
    )
    try {
      const run = await agent.send('look it up')
      for await (const _event of run.stream()) {
        // Drained so the run proceeds.
      }
      await run.wait()
    } finally {
      await (agent as Partial<AsyncDisposable>)[Symbol.asyncDispose]?.()
    }

    const next = stub.requests[1]
    const messages = ((next?.messages ?? []) as { role: string; content?: unknown }[]).filter((message) => message.role === 'tool')
    expect(messages.map((message) => contentText(message.content)).join('\n'), JSON.stringify(next?.messages)).toContain(TOKEN)
  })
})
