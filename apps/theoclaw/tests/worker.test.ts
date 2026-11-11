import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { workerCommand, workerLogPath } from '../src/worker/worker.js'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'worker-'))
  const chunks: string[] = []
  const stdout = new PassThrough()
  stdout.on('data', (c: Buffer) => chunks.push(String(c)))
  const env = { THEOCLAW_STATE_DIR: dir, THEOCLAW_MODEL: 'm/x' }
  const fetchOk = (() =>
    Promise.resolve(new Response('{}', { status: 202 }))) as unknown as typeof fetch
  const agent = () =>
    Promise.resolve({
      send: () =>
        Promise.resolve({
          stream: async function* () {
            yield { type: 'text-delta', text: 'hi' }
          },
          wait: () => Promise.resolve({ status: 'finished' }),
          cancel: () => Promise.resolve(),
        }),
    })
  return {
    env,
    chunks,
    io: { env, stdout, stderr: new PassThrough(), fetch: fetchOk, agentFactory: agent as never },
  }
}

describe('theoclaw worker', () => {
  it('runs the model call on the worker and logs the provider request there', async () => {
    const { env, io, chunks } = setup()
    expect(await workerCommand(['pair', 'http://127.0.0.1:1', 'code', '--name', 'w1'], io)).toBe(0)
    expect(await workerCommand(['run', 'hello'], io)).toBe(0)
    expect(chunks.join('')).toContain('hi')
    expect(readFileSync(workerLogPath(env), 'utf8')).toContain(
      'provider request: model=m/x device=w1',
    )
  })

  it('does not log a provider request on the worker when inference is gateway', async () => {
    const { env, io } = setup()
    await workerCommand(['pair', 'http://127.0.0.1:1', 'code', '--inference', 'gateway'], io)
    await workerCommand(['run', 'hello'], io) // gateway unreachable: exits 1
    expect(existsSync(workerLogPath(env))).toBe(false)
  })
})
