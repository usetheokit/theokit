import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import { parseWireStream } from '../../src/wire/parse-wire-stream.js'
import { readMessageStream } from '../../src/wire/read-message-stream.js'

/**
 * THE ORACLE (plan D4) — the reason the Rule-9 exception in D6 is defensible.
 *
 * A hand-written mirror of a wire is strictly WORSE than depending on the package unless something
 * keeps proving it faithful: the dependency fails loudly at install, a divergent mirror fails
 * quietly in production on a frame nobody tested. So `ai` stays a devDependency and every variant
 * we mirror is fed to BOTH pipelines and asserted to reconstruct identically.
 *
 * When this file goes red, the first question is NOT "how do I make it pass" — it is whether the
 * wire moved and we did not.
 */

const enc = new TextEncoder()

function sse(frames: readonly unknown[]): string {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function byteStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(text))
      controller.close()
    },
  })
}

/** The ai-sdk path — exactly what `useChat` runs internally. */
async function viaOracle(text: string): Promise<unknown[]> {
  const parsed = parseJsonEventStream({ stream: byteStream(text), schema: uiMessageChunkSchema })
  const chunks = new ReadableStream({
    async start(controller) {
      for await (const r of parsed as AsyncIterable<{ success: boolean; value?: unknown }>) {
        if (r.success) controller.enqueue(r.value)
      }
      controller.close()
    },
  })
  const out: unknown[] = []
  for await (const m of readUIMessageStream({ stream: chunks as never }))
    out.push(structuredClone(m))
  return out
}

/**
 * Compare what actually crosses the wire.
 *
 * The oracle materialises keys whose value is `undefined` (`metadata: undefined`,
 * `providerMetadata: undefined`); we omit them. That difference is invisible to JSON — the wire is
 * JSON, so it can never travel — and invisible to any consumer that reads values. It IS visible to
 * `Object.keys(msg)`, and this normalisation deliberately hides exactly that much and no more:
 * every DEFINED value still has to match, key for key.
 */
function wireVisible(snapshots: unknown[]): unknown {
  return JSON.parse(JSON.stringify(snapshots))
}

/** Our path. */
async function viaMirror(text: string): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const m of readMessageStream(parseWireStream(byteStream(text)))) out.push(m)
  return out
}

/**
 * One case per variant the presenter or the bridge can emit. `tool-approval-request` and the
 * `data-*` family are transport signals the transcript does not carry, so both sides drop them —
 * that agreement is itself worth asserting.
 */
const CASES: ReadonlyArray<{ name: string; frames: readonly unknown[] }> = [
  { name: 'start + finish (turno vazio)', frames: [{ type: 'start' }, { type: 'finish' }] },
  {
    name: 'text run completo',
    frames: [
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'oi' },
      { type: 'text-delta', id: 't1', delta: ' mundo' },
      { type: 'text-end', id: 't1' },
      { type: 'finish' },
    ],
  },
  {
    name: 'reasoning run completo',
    frames: [
      { type: 'start' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'pensando' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'finish' },
    ],
  },
  {
    name: 'tool run com output',
    frames: [
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'shell',
        input: { cmd: 'ls' },
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'a.txt' },
      { type: 'finish' },
    ],
  },
  {
    name: 'tool run com erro',
    frames: [
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'shell',
        input: {},
        dynamic: true,
      },
      { type: 'tool-output-error', toolCallId: 'c1', errorText: 'exit 1' },
      { type: 'finish' },
    ],
  },
  {
    name: 'texto + ferramenta intercalados',
    frames: [
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'vou rodar' },
      { type: 'text-end', id: 't1' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'shell',
        input: {},
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'ok' },
      { type: 'finish' },
    ],
  },
  {
    name: 'data part nao transient entra no transcript',
    frames: [
      { type: 'start' },
      { type: 'data-message', data: { id: 'a1', role: 'assistant' } },
      { type: 'finish' },
    ],
  },
  {
    name: 'data part transient NAO entra no transcript',
    frames: [
      { type: 'start' },
      { type: 'data-checkpoint', data: { resumeToken: 's1' }, transient: true },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'x' },
      { type: 'finish' },
    ],
  },
  {
    name: 'start com messageId explícito',
    frames: [
      { type: 'start', messageId: 'm-42' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'x' },
      { type: 'text-end', id: 't1' },
      { type: 'finish' },
    ],
  },
]

describe('diferencial — o espelho reproduz o oráculo', () => {
  for (const { name, frames } of CASES) {
    it(`test_diferencial_${name.replace(/[^a-z0-9]+/gi, '_')}`, async () => {
      const text = sse(frames)
      const [oracle, mirror] = await Promise.all([viaOracle(text), viaMirror(text)])
      expect(wireVisible(mirror)).toEqual(wireVisible(oracle))
    })
  }

  it('test_diferencial_cobre_toda_variante_de_transcript', () => {
    // Anti-truncation floor: the case list must exercise every transcript-bearing variant. A case
    // set that silently shrank would let the oracle pass while covering nothing.
    const covered = new Set(CASES.flatMap((c) => c.frames.map((f) => (f as { type: string }).type)))
    for (const t of [
      'start',
      'finish',
      'text-start',
      'text-delta',
      'text-end',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'tool-input-available',
      'tool-output-available',
      'tool-output-error',
      // A família `data-*` entrou nesta lista DEPOIS de escapar: a primeira versão do reader a
      // descartava inteira e o diferencial não acusou, porque a asserção de cobertura tinha sido
      // escrita a partir da mesma suposição errada. Quem pegou foi um teste de consumidor.
      'data-message',
      'data-checkpoint',
    ]) {
      expect(covered, `variante ${t} sem caso diferencial`).toContain(t)
    }
  })
})
