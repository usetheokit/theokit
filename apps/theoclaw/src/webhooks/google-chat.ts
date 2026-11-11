import type { GoogleChatInbound } from '@theokit/gateway-google-chat'

export type { GoogleChatInbound }

/** Chat's bodies are small; the package's own listener refuses more than this with 413. */
const MAX_BODY_BYTES = 1024 * 1024

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * The Google Chat webhook: the adapter verifies the Google-signed bearer token and answers, so the
 * route only forwards the header and the raw body. A request with no bearer token is refused before
 * its body is read, as the package's own listener does.
 */
export function createGoogleChatRoute(adapter: GoogleChatInbound): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = request.headers.get('authorization') ?? undefined
    if (!/^Bearer \S/.test(authorization ?? '')) return json(401, { error: 'no bearer token' })
    const raw = await request.text()
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(413, { error: 'request body too large' })
    const answer = await adapter.handleRequest(authorization, raw)
    return json(answer.status, { ...answer.body })
  }
}
