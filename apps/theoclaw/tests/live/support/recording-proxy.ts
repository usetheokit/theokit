import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A loopback proxy in front of the real provider (B-400 T4.1): it forwards every request to
 * `upstream` unchanged and records the `usage` object of each answer as the provider sent it, so
 * a check compares TheoClaw's numbers with an independent source. Every wait is the request's own.
 */
export interface RecordingProxy {
  /** Base URL for a `{ id, url }` model selection. */
  readonly url: string
  /** The provider's own usage objects, one per answered request that carried one. */
  readonly usages: Array<{ readonly prompt_tokens?: number; readonly completion_tokens?: number }>
  /** How many requests reached the upstream. */
  requests(): number
  close(): Promise<void>
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

/** Every `usage` object in an SSE stream's `data:` lines, or in a plain JSON body. */
function usagesIn(text: string): RecordingProxy['usages'] {
  const payloads = text.includes('data:')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
    : [text]
  const found: RecordingProxy['usages'] = []
  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as { usage?: RecordingProxy['usages'][number] | null }
      if (parsed.usage) found.push(parsed.usage)
    } catch {
      // `[DONE]` and keep-alive comments carry no usage.
    }
  }
  return found
}

export async function startRecordingProxy(upstream: string): Promise<RecordingProxy> {
  const usages: RecordingProxy['usages'] = []
  let requests = 0
  const server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request)
      requests += 1
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string' && !['host', 'connection', 'content-length', 'accept-encoding'].includes(name)) headers.set(name, value)
      }
      const answer = await fetch(`${upstream}${(request.url ?? '').replace(/^\/v1/, '')}`, {
        method: request.method ?? 'POST',
        headers,
        ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
      })
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' })
      let text = ''
      const decoder = new TextDecoder()
      for await (const chunk of answer.body ?? []) {
        text += decoder.decode(chunk as Uint8Array, { stream: true })
        response.write(chunk)
      }
      response.end()
      usages.push(...usagesIn(text))
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(502)
      response.end(String(error))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1`,
    usages,
    requests: () => requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
