/**
 * The one place an `HttpException` becomes a `Response` (usetheokit/theokit#612).
 *
 * There were four: `app.ts` (twice), `theokit-plugin.ts`, `create-server.ts` and
 * `exception-filter-chain.ts` each built `new Response(JSON.stringify(ex.toJSON()), …)` by hand
 * with `content-type` as the only header. Four copies of one decision is four places to forget
 * something, and when `HttpException` grew headers, three of them would have kept discarding them —
 * which is the same defect as the guard contract dropping them, one layer down.
 *
 * This module is that decision, once. It is deliberately NOT a method on `HttpException`: the
 * exception is a domain value that a CLI, a queue consumer or a test can raise and inspect without
 * a `Response` existing anywhere, and giving it a `toResponse()` would put the HTTP transport
 * inside the error type. The transport owns the transport.
 */
import type { HttpException } from './http-exception.js'

/**
 * Render an `HttpException` as the response it describes.
 *
 * The body is always `exception.toJSON()`. `content-type` is written first so a caller-supplied
 * header can never claim the body is something it is not, and every other header the exception
 * carries is applied on top — `Retry-After` on a 429, `WWW-Authenticate` on a 401, `Allow` on a
 * 405.
 *
 * @param exception the refusal to render
 * @returns a JSON response with the exception's status and headers
 */
export function httpExceptionToResponse(exception: HttpException): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(exception.headers)) {
    // `content-type` is the dispatcher's to set: the body below is always the `toJSON()` shape, and
    // a header claiming otherwise would describe a body that does not exist.
    if (name.toLowerCase() === 'content-type') continue
    // `set`, not `append`: a repeated header name is a caller mistake, and two `Retry-After` values
    // is a client-visible ambiguity rather than a richer answer.
    headers.set(name, value)
  }
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(exception.toJSON()), {
    status: exception.statusCode,
    headers,
  })
}
