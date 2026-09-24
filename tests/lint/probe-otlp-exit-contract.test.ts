/**
 * The probe's `--ingest` is user input at a CLI boundary, and its diagnostics are the whole product:
 * this script exists to say what it could NOT measure, so a message naming the wrong cause is the
 * failure it was written to prevent.
 *
 * Driven as a subprocess because the module runs the whole probe at import — there is no exported
 * surface to call. The interface is therefore the process: its arguments, its streams and its exit
 * code, which is what an operator meets and what the header makes promises about.
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

/**
 * Runs the probe with `args` and returns its exit code with both streams, never throwing on non-zero.
 *
 * `stdout` is carried as well as `stderr` because exit 0 now has to SHOW what it observed. A code
 * alone cannot distinguish an earned pass from the unconditional one B-294 recorded.
 */
async function probe(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      'npx',
      ['tsx', 'scripts/probe-otlp-delivery.ts', ...args],
      {
        cwd: process.cwd(),
        timeout: 120_000,
      },
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('probe-otlp-delivery exit contract', () => {
  // A missing scheme is the likeliest typo. Before this case the probe answered it with the guard's
  // own message — "answers below 400 … on a path it does not serve" — sending the reader to debug a
  // collector when the fault is in their flag. Exit 2 was right; the sentence was not.
  it('names the flag, not the collector, when --ingest is not a URL', async () => {
    const { code, stderr } = await probe(['--ingest', '127.0.0.1:4318/v1/traces'])
    expect(code).toBe(2)
    expect(stderr).toContain('--ingest')
    expect(stderr).toContain('NOT MEASURED')
    expect(stderr).not.toContain('answers below 400')
  }, 130_000)
})

/**
 * B-294 — every exit code the header documents, driven through the only interface the probe has.
 *
 * A receiver stands in for the collector, and it is a real HTTP server: the probe's control POSTs to a
 * path it does not serve and must be refused, then the exporter POSTs the span for real. Nothing about
 * the probe is stubbed — what changes between the exit-0 and the exit-1 case is one status the server
 * answers, which is exactly the difference the probe was failing to read.
 *
 * Measured before the fix, against the exit-1 receiver: the span was refused with 404 and the probe
 * exited 0, printing the epilogue that sends the operator to read back a span the collector threw
 * away. That is the defect, and it is what the second case below pins.
 */
describe('probe-otlp-delivery — the documented exit codes are reachable', () => {
  /**
   * An HTTP server that refuses everything except `acceptPath`, which it answers with `acceptStatus`.
   *
   * Refusing the unknown path is what lets the probe's own control pass, so the run gets as far as
   * exporting. A receiver that accepted everything would be rejected by the control instead — which
   * is the `permissive` case, exercised separately below.
   */
  async function receiver(acceptPath: string | null, acceptStatus = 200) {
    const seen: string[] = []
    const server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        const status = req.url === acceptPath ? acceptStatus : 404
        seen.push(`${String(req.method)} ${String(req.url)} -> ${String(status)}`)
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return {
      url: `http://127.0.0.1:${String(port)}/v1/traces`,
      seen,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    }
  }

  it('Given a collector that accepts the span, Then exit 0', async () => {
    const collector = await receiver('/v1/traces', 200)
    try {
      const { code, stdout } = await probe(['--ingest', collector.url])
      expect(code).toBe(0)
      // The evidence is printed, not merely implied by the code: a reader must be able to tell an
      // earned exit 0 from an unconditional one, which is the whole of B-294.
      expect(stdout).toMatch(/accepted/i)
      expect(collector.seen.some((l) => l.includes('/v1/traces -> 200'))).toBe(true)
    } finally {
      await collector.close()
    }
  }, 130_000)

  it('Given a collector that refuses the span, Then exit 1 rather than a green exit 0', async () => {
    // The measured defect. `/v1/traces` answers 404 while an unknown path answers 404 too, so the
    // control is satisfied and the delivery is refused — and the probe used to exit 0 here.
    const collector = await receiver(null)
    try {
      const { code, stderr } = await probe(['--ingest', collector.url])
      expect(code).toBe(1)
      expect(stderr).toContain('404')
      expect(collector.seen.some((l) => l.includes('/v1/traces -> 404'))).toBe(true)
    } finally {
      await collector.close()
    }
  }, 130_000)

  it('Given nothing listening, Then exit 2 names the unreachable endpoint', async () => {
    // Port 1 on loopback: privileged, and nothing binds it. "Could not measure" must stay distinct
    // from "measured and failed", which is why this is 2 and the case above is 1.
    const { code, stderr } = await probe(['--ingest', 'http://127.0.0.1:1/v1/traces'])
    expect(code).toBe(2)
    expect(stderr).toContain('NOT MEASURED')
    expect(stderr).toMatch(/nothing answered/i)
  }, 130_000)

  it('Given a receiver that accepts everything, Then exit 2 — the control refuses to measure', async () => {
    // A success against a receiver that cannot say no would say nothing at all. This is the condition
    // the probe's control was written for, and it must outrank the delivery check: the run never gets
    // far enough to export.
    const permissive = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => permissive.listen(0, '127.0.0.1', resolve))
    const { port } = permissive.address() as AddressInfo
    try {
      const { code, stderr } = await probe([
        '--ingest',
        `http://127.0.0.1:${String(port)}/v1/traces`,
      ])
      expect(code).toBe(2)
      expect(stderr).toMatch(/answers below 400/)
    } finally {
      await new Promise<void>((resolve) => permissive.close(() => resolve()))
    }
  }, 130_000)
})
