export interface WeixinAdapter {
  handleWebhook(
    query: { signature?: string; msg_signature?: string; timestamp?: string; nonce?: string; echostr?: string },
    rawBody?: string,
  ): Promise<{ readonly status: number; readonly body: string }>
}

/**
 * The WeChat and WeCom webhook: the query carries the signature, a GET (no body) answers the
 * server-URL check and a POST carries the raw XML. A 503 stays a 503 so the platform retries.
 */
export function createWeixinRoute(adapter: WeixinAdapter): (request: Request) => Promise<Response> {
  return async (request) => {
    const params = new URL(request.url).searchParams
    const query = Object.fromEntries(params) as Parameters<WeixinAdapter['handleWebhook']>[0]
    const answer = await adapter.handleWebhook(query, request.method === 'GET' ? undefined : await request.text())
    return new Response(answer.body, { status: answer.status })
  }
}
