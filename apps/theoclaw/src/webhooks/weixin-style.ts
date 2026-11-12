import type { BasePlatformAdapter } from '@theokit/gateway'

/** What the five Chinese and Vietnamese platform adapters answer a webhook with. */
interface Answer {
  readonly status: number
  readonly body?: unknown
}

type QueryAdapter = BasePlatformAdapter & {
  handleWebhook(query: Record<string, string | undefined>, rawBody?: string): Promise<Answer>
}

type SignedAdapter = BasePlatformAdapter & {
  handleWebhook(rawBody: string, ...headers: (string | undefined)[]): Promise<Answer>
}

function hasHandleWebhook(adapter: BasePlatformAdapter): boolean {
  return typeof (adapter as { handleWebhook?: unknown }).handleWebhook === 'function'
}

function respond(answer: Answer): Response {
  if (answer.body === undefined) return new Response(null, { status: answer.status })
  if (typeof answer.body === 'string') {
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * WeChat and WeCom: the signature is in the query string, the message in the body; a GET is the
 * server-URL check. A 503 stays a 503 so the platform redelivers.
 */
export function createQueryRoute(adapter: BasePlatformAdapter): (request: Request) => Promise<Response> {
  if (!hasHandleWebhook(adapter)) throw new Error('the built adapter cannot answer a webhook')
  const target = adapter as QueryAdapter
  return async (request) => {
    const query = Object.fromEntries(new URL(request.url).searchParams)
    const raw = request.method === 'POST' ? await request.text() : undefined
    return respond(await target.handleWebhook(query, raw))
  }
}

/** Yuanbao, QQ and Zalo: the raw body and the named signature headers go to the adapter, which verifies them. */
export function createSignedBodyRoute(
  adapter: BasePlatformAdapter,
  headerNames: readonly string[],
): (request: Request) => Promise<Response> {
  if (!hasHandleWebhook(adapter)) throw new Error('the built adapter cannot answer a webhook')
  const target = adapter as SignedAdapter
  return async (request) => {
    const raw = await request.text()
    const values = headerNames.map((name) => request.headers.get(name) ?? undefined)
    return respond(await target.handleWebhook(raw, ...values))
  }
}
