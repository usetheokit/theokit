import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { dispatchControllerRequest } from '../../packages/theo/src/server/http/controller-dispatch.js'
import { nodeRequest, recordingResponse } from '../helpers/node-http-stubs.js'

/*
 * A webhook endpoint authenticates by signature, and CSRF has nothing to protect there.
 *
 * The controller CSRF gate is uniform: every POST/PUT/PATCH/DELETE that a controller owns must
 * carry `X-Theo-Action`. Stripe, GitHub and every other sender never will — they authenticate with
 * an HMAC over the body, which is stronger than the header and entirely unrelated to it.
 *
 * Measured 2026-08-27 against a real app: a `@Controller` mounting
 * `StripeWebhookControllerBase`, declared `theokit:public`, answered
 * `403 CSRF_INVALID — Missing X-Theo-Action header` to a delivery. So no webhook could be served
 * without setting `csrf: 'warn'` for the whole application, which is the trade this exemption
 * exists to avoid.
 *
 * The declaration is DELIBERATELY separate from `theokit:public`. They answer different questions —
 * "may an unauthenticated caller reach this?" and "does this route authenticate by other means?" —
 * and a route can be public without wanting the CSRF gate lifted.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__csrf_exempt_test__')
const CONTROLLERS_DIR = join(TEST_ROOT, 'controllers')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { Controller, Post, SetMetadata } from '@theokit/http'

@Controller('api/hook')
@SetMetadata('theokit:public', true)
@SetMetadata('theokit:csrf-exempt', true)
export class HookController {
  @Post()
  receive() {
    return { received: true }
  }
}

@Controller('api/guarded')
@SetMetadata('theokit:public', true)
export class GuardedController {
  @Post()
  receive() {
    return { received: true }
  }
}
`

describe('a controller that authenticates by signature', () => {
  beforeAll(() => {
    mkdirSync(CONTROLLERS_DIR, { recursive: true })
    writeFileSync(join(CONTROLLERS_DIR, 'hook.controller.ts'), CONTROLLER_SRC)
  })
  afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }))

  it('is reachable without the X-Theo-Action header when it declares the exemption', async () => {
    const { res, status } = recordingResponse()

    await dispatchControllerRequest({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
      req: nodeRequest({ url: '/api/hook' }),
      res,
      csrfMode: 'strict',
      requestId: 'exempt-test',
    })

    expect(status()).not.toBe(403)
  })

  it('still refuses a controller that did NOT declare it', async () => {
    // The half that keeps the exemption from becoming a hole: absence still means the gate applies,
    // and a POST with no `X-Theo-Action` is refused exactly as before.
    const { res, status } = recordingResponse()

    await dispatchControllerRequest({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
      req: nodeRequest({ url: '/api/guarded' }),
      res,
      csrfMode: 'strict',
      requestId: 'exempt-test',
    })

    expect(status()).toBe(403)
  })
})
