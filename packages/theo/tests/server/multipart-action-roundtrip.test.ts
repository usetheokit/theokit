import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'

import { executeAction } from '../../src/server/http/action-execute.js'

/**
 * usetheokit/theokit#430 — the whole chain, over a real socket.
 *
 * The sibling suites cover the parser and the consumer end separately. Neither
 * reaches `synthesizeFormData`, which is private to `action-execute.ts` and is
 * the middle link where a repeated field would have been re-collapsed into
 * `'a,b'`. Asserting on a local copy of it would be asserting on a string this
 * test wrote itself — the defect class that let #430 ship in the first place.
 *
 * So this drives the production path: a real multipart POST, through Busboy,
 * through the real `synthesizeFormData`, into a real Zod schema. Revert any of
 * the three edits and this goes red.
 */
const BOUNDARY = 'theo430boundary'

function multipartBody(entries: [string, string][]): string {
  const parts = entries.map(
    ([name, value]) =>
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  )
  return parts.join('') + `--${BOUNDARY}--\r\n`
}

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()))
  server = undefined
})

async function postForm(
  schema: z.ZodObject<z.ZodRawShape>,
  entries: [string, string][],
): Promise<{ received: unknown; status: number }> {
  let received: unknown

  server = createServer((req, res) => {
    void executeAction(
      '/virtual/action.ts',
      'act',
      req,
      res,
      async () => ({
        act: {
          input: schema,
          accept: 'form',
          handler: ({ input }: { input: unknown }) => {
            received = input
            return { ok: true }
          },
        },
      }),
      undefined,
      undefined,
      undefined,
      'off', // csrfMode — the origin check is not what this test is about
    )
  })

  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo

  const body = multipartBody(entries)
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
      'X-Theo-Action': '1',
    },
    body,
  })
  await res.text()

  return { received, status: res.status }
}

describe('#430 — a repeated multipart field reaches the action handler', () => {
  it('delivers every value of a repeated field', async () => {
    const { received, status } = await postForm(z.object({ tags: z.array(z.string()) }), [
      ['tags', 'first'],
      ['tags', 'second'],
      ['tags', 'third'],
    ])

    expect(status).toBe(200)
    expect(received).toEqual({ tags: ['first', 'second', 'third'] })
  })

  it('still delivers a scalar field as a string', async () => {
    const { received, status } = await postForm(z.object({ name: z.string() }), [['name', 'Ada']])

    expect(status).toBe(200)
    expect(received).toEqual({ name: 'Ada' })
  })

  it('carries a scalar and a repeated field in the same submission', async () => {
    const { received, status } = await postForm(
      z.object({ name: z.string(), tags: z.array(z.string()) }),
      [
        ['name', 'Ada'],
        ['tags', 'a'],
        ['tags', 'b'],
      ],
    )

    expect(status).toBe(200)
    expect(received).toEqual({ name: 'Ada', tags: ['a', 'b'] })
  })
})
