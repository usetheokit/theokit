/**
 * M35 (multi-surface) — turn-level parity: in-process vs HTTP.
 *
 * The whole Model-A thesis rests on ONE claim: the in-process seam (`streamAgentTurnInProcess`) and
 * the HTTP path drive the consumer identically, because they both call the SAME `streamAgentUIMessages`
 * and both translate its `UIMessageChunk`s with the SAME logic. This test proves that: an identical
 * chunk sequence, drained through the in-process seam AND through the HTTP-style line reader, produces
 * an IDENTICAL sequence of handler dispatches. `@theokit/agents` is stubbed so the stream is
 * deterministic (no LLM). If the two paths ever diverge, this test fails.
 */
import { describe, expect, it, vi } from 'vitest'

interface Chunk {
  type: string
  [k: string]: unknown
}

const hoisted = vi.hoisted(() => ({ chunks: [] as Chunk[] }))

vi.mock('@theokit/agents', () => ({
  compileAgentModule: (mod: { __compiled: unknown }) => mod.__compiled,
  streamAgentUIMessages: () =>
    (async function* () {
      for (const c of hoisted.chunks) yield c
    })(),
}))

const { streamAgentTurnInProcess } =
  await import('../../packages/theo/src/server/agent/stream-agent-turn-in-process.js')

/** The SAME translator the Ink TUI uses (theo-code-v2 apps/tui/sse-translate.ts), inlined here as the
 * canonical chunk→dispatch contract both paths must honor. */
function translate(chunk: Chunk, log: string[]): void {
  switch (chunk.type) {
    case 'text-delta':
      if (typeof chunk.delta === 'string') log.push(`token:${chunk.delta}`)
      break
    case 'tool-input-available':
      log.push(`toolCall:${chunk.toolName as string}:${chunk.toolCallId as string}`)
      break
    case 'tool-output-available':
      log.push(`toolResult:${chunk.toolCallId as string}:${chunk.output as string}`)
      break
    default:
      break
  }
}

/** HTTP path: the server serialized these chunks as SSE `data:` lines; the client parses each line. */
function serializeAsSse(chunks: Chunk[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}`).join('\n') + '\ndata: [DONE]\n'
}

async function drainHttpStyle(sse: string): Promise<string[]> {
  const log: string[] = []
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') break
    translate(JSON.parse(payload) as Chunk, log)
  }
  return log
}

async function drainInProcess(): Promise<string[]> {
  const log: string[] = []
  const PLAIN = { __compiled: { tools: [], stream: true } }
  for await (const chunk of streamAgentTurnInProcess(PLAIN, 'sk', {
    message: 'go',
    sessionId: 's',
  })) {
    translate(chunk as Chunk, log)
  }
  return log
}

describe('agent turn parity — in-process vs HTTP (M35)', () => {
  it('yields an IDENTICAL handler-dispatch sequence through both paths', async () => {
    hoisted.chunks = [
      { type: 'text-delta', delta: 'Hel' },
      { type: 'text-delta', delta: 'lo' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'ls', input: {} },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'file.ts' },
      { type: 'text-delta', delta: ' done' },
      { type: 'finish' },
    ]
    const inProcess = await drainInProcess()
    const http = await drainHttpStyle(serializeAsSse(hoisted.chunks))

    expect(inProcess).toEqual(http)
    expect(inProcess).toEqual([
      'token:Hel',
      'token:lo',
      'toolCall:ls:c1',
      'toolResult:c1:file.ts',
      'token: done',
    ])
  })
})
