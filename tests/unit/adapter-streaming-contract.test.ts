/**
 * #382 — which deploy targets hand their runtime a response that is still
 * being written, and which are delisted for it.
 *
 * **This file reads generated source. It cannot observe a chunk boundary**, and
 * a suite made only of checks like these is exactly why the shim buffered
 * whole responses for as long as it did — `streaming-ssr.test.ts` and its
 * siblings grep the emitted module for a symbol and never run a request. The
 * runtime proof lives in `web-shim-streaming.test.ts`, which drives a real
 * stream through the shim and times the arrivals.
 *
 * What these checks are for is the half a runtime test cannot reach without a
 * deploy: that each emitted handler passes the in-flight run into
 * `toResponse()` instead of awaiting it first. Awaiting `executeRoute()` before
 * taking the Response re-buffers the whole body in the handler even though the
 * shim streams — a second buffering point, one per target.
 */
import { describe, it, expect } from 'vitest'

import {
  renderAwsLambdaEntry,
  buildAwsLambda,
} from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { resolveAdapter } from '../../packages/theo/src/adapters/registry.js'
import type { BuildTarget } from '../../packages/theo/src/adapters/types.js'
import { VALID_TARGETS } from '../../packages/theo/src/adapters/types.js'
import {
  renderVercelFunctionEntry,
  renderVercelVcConfigJson,
} from '../../packages/theo/src/adapters/vercel.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

const SHIM_CONSUMERS: Record<string, () => string> = {
  cloudflare: () => renderCloudflareWorkerEntry({ ssrStreaming: false }),
  vercel: () => renderVercelFunctionEntry(),
  netlify: () => renderNetlifyFunction(),
  bun: () => renderBunEntry(3000),
  'deno-deploy': () => renderDenoEntry(3000),
  'aws-lambda': () => renderAwsLambdaEntry(),
}

describe('#382 — no emitted handler awaits the run before taking the Response', () => {
  for (const [target, render] of Object.entries(SHIM_CONSUMERS)) {
    it(`${target} passes the run into toResponse()`, () => {
      const source = render()
      expect(source).toContain('toResponse(executeRoute(')
      // The shape that made a fixed shim useless: finish the run, then ask for
      // a Response that by then has every byte.
      expect(source).not.toMatch(/await executeRoute\(/)
    })
  }
})

describe('#382 — the second buffering point in the two adapters that had one', () => {
  it('vercel drains the body into the Node response instead of materializing a string', () => {
    const source = renderVercelFunctionEntry()
    expect(source).not.toContain('webResponse.text()')
    expect(source).toContain('webResponse.body.getReader()')
  })

  it('vercel declares the platform flag without which the function is buffered anyway', () => {
    expect(renderVercelVcConfigJson().supportsResponseStreaming).toBe(true)
  })

  it('aws-lambda still materializes a string, and says so rather than degrading quietly', () => {
    const source = renderAwsLambdaEntry()
    // The v2 result object carries `body` as a string; this is not a bug left
    // unfixed, it is the contract the target has.
    expect(source).toContain('body: await response.text()')
    expect(source).toContain('text/event-stream')
    expect(source).toContain('delisted for streaming')
  })
})

describe('#382 — every target declares whether it streams', () => {
  const EXPECTED: Record<BuildTarget, boolean> = {
    node: true,
    vercel: true,
    cloudflare: true,
    static: false,
    bun: true,
    'deno-deploy': true,
    netlify: true,
    'aws-lambda': false,
    'theo-cloud': false,
  }

  for (const target of VALID_TARGETS) {
    it(`${target} declares streamsResponses = ${String(EXPECTED[target])}`, async () => {
      const adapter = await resolveAdapter(target)
      expect(adapter.streamsResponses === true).toBe(EXPECTED[target])
    })
  }
})

describe('#382 — asking a delisted target for streaming fails by name', () => {
  const config = {
    appDir: 'app',
    serverDir: 'server',
    port: 3000,
    ssr: false,
    serialization: 'json',
    ssrStreaming: true,
  } as unknown as TheoConfig

  it('the aws-lambda build refuses instead of emitting a handler that cannot stream', async () => {
    await expect(
      buildAwsLambda(config, '/cwd', {
        runNodeBuild: async () => {},
        writeEntry: () => {},
        ensureDir: () => {},
      }),
    ).rejects.toThrow(/aws-lambda.*does not stream/s)
  })
})
