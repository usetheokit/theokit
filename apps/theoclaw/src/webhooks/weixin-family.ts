/** The answer every one of these adapters' `handleWebhook` gives: a status to write back. */
interface Answer {
  readonly status: number
  readonly body?: string
}

/** WeChat and WeCom: the query string, and the raw body for a POST. */
export interface WeixinInbound {
  handleWebhook(query: Record<string, string>, rawBody?: string): Promise<Answer>
}

export interface YuanbaoInbound {
  handleWebhook(rawBody: string, signature: string | undefined, timestamp: string | undefined): Promise<Answer>
}

export interface ZaloInbound {
  handleWebhook(rawBody: string, signature: string | undefined): Promise<Answer>
}

/** The packages' messages are small; a larger body is refused unread past this. */
const MAX_BODY_BYTES = 1024 * 1024

type Route = (request: Request) => Promise<Response>

function reply(answer: Answer): Response {
  return new Response(answer.body ?? null, { status: answer.status })
}

async function boundedBody(request: Request): Promise<string | undefined> {
  const raw = await request.text()
  return Buffer.byteLength(raw) > MAX_BODY_BYTES ? undefined : raw
}

const tooLarge = (): Response => new Response(null, { status: 413 })

/** The WeChat / WeCom callback: GET answers the URL check, POST the signed message. */
export function createWeixinRoute(adapter: WeixinInbound): Route {
  return async (request) => {
    const query = Object.fromEntries(new URL(request.url).searchParams)
    if (request.method === 'GET') return reply(await adapter.handleWebhook(query))
    const raw = await boundedBody(request)
    return raw === undefined ? tooLarge() : reply(await adapter.handleWebhook(query, raw))
  }
}

/** The Yuanbao callback: the signature and timestamp travel in headers. */
export function createYuanbaoRoute(adapter: YuanbaoInbound): Route {
  return async (request) => {
    const raw = await boundedBody(request)
    if (raw === undefined) return tooLarge()
    const headers = request.headers
    return reply(
      await adapter.handleWebhook(raw, headers.get('x-signature') ?? undefined, headers.get('x-timestamp') ?? undefined),
    )
  }
}

/** The Zalo OA callback: the MAC travels in `X-ZEvent-Signature`. */
export function createZaloRoute(adapter: ZaloInbound): Route {
  return async (request) => {
    const raw = await boundedBody(request)
    if (raw === undefined) return tooLarge()
    return reply(await adapter.handleWebhook(raw, request.headers.get('x-zevent-signature') ?? undefined))
  }
}
