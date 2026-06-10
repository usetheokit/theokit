/**
 * Exception filter pipeline — Web Standard Request/Response.
 *
 * Returns a Response instead of writing to ServerResponse.
 * EC-1: recursion guard — filter that throws → global fallback.
 */
import { HttpException } from '../exceptions/http-exception.js'
import { getMeta, CATCH_EXCEPTIONS } from '../metadata/index.js'

import { resolveOrNew, type DiContainer } from './di-resolve.js'

/** Interface for exception filter classes (bound via @UseFilters). */
export interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Response | Promise<Response>
}

/** ArgumentsHost — Web Standard. */
export interface ArgumentsHost {
  getRequest(): Request
}

/**
 * Run exception filters and return an error Response.
 * Returns the filter's Response or a built-in fallback.
 */
export async function runExceptionFilters(
  exception: unknown,
  filters: Function[],
  request: Request,
  container?: DiContainer,
): Promise<Response> {
  const host: ArgumentsHost = {
    getRequest: () => request,
  }

  for (const FilterCtor of filters) {
    const catchTypes = getMeta<Function[]>(CATCH_EXCEPTIONS, FilterCtor) ?? []
    if (matchesException(exception, catchTypes)) {
      const filter = resolveOrNew(FilterCtor, container) as ExceptionFilter
      try {
        return await filter.catch(exception, host)
      } catch (filterError) {
        // EC-1: filter itself threw — fall to global fallback
        console.error('[@theokit/http-decorators] Exception filter threw:', filterError)
        return globalFallback(exception)
      }
    }
  }

  return builtInResponse(exception)
}

function matchesException(exception: unknown, catchTypes: Function[]): boolean {
  if (catchTypes.length === 0) return true
  return catchTypes.some((Type) => exception instanceof Type)
}

function builtInResponse(exception: unknown): Response {
  if (exception instanceof HttpException) {
    return new Response(JSON.stringify(exception.toJSON()), {
      status: exception.statusCode,
      headers: { 'content-type': 'application/json' },
    })
  }
  return globalFallback(exception)
}

function globalFallback(exception: unknown): Response {
  const message = exception instanceof Error ? exception.message : 'Internal server error'
  console.error('[@theokit/http-decorators] Unhandled exception:', exception)
  return new Response(
    JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message, statusCode: 500 } }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  )
}
