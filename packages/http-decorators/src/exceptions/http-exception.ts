/**
 * HttpException hierarchy for @theokit/http-decorators.
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
}

export class HttpException extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly description?: string

  constructor(message: string, statusCode: number, options?: HttpExceptionOptions) {
    super(message, options?.cause ? { cause: options.cause } : undefined)
    this.name = this.constructor.name
    this.statusCode = statusCode
    this.code = STATUS_CODES[statusCode] ?? 'INTERNAL_SERVER_ERROR'
    this.description = options?.description
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

function factory(status: number, defaultMsg: string) {
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
 * import { HttpStatus } from '@theokit/http-decorators'
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
