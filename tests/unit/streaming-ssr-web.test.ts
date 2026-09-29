import { describe, it, expect } from 'vitest'
import { generateEntryServer } from '../../packages/theo/src/router/entry-server.js'

describe('generateEntryServer — renderStreamingWeb (T2.3)', () => {
  it('exports renderStreamingWeb when streaming is enabled', () => {
    const out = generateEntryServer({ streaming: true })
    expect(out).toContain('export async function renderStreamingWeb')
  })

  it('renderStreamingWeb uses renderToReadableStream (Web API)', () => {
    const out = generateEntryServer({ streaming: true })
    expect(out).toContain('renderToReadableStream')
  })

  it('renderStreamingWeb returns a Response with ReadableStream body', () => {
    const out = generateEntryServer({ streaming: true })
    expect(out).toMatch(/return new Response/)
    expect(out).toMatch(/text\/html/)
  })

  it('renderStreamingWeb honors request.signal abort (EC-8 — EC-11 in old plan)', () => {
    const out = generateEntryServer({ streaming: true })
    expect(out).toMatch(/signal/)
  })

  it('single-shot mode does NOT export renderStreamingWeb', () => {
    const out = generateEntryServer({ streaming: false })
    expect(out).not.toContain('renderStreamingWeb')
  })

  it('default (no opts) does NOT export renderStreamingWeb', () => {
    const out = generateEntryServer()
    expect(out).not.toContain('renderStreamingWeb')
  })
})

describe('cf/bun/vercel adapters consume renderStreamingWeb when streaming on', () => {
  it('cloudflare template references renderStreamingWeb option', async () => {
    const { renderCloudflareWorkerEntry } =
      await import('../../packages/theo/src/adapters/cloudflare.js')
    const out = renderCloudflareWorkerEntry()
    // CF template must support routing GET non-API requests through the
    // streaming entry when available. Adapter detects via env-injected flag.
    expect(out).toMatch(/renderStreamingWeb|ssrStreaming/)
  })

  it('bun adapter imports the renderer when the feature is wired', async () => {
    // This asserted `/renderStreamingWeb|ssrStreaming|streaming/` against `renderBunEntry(3000)` —
    // no options at all, so the feature its own name calls "wired" was off. It passed on the string
    // `// (ssrStreaming off)`, which is a COMMENT: the entire implementation of `ssrStreaming` in that
    // adapter was which comment landed on line 4, and this test was what made that look covered.
    //
    // Measured on Bun 1.3.14 with the feature genuinely on: 531 bytes and an empty `<div id="root">`
    // before, 14732 bytes with 3546 bytes of rendered markup after (B-334).
    const { renderBunEntry } = await import('../../packages/theo/src/adapters/bun.js')
    const out = renderBunEntry(3000, { ssr: true, htmlHead: '<head></head>', htmlTail: '</html>' })

    expect(
      out,
      'the bun entry does not import the renderer, so an ssr build answers the client shell while ' +
        'the build announces (SSR)',
    ).toContain("import { renderStreamingWeb } from '../server/entry-server.js'")
    expect(out).toContain('await renderStreamingWeb(request, {')
  })

  it('bun adapter serves the built shell when ssr is off', async () => {
    // COUNTERPROOF, and the half the original test lacked: with the feature off the import must be
    // ABSENT. Without this, `toContain` would pass over an adapter that imports the renderer
    // unconditionally and pays for an SSR bundle on a static build.
    const { renderBunEntry } = await import('../../packages/theo/src/adapters/bun.js')
    const out = renderBunEntry(3000)

    expect(out).not.toContain('renderStreamingWeb')
    expect(out).toContain("const indexPath = join(clientDir, 'index.html')")
  })
})
