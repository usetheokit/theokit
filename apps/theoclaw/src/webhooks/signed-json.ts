export interface SignedJsonAdapter {
  handleWebhook(
    rawBody: string,
    first: string | undefined,
    second?: string | undefined,
  ): Promise<{ readonly status: number; readonly body?: unknown }>
}

type Route = (request: Request) => Promise<Response>

function respond(answer: { readonly status: number; readonly body?: unknown }): Response {
  if (answer.body === undefined) return new Response(null, { status: answer.status })
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
}

function header(request: Request, name: string): string | undefined {
  return request.headers.get(name) ?? undefined
}

/** Yuanbao: `x-signature` over `x-timestamp` and the raw body. */
export function createYuanbaoRoute(adapter: SignedJsonAdapter): Route {
  return async (request) =>
    respond(await adapter.handleWebhook(await request.text(), header(request, 'x-signature'), header(request, 'x-timestamp')))
}

/** QQ Bot: Ed25519 signature and timestamp headers; the callback URL validation answers a JSON body. */
export function createQqRoute(adapter: SignedJsonAdapter): Route {
  return async (request) =>
    respond(
      await adapter.handleWebhook(
        await request.text(),
        header(request, 'x-signature-ed25519'),
        header(request, 'x-signature-timestamp'),
      ),
    )
}

/** Zalo OA: `x-zevent-signature` over the raw body. */
export function createZaloRoute(adapter: SignedJsonAdapter): Route {
  return async (request) => respond(await adapter.handleWebhook(await request.text(), header(request, 'x-zevent-signature')))
}
