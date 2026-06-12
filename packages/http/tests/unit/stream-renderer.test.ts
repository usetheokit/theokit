import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'

// vi.doMock is vitest-only; skip mock-dependent tests on Bun
const hasDoMock = typeof vi !== 'undefined' && typeof vi.doMock === 'function'

// Simple test component
function TestApp() {
  return React.createElement('html', null, React.createElement('body', null, 'Hello Stream'))
}

// Helper: collect a ReadableStream<Uint8Array> into a string
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  result += decoder.decode() // flush
  return result
}

describe('Stream Renderer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('test_render_to_stream_returns_readable_stream', async () => {
    // Given: a React element
    const { renderToStream } = await import('../../src/stream-renderer.js')
    const root = React.createElement(TestApp)

    // When: rendered to stream
    const result = await renderToStream({ root })

    // Then: result contains a ReadableStream and allReady promise
    expect(result.stream).toBeInstanceOf(ReadableStream)
    expect(result.allReady).toBeInstanceOf(Promise)
  })

  it('test_stream_includes_doctype', async () => {
    // Given: a React element
    const { renderToStream } = await import('../../src/stream-renderer.js')
    const root = React.createElement(TestApp)

    // When: rendered to stream and collected
    const result = await renderToStream({ root })
    const html = await streamToString(result.stream)

    // Then: starts with DOCTYPE
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('test_stream_includes_html_content', async () => {
    // Given: a React element with specific content
    const { renderToStream } = await import('../../src/stream-renderer.js')
    const root = React.createElement(TestApp)

    // When: rendered to stream and collected
    const result = await renderToStream({ root })
    const html = await streamToString(result.stream)

    // Then: contains the rendered HTML content
    expect(html).toContain('Hello Stream')
    expect(html).toContain('<html')
    expect(html).toContain('<body')
  })

  it('test_stream_content_collected_as_string', async () => {
    // Given: a React element with known content
    const { renderToStream, streamToResponse } = await import('../../src/stream-renderer.js')
    function ContentApp() {
      return React.createElement('div', { id: 'root' }, 'Collected Content')
    }
    const root = React.createElement(ContentApp)

    // When: rendered to stream and converted to response
    const result = await renderToStream({ root })
    const response = streamToResponse(result)

    // Then: response has correct headers and body
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await response.text()
    expect(body).toContain('<!DOCTYPE html>')
    expect(body).toContain('Collected Content')
    expect(body).toContain('id="root"')
  })

  it.skipIf(!hasDoMock)('test_fallback_to_string_when_streaming_false', async () => {
    // Given: renderToReadableStream is not available (simulating React 17 — EC-4)
    // We mock at the module level to replace the dynamic import result
    vi.doMock('react-dom/server', () => ({
      renderToString,
      renderToReadableStream: undefined,
    }))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Re-import to pick up the mocked react-dom/server
    const { renderToStream } = await import('../../src/stream-renderer.js')
    const root = React.createElement(TestApp)

    // When: rendered to stream (falls back to renderToString)
    const result = await renderToStream({ root })
    const html = await streamToString(result.stream)

    // Then: still produces valid HTML with DOCTYPE
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Hello Stream')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('renderToReadableStream not available'),
    )

    vi.doUnmock('react-dom/server')
  })

  it.skipIf(!hasDoMock)('test_stream_graceful_fallback_if_no_readable_stream', async () => {
    // Given: EC-4 — renderToReadableStream is not available
    vi.doMock('react-dom/server', () => ({
      renderToString,
      renderToReadableStream: undefined,
    }))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { renderToStream } = await import('../../src/stream-renderer.js')
    const root = React.createElement(TestApp)

    // When: rendered to stream
    const result = await renderToStream({ root })

    // Then: falls back gracefully, produces valid output
    expect(result.stream).toBeInstanceOf(ReadableStream)
    expect(result.allReady).toBeInstanceOf(Promise)
    await result.allReady // should resolve immediately for string fallback

    const html = await streamToString(result.stream)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Hello Stream')

    // And: warns about fallback
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to renderToString'))

    vi.doUnmock('react-dom/server')
  })
})
