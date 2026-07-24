/**
 * Server-side action result serializer.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 1 / T1.3 + ADR D1.
 * Wraps `devalue.stringify` for success payloads (preserves Date/Set/URL/bigint
 * roundtrip) and JSON-encodes error envelopes for `ActionError` /
 * `ActionInputError`. Returns a `SerializedActionResult` discriminated union
 * consumed by the HTTP send layer (`action-execute.ts`).
 *
 * EC absorbed:
 *   - EC-3 (response side): `responseBodySizeLimit` default 5 MB; throws
 *     `ActionError({code:'PAYLOAD_TOO_LARGE'})` when the serialized body
 *     exceeds the limit. Prevents handler-returns-100MB DoS.
 */
import { stringify as devalueStringify } from 'devalue'

import {
  ActionError,
  ActionInputError,
  type ActionResult,
  type SerializedActionResult,
} from '../../core/contracts/action-protocol.js'

const DEFAULT_RESPONSE_BODY_SIZE_LIMIT = 5 * 1024 * 1024 // 5 MB

interface SerializeOptions {
  /**
   * Maximum allowed length of the serialized response body in BYTES (UTF-8
   * length of `body` string is checked, not the JS string length). Default
   * 5 MB. Configurable via `defineConfig({security:{responseBodySizeLimit}})`.
   */
  responseBodySizeLimit?: number
}

/**
 * Serialize an action result for the wire.
 *
 *  - Success with data: `application/json+devalue` body via devalue.stringify
 *    with a `URL` reviver for round-tripping URL instances.
 *  - Success with `undefined` data: status 204 empty.
 *  - Error: `application/json` JSON body with type discriminator
 *    (`TheoActionError` or `TheoActionInputError`) + code + message
 *    (+ fields/issues for input errors).
 *
 * Throws `ActionError({code:'PAYLOAD_TOO_LARGE'})` if the serialized body
 * exceeds the configured size limit (EC-3).
 *
 * Throws on `Response` instance as data (Astro guard — handler must return
 * plain JSON-serializable values, not Web Response objects).
 */
export function serializeActionResult(
  result: ActionResult,
  options: SerializeOptions = {},
): SerializedActionResult {
  const limit = options.responseBodySizeLimit ?? DEFAULT_RESPONSE_BODY_SIZE_LIMIT

  if (result.error !== undefined) {
    const body =
      result.error instanceof ActionInputError
        ? JSON.stringify({
            type: result.error.type,
            code: result.error.code,
            message: result.error.message,
            issues: result.error.issues,
            fields: result.error.fields,
          })
        : JSON.stringify({
            type: result.error.type,
            code: result.error.code,
            message: result.error.message,
          })
    if (Buffer.byteLength(body, 'utf8') > limit) {
      throw new ActionError({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Serialized error body exceeds limit (${limit} bytes)`,
      })
    }
    return {
      type: 'error',
      status: result.error.status,
      contentType: 'application/json',
      body,
    }
  }

  if (result.data === undefined) {
    return { type: 'empty', status: 204 }
  }

  if (result.data instanceof Response) {
    throw new ActionError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Action handler cannot serialize Response objects — return plain data instead',
    })
  }

  let body: string
  try {
    body = devalueStringify(result.data, {
      URL: (value: unknown) => value instanceof URL && value.href,
    })
  } catch (e) {
    throw new ActionError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Action data not serializable: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  if (Buffer.byteLength(body, 'utf8') > limit) {
    throw new ActionError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Serialized response body exceeds limit (${limit} bytes)`,
    })
  }

  return {
    type: 'data',
    status: 200,
    contentType: 'application/json+devalue',
    body,
  }
}
