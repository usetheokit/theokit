import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { ActionError } from '../../packages/theo/src/core/contracts/action-protocol.js'
import { executeAction } from '../../packages/theo/src/server/http/action-execute.js'
import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'
import { localUrl, rememberFromAddress } from './helpers/local-url.js'

/**
 * A server action gets `ctx.queue` with the same outbox rule a route has (usetheokit/theokit#1096):
 * what it enqueues reaches the backend only when the response succeeded. An action that throws,
 * typed or not, answers with an error status and must leave no job behind.
 */
type Handler = (args: { ctx: Record<string, unknown> }) => unknown

let server: Server | undefined
let backend: InMemoryJobBackend

afterEach(async () => {
  backend.destroy()
  if (server) await new Promise<void>((r) => server?.close(() => r()))
  server = undefined
})

async function serveAction(handler: Handler): Promise<number> {
  backend = new InMemoryJobBackend()
  const input = { safeParse: (value: unknown) => ({ success: true, data: value }) }
  server = createServer((req, res) => {
    void executeAction(
      '/virtual/actions/tasks.ts',
      'createTask',
      req,
      res,
      () => Promise.resolve({ createTask: { input, handler } }),
      undefined,
      undefined,
      undefined,
      'off',
      undefined,
      backend,
    )
  })
  await new Promise<void>((r) => server?.listen(0, r))
  const address = server.address() as AddressInfo
  rememberFromAddress(address.port, address.family)
  return address.port
}

async function callThenCountJobs(port: number): Promise<{ status: number; jobs: number }> {
  const response = await fetch(localUrl(port, '/api/__actions/tasks/createTask'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  await response.text()
  // The outbox flushes on the response's `finish` event; give it a turn.
  await new Promise((r) => setTimeout(r, 50))
  const leases = await backend.dequeue({ batchSize: 10, lockSeconds: 1 })
  return { status: response.status, jobs: leases.length }
}

function enqueue(ctx: Record<string, unknown>): void {
  const queue = ctx.queue as { enqueue: (name: string, input: unknown) => void }
  queue.enqueue('from-action', { n: 1 })
}

describe('an action enqueues through ctx.queue only when it succeeds', () => {
  it('a successful action reaches the backend after the response', async () => {
    const port = await serveAction(({ ctx }) => {
      enqueue(ctx)
      return { ok: true }
    })
    expect(await callThenCountJobs(port)).toEqual({ status: 200, jobs: 1 })
  })

  it('an action that throws an ActionError leaves no job', async () => {
    const port = await serveAction(({ ctx }) => {
      enqueue(ctx)
      throw new ActionError({ code: 'CONFLICT', message: 'already exists' })
    })
    const outcome = await callThenCountJobs(port)
    expect(outcome.status).toBeGreaterThanOrEqual(400)
    expect(outcome.jobs).toBe(0)
  })

  it('an action that throws an untyped error leaves no job', async () => {
    const port = await serveAction(({ ctx }) => {
      enqueue(ctx)
      throw new Error('boom')
    })
    expect(await callThenCountJobs(port)).toEqual({ status: 500, jobs: 0 })
  })
})
