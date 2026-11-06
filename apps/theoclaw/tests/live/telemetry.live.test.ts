import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, describe, expect, it } from 'vitest'

import { createTheoClawAgent } from '../../src/agent/create-agent.js'
import { agentOptionsFor } from '../../src/control-plane/agent-factory.js'
import type { TurnAgent } from '../../src/control-plane/turn.js'
import { readTelemetrySettings, registerTelemetry, type RegisteredTelemetry } from '../../src/telemetry/otel.js'
import { waitFor } from '../fakes.js'

/**
 * AC-008 (B-400, OC-98's built half): TheoClaw's own `registerTelemetry` pointed at a local
 * OTLP/HTTP receiver, and a real model turn through an agent built with TheoClaw's own options.
 * Then the receiver stops: the next turn still answers and an export failure is one stderr line.
 * Runs only with THEOCLAW_LIVE=1, THEOCLAW_MODEL and a key.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const TURN_TIMEOUT_MS = 120_000

interface Receiver {
  readonly endpoint: string
  /** Every request body by path, decoded as latin1 so a protobuf's strings stay searchable. */
  readonly bodies: Map<string, string[]>
  close(): Promise<void>
}

async function startReceiver(): Promise<Receiver> {
  const bodies = new Map<string, string[]>()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const path = request.url ?? ''
      bodies.set(path, [...(bodies.get(path) ?? []), Buffer.concat(chunks).toString('latin1')])
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}`,
    bodies,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function turn(agent: TurnAgent): Promise<string> {
  const run = await agent.send('Reply with exactly the word: pong')
  for await (const _ of run.stream()) void _
  return (await run.wait()).status
}

const closers: Array<() => Promise<void>> = []
afterAll(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

describe.skipIf(!LIVE)('OpenTelemetry export against a real model (OC-98)', () => {
  it("TheoClaw's OTLP registration delivers an agent.send span to the local receiver", { timeout: TURN_TIMEOUT_MS * 2 }, async () => {
    if (!process.env.THEOCLAW_MODEL || !(process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY)) {
      throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
    }
    const receiver = await startReceiver()
    closers.push(() => receiver.close())
    const env = { ...process.env, THEOCLAW_OTEL: 'on', OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint, THEOCLAW_PROMETHEUS_PORT: '0' }
    const lines: string[] = []
    const registered: RegisteredTelemetry = registerTelemetry(readTelemetrySettings(env), { write: (line) => void lines.push(line) })
    closers.push(() => registered.shutdown())
    const agent = (await createTheoClawAgent(agentOptionsFor(env))) as unknown as TurnAgent & { [Symbol.asyncDispose](): Promise<void> }
    closers.push(() => agent[Symbol.asyncDispose]())

    expect(await turn(agent)).toBe('finished')
    registered.log('theoclaw: live model turn finished')
    await registered.flush()
    const scrape = await fetch((await registered.prometheusEndpoint)!)
    expect(await scrape.text()).toContain('theokit_llm_call_duration_ms')
    expect((receiver.bodies.get('/v1/logs') ?? []).join('')).toContain('theoclaw: live model turn finished')
    await waitFor(() => (receiver.bodies.get('/v1/traces') ?? []).some((body) => body.includes('agent.send')), 20_000, 'an agent.send span')
    await waitFor(
      () => (receiver.bodies.get('/v1/metrics') ?? []).some((body) => body.includes('theokit_llm_call_duration_ms')),
      20_000,
      'the theokit_llm_call_duration_ms histogram',
    )
    expect((receiver.bodies.get('/v1/traces') ?? []).join('')).toContain('theoclaw')
    expect(lines).toEqual([])

    // The collector goes away: the next turn still answers, and the failed export is reported.
    await receiver.close()
    expect(await turn(agent)).toBe('finished')
    await registered.flush()
    await waitFor(() => lines.length >= 1, 20_000, 'an export failure line')
    // The cause names the collector that went away, and no line carries the model key.
    expect(lines.join('\n')).toMatch(new RegExp(`ECONNREFUSED|${new URL(receiver.endpoint).port}`))
    const key = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY ?? ''
    for (const line of lines) expect(line).not.toContain(key)
  })
})
