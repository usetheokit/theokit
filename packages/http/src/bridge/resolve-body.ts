import type { WalkResult } from './walk-metadata.js'

/**
 * Read the request body for `@Body`, without consuming the request the handler still needs.
 *
 * `clone()` and not `request` itself: this read exists to populate `@Body`, and a handler taking
 * `@Req()` needs a body it can read. Reading the original leaves `bodyUsed: true`, so a multipart
 * upload or a webhook needing the exact signed bytes reaches the handler with its content-type
 * intact and its payload gone (theokit#534). The clone tees the stream; the original stays
 * untouched.
 *
 * A non-JSON payload lands in the `catch` and yields `undefined`, which is deliberate — the parse
 * failing is not an error, it just means there is no JSON body to bind.
 *
 * Returns a `Response` when a declared schema rejects the body, so the caller can answer 422 rather
 * than reach a handler with input the contract refuses.
 *
 * One function rather than a copy per entry point: `create-server.ts` and `theokit-plugin.ts` held
 * byte-identical versions, and the fix above had to be written into both. The second copy is where
 * a correction goes missing.
 */
export async function resolveBody(
  method: string,
  request: Request,
  walk: WalkResult,
  jsonResponse: (status: number, body: unknown) => Response,
): Promise<unknown> {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined

  let body: unknown
  try {
    const text = await request.clone().text()
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }

  if (walk.bodySchema && body !== undefined) {
    const result = walk.bodySchema.safeParse(body)
    if (!result.success) {
      return jsonResponse(422, { error: { code: 'VALIDATION_ERROR', issues: result.error.issues } })
    }
    body = result.data
  }
  return body
}
