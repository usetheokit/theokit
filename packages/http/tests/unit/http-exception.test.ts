import { describe, it, expect } from 'vitest'
import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  NotAcceptableException,
  RequestTimeoutException,
  ConflictException,
  GoneException,
  PreconditionFailedException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  ImATeapotException,
  UnprocessableEntityException,
  InternalServerErrorException,
  NotImplementedException,
  BadGatewayException,
  ServiceUnavailableException,
  GatewayTimeoutException,
  HttpVersionNotSupportedException,
} from '../../src/exceptions/index.js'

describe('T1.1 — HttpException hierarchy', () => {
  it('test_http_exception_has_status_and_message', () => {
    const ex = new HttpException('fail', 400)
    expect(ex.statusCode).toBe(400)
    expect(ex.message).toBe('fail')
    expect(ex.code).toBe('BAD_REQUEST')
  })

  it('test_http_exception_is_error', () => {
    expect(new HttpException('x', 500)).toBeInstanceOf(Error)
  })

  it('test_not_found_exception_defaults', () => {
    const ex = new NotFoundException()
    expect(ex.statusCode).toBe(404)
    expect(ex.message).toBe('Not Found')
    expect(ex.code).toBe('NOT_FOUND')
  })

  it('test_bad_request_with_custom_message', () => {
    expect(new BadRequestException('invalid input').message).toBe('invalid input')
  })

  it('test_exception_with_cause', () => {
    const cause = new Error('root')
    const ex = new HttpException('wrap', 500, { cause })
    expect(ex.cause).toBe(cause)
  })

  it('test_exception_toJSON_envelope', () => {
    const json = new NotFoundException('Task 99 not found').toJSON()
    expect(json).toEqual({
      error: { code: 'NOT_FOUND', message: 'Task 99 not found', statusCode: 404 },
    })
  })

  it('test_exception_with_description', () => {
    const ex = new BadRequestException('fail', { description: 'Field x is required' })
    const json = ex.toJSON()
    expect(json.error.description).toBe('Field x is required')
  })

  it('test_all_18_builtins_have_correct_status', () => {
    const cases: [new () => HttpException, number][] = [
      [BadRequestException, 400],
      [UnauthorizedException, 401],
      [ForbiddenException, 403],
      [NotFoundException, 404],
      [MethodNotAllowedException, 405],
      [NotAcceptableException, 406],
      [RequestTimeoutException, 408],
      [ConflictException, 409],
      [GoneException, 410],
      [PreconditionFailedException, 412],
      [PayloadTooLargeException, 413],
      [UnsupportedMediaTypeException, 415],
      [ImATeapotException, 418],
      [UnprocessableEntityException, 422],
      [InternalServerErrorException, 500],
      [NotImplementedException, 501],
      [BadGatewayException, 502],
      [ServiceUnavailableException, 503],
      [GatewayTimeoutException, 504],
      [HttpVersionNotSupportedException, 505],
    ]
    for (const [Ctor, expected] of cases) {
      const ex = new Ctor()
      expect(ex.statusCode).toBe(expected)
      expect(ex).toBeInstanceOf(HttpException)
      expect(ex).toBeInstanceOf(Error)
    }
  })
})
