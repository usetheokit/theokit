import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { dispatchControllerRequest } from '../../packages/theo/src/server/http/controller-dispatch.js'
import { nodeRequest, recordingResponse } from '../helpers/node-http-stubs.js'

/**
 * A controller that answers with binary — audio, an image, a PDF, a gzip blob — must deliver the
 * bytes it produced. Measured 2026-08-26 against theokit 0.56.0, it did not: `@theokit/plugin-voice`
 * synthesised a 55 296-byte MPEG whose first bytes were `ff f3 c4 c4`, and the same call through a
 * controller arrived as 76 790 bytes starting `ef bf bd` — the UTF-8 replacement character,
 * repeated. Every byte >= 0x80 had been replaced.
 *
 * The failure is silent by construction: status 200, `content-type: audio/mpeg`, a plausible length.
 * Only opening the file shows it. File routes were never affected — they pipe the stream — so this
 * is a divergence between two paths that are supposed to be at parity.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_binary_test__')
const CONTROLLERS_DIR = join(TEST_ROOT, 'controllers')

/** Every byte value 0x00-0xff once. Nothing survives a UTF-8 round-trip unchanged. */
const EVERY_BYTE = new Uint8Array(256).map((_, i) => i)

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { Controller, Get } from '@theokit/http'

@Controller('api/binary')
export class BinaryController {
  @Get('bytes')
  bytes() {
    const body = new Uint8Array(256)
    for (let i = 0; i < 256; i++) body[i] = i
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
}
`

describe('a controller answering with binary', () => {
  beforeAll(() => {
    mkdirSync(CONTROLLERS_DIR, { recursive: true })
    writeFileSync(join(CONTROLLERS_DIR, 'binary.controller.ts'), CONTROLLER_SRC)
  })

  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('delivers the bytes it produced, unchanged', async () => {
    const { res, chunks, status } = recordingResponse()

    const handled = await dispatchControllerRequest({
      controllersDir: CONTROLLERS_DIR,
      loadModule: loadControllerWithSwc,
      req: nodeRequest({ method: 'GET', url: '/api/binary/bytes' }),
      res,
      csrfMode: 'off',
      requestId: 'binary-test',
    })

    expect(handled).toBe(true)
    expect(status()).toBe(200)

    const received = Buffer.concat(chunks)
    // Length first: a UTF-8 round-trip INFLATES, so this alone localises the failure.
    expect(received.length).toBe(EVERY_BYTE.length)
    expect(Uint8Array.from(received)).toEqual(EVERY_BYTE)
  })
})
