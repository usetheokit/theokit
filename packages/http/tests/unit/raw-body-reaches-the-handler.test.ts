import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { Controller } from '../../src/decorators/controller.js'
import { Post } from '../../src/decorators/methods.js'
import { Req } from '../../src/decorators/params.js'
import { createDecoratorHandler } from '../../src/bridge/create-server.js'
import { Public } from '../../src/decorators/public.js'

/*
 * A controller that needs the RAW body must be able to read it.
 *
 * `resolveBody` reads `await request.text()` for every POST/PUT/PATCH so `@Body` can be populated,
 * and swallows the parse failure when the payload is not JSON. The read still happens, so the
 * `Request` handed to `@Req()` arrives with `bodyUsed: true` and every later read throws
 * "Body is unusable: Body has already been read".
 *
 * Measured 2026-08-27 against @theokit/http@1.1.1 through a running app: a `multipart/form-data`
 * upload reached the handler with its content-type and boundary intact and its body gone, so
 * `@theokit/plugin-voice`'s transcription endpoint answered 400 for every request including valid
 * audio. The same read breaks Stripe webhook verification, which needs the exact bytes that were
 * signed — there, a body the handler cannot read is a signature that cannot be checked.
 */

const MULTIPART_BOUNDARY = '----theokitTestBoundary'

function multipartRequest(): Request {
  const body =
    `--${MULTIPART_BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="language"\r\n\r\n' +
    `pt\r\n--${MULTIPART_BOUNDARY}--\r\n`
  return new Request('http://local/api/probe', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` },
    body,
  })
}

describe('a controller reading the raw body', () => {
  it('receives a request whose body has not already been consumed', async () => {
    let seen: { bodyUsed: boolean; formLanguage: string | null; error: string | null } | undefined

    @Public()
    @Controller('api/probe')
    class ProbeController {
      @Post()
      async probe(@Req() request: Request) {
        const bodyUsed = request.bodyUsed
        let formLanguage: string | null = null
        let error: string | null = null
        try {
          const form = await request.formData()
          formLanguage = form.get('language') as string | null
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
        seen = { bodyUsed, formLanguage, error }
        return { ok: true }
      }
    }

    const handler = createDecoratorHandler([ProbeController])
    await handler(multipartRequest())

    // The first assertion localises the defect; the second proves the consequence.
    expect(seen?.bodyUsed).toBe(false)
    expect(seen?.error).toBeNull()
    expect(seen?.formLanguage).toBe('pt')
  })

  it('still parses a JSON body into @Body, which is what the read was for', async () => {
    // The counterpart that keeps the fix honest: whatever replaces the unconditional read must not
    // cost the JSON path, which is the one every other controller in the ecosystem depends on.
    const { Body } = await import('../../src/decorators/params.js')
    let received: unknown

    @Public()
    @Controller('api/json')
    class JsonController {
      @Post()
      handle(@Body() body: unknown) {
        received = body
        return { ok: true }
      }
    }

    const handler = createDecoratorHandler([JsonController])
    await handler(
      new Request('http://local/api/json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      }),
    )

    expect(received).toEqual({ hello: 'world' })
  })
})
