/**
 * @theokit/tauri (ADR-0055) — the desktop transport glue. `createTauriChannelSource` bridges the Tauri
 * `Channel`/`invoke` into a `ChannelPushSource` (M42); `createTauriAgentClient` wires it to the M44 no-React
 * client. The Tauri primitives are injected (a fake `{ invoke, Channel }` — no `@tauri-apps` dep needed).
 */
import type { UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import {
  createTauriAgentClient,
  createTauriChannelSource,
  type TauriChannel,
  type TauriCore,
} from '../src/index.js'
import { runTurnToJsonl } from '../src/sidecar.js'

/** A fake Tauri `core` whose `run_turn` invoke pushes scripted JSONL lines to the channel, then resolves. */
function fakeCore(runLines: string[] = []): { core: TauriCore; invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'run_turn' && args?.onChunk) {
      const channel = args.onChunk as TauriChannel
      for (const line of runLines) channel.onmessage(line)
    }
    return undefined
  })
  class Channel implements TauriChannel {
    onmessage: (line: string) => void = () => undefined
  }
  return { core: { invoke, Channel } as unknown as TauriCore, invoke }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createTauriChannelSource (@theokit/tauri)', () => {
  it('bridges pushed JSONL lines to onLine (splitting multi-line events) + resolves onClose', async () => {
    const { core, invoke } = fakeCore([
      '{"type":"start"}\n{"type":"text-delta","id":"t","delta":"hi"}',
    ])
    const source = createTauriChannelSource(core)
    const lines: string[] = []
    let closed = false
    source.start(
      { message: 'hello' },
      { onLine: (l) => lines.push(l), onClose: () => (closed = true) },
    )
    await tick()

    expect(invoke).toHaveBeenCalledWith('run_turn', expect.objectContaining({ message: 'hello' }))
    expect(lines).toEqual(['{"type":"start"}', '{"type":"text-delta","id":"t","delta":"hi"}'])
    expect(closed).toBe(true)
  })

  it('settle invokes the approve command with { approvalId, approved } (reason dropped — the shell only needs the verdict)', async () => {
    const { core, invoke } = fakeCore()
    const source = createTauriChannelSource(core)
    await source.settle?.('a2', { approved: false, reason: 'denied by user' })
    expect(invoke).toHaveBeenCalledWith('approve', { approvalId: 'a2', approved: false })
  })

  it('routes a run_turn rejection to onError (never swallowed as a clean close)', async () => {
    const core = {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'run_turn') throw new Error('command failed')
      }),
      Channel: class implements TauriChannel {
        onmessage: (line: string) => void = () => undefined
      },
    } as unknown as TauriCore
    const source = createTauriChannelSource(core)
    let error: unknown
    let closed = false
    source.start(
      { message: 'x' },
      { onLine: () => undefined, onClose: () => (closed = true), onError: (e) => (error = e) },
    )
    await tick()
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('command failed')
    expect(closed).toBe(false) // an error is NOT a clean close
  })

  it('wraps a non-Error rejection (the common Rust-side string) into an Error for onError', async () => {
    const core = {
      invoke: vi.fn((cmd: string) => {
        // Intentionally reject with a plain string — the exact non-Error shape a Rust command
        // emits. Asserting we survive it is the whole point of this test.
        return cmd === 'run_turn'
          ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above
            Promise.reject('sidecar spawn failed')
          : Promise.resolve(undefined)
      }),
      Channel: class implements TauriChannel {
        onmessage: (line: string) => void = () => undefined
      },
    } as unknown as TauriCore
    const source = createTauriChannelSource(core)
    let error: unknown
    source.start(
      { message: 'x' },
      { onLine: () => undefined, onClose: () => undefined, onError: (e) => (error = e) },
    )
    await tick()
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('sidecar spawn failed')
  })

  it('honors custom runCommand / approveCommand', async () => {
    const { core, invoke } = fakeCore()
    const source = createTauriChannelSource(core, {
      runCommand: 'my_run',
      approveCommand: 'my_approve',
    })
    source.start({ message: 'x' }, { onLine: () => undefined, onClose: () => undefined })
    await source.settle?.('a', { approved: true })
    expect(invoke.mock.calls.map((c) => c[0])).toContain('my_run')
    expect(invoke).toHaveBeenCalledWith('my_approve', { approvalId: 'a', approved: true })
  })
})

describe('createTauriAgentClient (@theokit/tauri)', () => {
  it('streams a turn over the Tauri transport into reconstructed UIMessages', async () => {
    const { core } = fakeCore([
      '{"type":"start"}',
      '{"type":"text-start","id":"t0"}',
      '{"type":"text-delta","id":"t0","delta":"Hi"}',
      '{"type":"text-end","id":"t0"}',
      '{"type":"finish"}',
    ])
    const client = createTauriAgentClient(core)
    let final: UIMessage | undefined
    for await (const message of client.stream({ message: 'hi' })) final = message

    const text = (final?.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hi')
  })
})

describe('runTurnToJsonl (@theokit/tauri/sidecar)', () => {
  it('surfaces a failed turn as a trailing {type:error} JSONL line, never swallowed (Rule 8)', async () => {
    const lines: string[] = []
    // An empty module has no resolvable agent — streamAgentTurnInProcess fails fast (before any LLM call).
    await runTurnToJsonl({}, 'no-key', 'hi', (line) => lines.push(line))

    expect(lines.length).toBeGreaterThan(0)
    const parsed = lines.map((l) => JSON.parse(l.trim()) as { type: string; errorText?: string })
    const errorLine = parsed.find((p) => p.type === 'error')
    expect(errorLine).toBeDefined()
    expect(typeof errorLine?.errorText).toBe('string')
    expect(errorLine?.errorText?.length).toBeGreaterThan(0)
  })
})
