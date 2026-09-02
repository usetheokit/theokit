/**
 * HttpException hierarchy for @theokit/http.
 *
 * Per ADR D2: response shape {error: {code, message, statusCode}} matches
 * existing guard (401) and validation (422) format.
 */

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  418: 'IM_A_TEAPOT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
  505: 'HTTP_VERSION_NOT_SUPPORTED',
}

export interface HttpExceptionOptions {
  cause?: Error
  description?: string
  /**
   * Response headers that belong to THIS refusal (usetheokit/theokit#612).
   *
   * Some statuses are not complete without them. `429` without `Retry-After` tells a client it went
   * too fast and not when it may return, so a well-behaved client can only guess and a badly
   * behaved one retries immediately. The same holds for `401` + `WWW-Authenticate`, `405` + `Allow`
   * and `503` + `Retry-After`: the header is not decoration, it is the half of the answer that says
   * what to do next.
   *
   * Before this existed, a guard computing `X-RateLimit-*` had nowhere to put them — `canActivate`
   * returns a boolean and owns no response — so the numbers were discarded at the boundary and the
   * caller received a bare `403`.
   *
   * `content-type` is set by the dispatcher and is not overridable here: the body is always the
   * `toJSON()` shape, and letting a header claim otherwise would describe a body that does not
   * exist.
   */
  headers?: Readonly<Record<string, string>>
}

export class HttpException extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly description?: string
  /** Headers this refusal carries. Empty unless the thrower supplied some. See {@link HttpExceptionOptions.headers}. */
  public readonly headers: Readonly<Record<string, string>>

  constructor(message: string, statusCode: number, options?: HttpExceptionOptions) {
    super(message, options?.cause ? { cause: options.cause } : undefined)
    this.name = this.constructor.name
    this.statusCode = statusCode
    this.code = STATUS_CODES[statusCode] ?? 'INTERNAL_SERVER_ERROR'
    this.description = options?.description
    // Frozen: an exception in flight is a value, and a dispatcher that mutated it would change what
    // an exception filter downstream sees.
    this.headers = Object.freeze({ ...options?.headers })
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        ...(this.description ? { description: this.description } : {}),
      },
    }
  }
}

/**
 * The constructor shape every status-named exception shares.
 *
 * Declared explicitly (usetheokit/theokit#612) because inference erased it where it mattered most.
 * Without a return type, `tsup` emitted each subclass's base as an ANONYMOUS structural object —
 * `{ new (…): { statusCode: number; name: string; message: string; stack?: string } }` — so
 * `TooManyRequestsException` was, to a consumer's type checker, no longer an `Error`. Every app
 * writing `throw new UnauthorizedException()` therefore tripped `@typescript-eslint/only-throw-error`
 * against the framework's own exceptions, and the honest reading of that lint was correct: the
 * published types no longer said these were errors.
 */
type HttpExceptionConstructor = new (
  message?: string,
  options?: HttpExceptionOptions,
) => HttpException

function factory(status: number, defaultMsg: string): HttpExceptionConstructor {
  return class extends HttpException {
    constructor(message = defaultMsg, options?: HttpExceptionOptions) {
      super(message, status, options)
      this.name = this.constructor.name
    }
  }
}

export class BadRequestException extends factory(400, 'Bad Request') {}
export class UnauthorizedException extends factory(401, 'Unauthorized') {}
export class ForbiddenException extends factory(403, 'Forbidden') {}
export class NotFoundException extends factory(404, 'Not Found') {}
export class MethodNotAllowedException extends factory(405, 'Method Not Allowed') {}
export class NotAcceptableException extends factory(406, 'Not Acceptable') {}
export class RequestTimeoutException extends factory(408, 'Request Timeout') {}
export class ConflictException extends factory(409, 'Conflict') {}
export class GoneException extends factory(410, 'Gone') {}
export class PreconditionFailedException extends factory(412, 'Precondition Failed') {}
export class PayloadTooLargeException extends factory(413, 'Payload Too Large') {}
export class UnsupportedMediaTypeException extends factory(415, 'Unsupported Media Type') {}
export class ImATeapotException extends factory(418, "I'm a Teapot") {}
export class UnprocessableEntityException extends factory(422, 'Unprocessable Entity') {}
export class InternalServerErrorException extends factory(500, 'Internal Server Error') {}
export class NotImplementedException extends factory(501, 'Not Implemented') {}
export class BadGatewayException extends factory(502, 'Bad Gateway') {}
export class ServiceUnavailableException extends factory(503, 'Service Unavailable') {}
export class GatewayTimeoutException extends factory(504, 'Gateway Timeout') {}
export class HttpVersionNotSupportedException extends factory(505, 'HTTP Version Not Supported') {}
export class TooManyRequestsException extends factory(429, 'Too Many Requests') {}

/**
 * HttpStatus enum — all standard HTTP status codes as named constants.
 *
 * @example
 * ```ts
 * import { HttpStatus } from '@theokit/http'
 *
 * @HttpCode(HttpStatus.CREATED)
 * @Post()
 * create() { ... }
 *
 * if (res.status === HttpStatus.NOT_FOUND) { ... }
 * ```
 */
export const HttpStatus = {
  // 2xx Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // 3xx Redirection
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  // 4xx Client Error
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IM_A_TEAPOT: 418,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  // 5xx Server Error
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus]
