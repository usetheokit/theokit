import { describe, it, expect } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * usetheokit/theokit#343, second half. The streaming document assembly was fixed
 * in the generated entry and left unfixed at its only caller: the Cloudflare
 * worker called `renderStreamingWeb(request)` with no options, and both
 * `htmlHead` and `htmlTail` default to the empty string. So on Workers the
 * response was still React output with no `<html>`, no `<head>`, no stylesheet
 * and no client entry - hydration data for a page that cannot hydrate.
 *
 * Fixing a helper and not its caller is the shape of defect this programme keeps
 * finding; this is the same one, authored by the same fix.
 */

const HEAD = '<!doctype html><html><head><title>t</title></head><body><div id="root">'
const TAIL = '</div><script type="module" src="/entry-client.js"></script></body></html>'

describe('the Cloudflare worker hands the renderer its document shell (#343)', () => {
  it('test_the_streaming_call_passes_the_template', () => {
    const entry = renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: HEAD,
      htmlTail: TAIL,
    })

    expect(entry).toContain('renderStreamingWeb(request, {')
    expect(entry).toContain('<head>')
    expect(entry).toContain('entry-client.js')
  })

  it('test_the_inlined_template_survives_being_embedded_in_source', () => {
    // The shell contains quotes, angle brackets and a closing script tag. Embedded
    // naively it produces a worker that fails to parse at DEPLOY time rather than
    // here, which is the worst place for this to surface.
    const entry = renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: HEAD,
      htmlTail: TAIL,
    })

    // Parsed rather than evaluated: the generator emits `JSON.stringify` output,
    // so `JSON.parse` round-trips it exactly and no code from the fixture runs.
    expect(JSON.parse(extractLiteral(entry, 'htmlHead'))).toBe(HEAD)
    expect(JSON.parse(extractLiteral(entry, 'htmlTail'))).toBe(TAIL)
  })

  it('test_streaming_off_does_not_emit_a_template', () => {
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false })

    expect(entry).not.toContain('renderStreamingWeb(request, {')
  })
})

/** Pull the emitted literal for a named field out of the generated source. */
function extractLiteral(source: string, field: string): string {
  const match = new RegExp(`${field}: ("(?:[^"\\\\]|\\\\.)*")`).exec(source)
  if (match === null) throw new Error(`no literal emitted for ${field}`)
  return match[1]
}
