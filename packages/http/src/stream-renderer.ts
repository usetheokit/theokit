/**
 * Streaming SSR — renders a React element tree to a `ReadableStream<Uint8Array>`.
 *
 * Inspired by Next.js `stream-ops.ts`. Uses Web Standard `renderToReadableStream`
 * (works on Node 18+, Bun, Deno). Falls back to `renderToString` wrapped in a
 * ReadableStream when `renderToReadableStream` is not available (React 17 — EC-4).
 *
 * React is loaded via dynamic `import('react-dom/server')` because react-dom
 * is an optional peerDep of @theokit/http (ADR D2).
 */

import type * as ReactTypes from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamRenderOptions {
  /** React element to render */
  root: ReactTypes.ReactElement
  /** Whether to wait for all Suspense to resolve (default: false — stream immediately) */
  waitForAll?: boolean
}

export interface StreamRenderResult {
  /** The HTML stream */
  stream: ReadableStream<Uint8Array>
  /** Promise that resolves when all content has been flushed */
  allReady: Promise<void>
}

// ---------------------------------------------------------------------------
// Doctype prefix
// ---------------------------------------------------------------------------

const DOCTYPE = '<!DOCTYPE html>'
const encoder = new TextEncoder()

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Renders a React element to a `ReadableStream<Uint8Array>` (Web Standard).
 *
 * 1. Tries `renderToReadableStream` first (React 18+ — Web Standard API).
 * 2. Falls back to `renderToString` wrapped in a ReadableStream when
 *    `renderToReadableStream` is not available (React 17 compat — EC-4).
 * 3. Prepends `<!DOCTYPE html>` to the stream.
 *
 * **EC-7 — Streaming error handling:** In streaming mode, errors thrown inside
 * Suspense boundaries are caught by React's streaming error handler and result
 * in a client-side error boundary activation (the shell is already sent). In
 * string mode (`renderToString`), errors throw synchronously before any bytes
 * are sent, allowing a full 500 error page. Choose streaming when you want
 * progressive rendering; choose string mode when you want atomic error handling.
 */
export async function renderToStream(options: StreamRenderOptions): Promise<StreamRenderResult> {
  const { root, waitForAll = false } = options

  // Dynamic import — react-dom is optional peerDep
  const reactDomServer = await import('react-dom/server')

  // Prefer renderToReadableStream (Web Standard — React 18+)
  if (typeof reactDomServer.renderToReadableStream === 'function') {
    return renderWithReadableStream(reactDomServer.renderToReadableStream, root, waitForAll)
  }

  // EC-4: Fallback to renderToString wrapped in ReadableStream (React 17)
  if (typeof reactDomServer.renderToString === 'function') {
    console.warn(
      '[theokit] renderToReadableStream not available — falling back to renderToString. ' +
        'Upgrade to React 18+ for streaming SSR support.',
    )
    return renderWithString(reactDomServer.renderToString, root)
  }

  throw new Error(
    '[theokit] react-dom/server does not export renderToReadableStream or renderToString. ' +
      'Ensure react-dom >= 17 is installed.',
  )
}

// ---------------------------------------------------------------------------
// Strategy: Web Standard renderToReadableStream
// ---------------------------------------------------------------------------

async function renderWithReadableStream(
  renderFn: (
    element: ReactTypes.ReactElement,
  ) => Promise<ReadableStream & { allReady: Promise<void> }>,
  root: ReactTypes.ReactElement,
  waitForAll: boolean,
): Promise<StreamRenderResult> {
  const reactStream = await renderFn(root)

  // If waitForAll, wait for all Suspense boundaries to resolve before emitting
  if (waitForAll) {
    await reactStream.allReady
  }

  // Prepend DOCTYPE
  const doctypeStream = prependDoctype(reactStream)

  return {
    stream: doctypeStream,
    allReady: reactStream.allReady,
  }
}

// ---------------------------------------------------------------------------
// Strategy: Fallback renderToString (EC-4)
// ---------------------------------------------------------------------------

function renderWithString(
  renderFn: (element: ReactTypes.ReactElement) => string,
  root: ReactTypes.ReactElement,
): StreamRenderResult {
  const html = DOCTYPE + renderFn(root)
  const bytes = encoder.encode(html)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

  return {
    stream,
    allReady: Promise.resolve(),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Prepends `<!DOCTYPE html>` bytes to a ReadableStream.
 */
function prependDoctype(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let doctypeSent = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!doctypeSent) {
        controller.enqueue(encoder.encode(DOCTYPE))
        doctypeSent = true
      }
      const { value, done } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(value)
    },
    cancel() {
      void reader.cancel()
    },
  })
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

/**
 * Converts a {@link StreamRenderResult} into a Web Standard `Response`.
 *
 * Convenience wrapper for use in request handlers:
 * ```ts
 * const result = await renderToStream({ root: <App /> })
 * return streamToResponse(result)
 * ```
 */
export function streamToResponse(result: StreamRenderResult): Response {
  return new Response(result.stream, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
