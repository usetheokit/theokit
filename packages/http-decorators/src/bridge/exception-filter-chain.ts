/**
 * Exception filter pipeline for @theokit/http-decorators.
 *
 * Catches exceptions from the middleware → guards → interceptors → handler pipeline.
 * Per D3: method-level filters override class-level.
 * EC-1: recursion guard prevents infinite loop when filter itself throws.
 * EC-2: res.headersSent check prevents ERR_HTTP_HEADERS_SENT crash.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { HttpException } from '../exceptions/http-exception.js'
import { getMeta, CATCH_EXCEPTIONS } from '../metadata/index.js'

import { resolveOrNew, type DiContainer } from './di-resolve.js'

/** Interface for exception filter classes (bound via @UseFilters). */
export interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void | Promise<void>
}

/** Simplified host — HTTP-only per ADR D1 (no switchToHttp indirection). */
export interface ArgumentsHost {
  getRequest(): IncomingMessage
  getResponse(): ServerResponse
}

/**
 * Run exception filters for a caught exception.
 *
 * Priority: method-level filters → class-level filters → global fallback.
 * Per D3: method-level overrides class-level (first match wins).
 */
export async function runExceptionFilters(
  exception: unknown,
  filters: Function[],
  req: IncomingMessage,
  res: ServerResponse,
  container?: DiContainer,
): Promise<void> {
  // EC-2: if headers already sent, log and bail — can't write a new response
  if (res.headersSent) {
    console.error('[@theokit/http-decorators] Exception after headers sent:', exception)
    return
  }

  const host: ArgumentsHost = {
    getRequest: () => req,
    getResponse: () => res,
  }

  // Try to find a matching filter
  for (const FilterCtor of filters) {
    const catchTypes = getMeta<Function[]>(CATCH_EXCEPTIONS, FilterCtor) ?? []
    if (matchesException(exception, catchTypes)) {
      const filter = resolveOrNew(FilterCtor, container) as ExceptionFilter
      try {
        await filter.catch(exception, host)
        return
      } catch (filterError) {
        // EC-1: filter itself threw — fall through to global fallback, no recursion
        console.error('[@theokit/http-decorators] Exception filter threw:', filterError)
        sendGlobalFallback(exception, res)
        return
      }
    }
  }

  // No custom filter matched — use built-in handling
  sendBuiltInResponse(exception, res)
}

/** Check if exception matches the @Catch types. Empty array = catch-all. */
function matchesException(exception: unknown, catchTypes: Function[]): boolean {
  if (catchTypes.length === 0) return true // catch-all
  return catchTypes.some((Type) => exception instanceof Type)
}

/** Built-in response: HttpException → typed JSON, other → 500. */
function sendBuiltInResponse(exception: unknown, res: ServerResponse): void {
  if (exception instanceof HttpException) {
    const json = exception.toJSON()
    res.writeHead(exception.statusCode, { 'content-type': 'application/json' })
    res.end(JSON.stringify(json))
  } else {
    sendGlobalFallback(exception, res)
  }
}

/** Global fallback: always 500 with generic message. Logs the real error. */
function sendGlobalFallback(exception: unknown, res: ServerResponse): void {
  const message = exception instanceof Error ? exception.message : 'Internal server error'
  console.error('[@theokit/http-decorators] Unhandled exception:', exception)
  if (!res.headersSent) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message, statusCode: 500 } }))
  }
}
