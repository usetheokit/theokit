/**
 * Fixtures shared by the composed-app tests: `composition.test.ts` (composeTheoClaw and its routes)
 * and `start-theoclaw.test.ts` (the process lifecycle of startTheoClaw).
 */
import type { PlatformName } from '@theokit/gateway'
import { computeLineSignature } from '@theokit/gateway-line'

import type { PlatformBuild } from '../src/channels/channel-loop.js'
import type { MaskableStream } from '../src/channels/output-mask.js'
import type { ConfiguredPlatform } from '../src/channels/platforms.js'
import type { TurnAgent } from '../src/channels/reply-handler.js'
import { FakeAdapter, FakeAgent } from './fakes.js'

/** A stream that keeps what was written to it, for the output mask to wrap. */
export function capturingStream(): MaskableStream & { readonly text: () => string } {
  const chunks: Buffer[] = []
  return {
    write: ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
      if (typeof done === 'function') done()
      return true
    }) as NodeJS.WriteStream['write'],
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
}

export const LINE_SECRET = 'line-channel-secret'
export const LINE_BODY = JSON.stringify({
  events: [
    { type: 'message', timestamp: 1, source: { type: 'user', userId: 'U-1' }, message: { id: 'm-1', type: 'text', text: 'hi' } },
  ],
})
export const TELEGRAM_AND_LINE = {
  THEOCLAW_PORT: '0',
  THEOCLAW_MODEL: 'test-model',
  OPENROUTER_API_KEY: 'openrouter-key-value',
  THEOCLAW_TELEGRAM_TOKEN: 'telegram-token-value',
  THEOCLAW_LINE_CHANNEL_SECRET: LINE_SECRET,
  THEOCLAW_LINE_CHANNEL_ACCESS_TOKEN: 'line-access-token',
}

export function signedLinePost(base = 'http://localhost'): Request {
  return new Request(`${base}/webhooks/line`, {
    method: 'POST',
    headers: { 'x-line-signature': computeLineSignature(LINE_SECRET, LINE_BODY) },
    body: LINE_BODY,
  })
}

export function chunkedPost(path: string, totalBytes: number): Request {
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close()
      const size = Math.min(65_536, totalBytes - sent)
      controller.enqueue(new Uint8Array(size).fill(0x61))
      sent += size
    },
  })
  return new Request(`http://localhost${path}`, { method: 'POST', body, duplex: 'half' } as RequestInit)
}

/** FakeAdapter builders for whatever is configured; `adapters` exposes them to the test. */
export function fakeBuilders(overrides: Partial<Record<PlatformName, FakeAdapter>> = {}) {
  const adapters = new Map<PlatformName, FakeAdapter>()
  const builders = (configured: readonly ConfiguredPlatform[]): PlatformBuild[] =>
    configured.map(({ platform }) => ({
      platform,
      build: () => {
        const adapter = overrides[platform] ?? new FakeAdapter(platform)
        adapters.set(platform, adapter)
        return adapter
      },
    }))
  return { adapters, builders }
}

export const noAgent = (): TurnAgent => new FakeAgent({ frames: [] })
