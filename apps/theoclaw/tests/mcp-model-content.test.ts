/**
 * OC-60: the text an MCP tool returns must be in the tool message the model receives next. The real
 * SDK runs the real token MCP server; the stub records the request that follows the tool call.
 */
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { startModelStub } from './model-stub.js'

const SERVER = fileURLToPath(new URL('./fixtures/token-mcp-server.mjs', import.meta.url))
const TOKEN = 'tok-mcp-offline-1234'
/** The shape a browser MCP server's snapshot takes: markdown headings and a fenced YAML block. */
const SNAPSHOT = `### Page\n- Page URL: http://127.0.0.1:41267/\n### Snapshot\n\`\`\`yaml\n- generic [active] [ref=e1]: ${TOKEN}\n\`\`\``

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

type Message = { role: string; content?: unknown }

/** The text of every tool message; a content that is neither a string nor text parts is an error, not text. */
function toolMessageText(messages: readonly Message[]): string {
  return messages
    .filter((message) => message.role === 'tool')
    .map((message) => {
      const { content } = message
      if (typeof content === 'string') return content
      if (Array.isArray(content) && content.every((part) => typeof (part as { text?: unknown })?.text === 'string')) {
        return content.map((part) => (part as { text: string }).text).join('')
      }
      throw new Error(`a tool message has content that is not text: ${JSON.stringify(content)}`)
    })
    .join('\n')
}

/** Runs one turn in which the model calls the MCP tool; returns the messages of the request that follows. */
async function messagesAfterToolCall(result: Record<string, unknown>): Promise<Message[]> {
  const stub = await startModelStub([{ toolCalls: [{ name: 'mcp_vault_vault_lookup', args: { name: 'release' } }] }, { text: 'done' }])
  cleanups.push(() => stub.close())
  const agent = await createTheoClawAgent(
    theoClawAgentOptions({
      model: { id: 'lmstudio/stub', url: stub.url },
      apiKey: 'stub-key',
      toolOptions: {
        tools: [],
        plugins: [],
        mcpServers: { vault: { command: process.execPath, args: [SERVER], env: { FIXTURE_RESULT: JSON.stringify(result) } } },
      },
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
  return (stub.requests[1]?.messages ?? []) as Message[]
}

describe('an MCP tool result reaches the model', () => {
  it('has a plain text result in the tool message of the next request', async () => {
    const messages = await messagesAfterToolCall({ content: [{ type: 'text', text: TOKEN }] })
    expect(toolMessageText(messages), JSON.stringify(messages)).toContain(TOKEN)
  })

  it('has a multi-line fenced snapshot, whole, next to a non-text part', async () => {
    const messages = await messagesAfterToolCall({
      content: [
        { type: 'text', text: SNAPSHOT },
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
      ],
    })
    expect(toolMessageText(messages), JSON.stringify(messages)).toContain(SNAPSHOT)
  })
})

describe('the check on the tool message', () => {
  it('rejects a tool message that lost the text', () => {
    const lost: Message[] = [{ role: 'tool', content: '<untrusted-tool-output>\n\n</untrusted-tool-output>' }]
    expect(toolMessageText(lost)).not.toContain(TOKEN)
    expect(toolMessageText([{ role: 'tool', content: [{ type: 'text', text: '' }] }])).not.toContain(TOKEN)
    expect(toolMessageText([{ role: 'user', content: TOKEN }])).not.toContain(TOKEN)
  })

  it('refuses a malformed content part instead of reading around it', () => {
    expect(() => toolMessageText([{ role: 'tool', content: [{ type: 'image_url' }] }])).toThrow('not text')
    expect(() => toolMessageText([{ role: 'tool' }])).toThrow('not text')
  })
})
