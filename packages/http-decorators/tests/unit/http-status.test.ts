import { describe, it, expect } from 'vitest'
import {
  HttpStatus,
  HttpException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  TooManyRequestsException,
  UnprocessableEntityException,
  InternalServerErrorException,
  ServiceUnavailableException,
  type HttpStatusCode,
} from '../../src/exceptions/http-exception.js'

describe('HttpStatus enum', () => {
  it('test_common_status_codes', () => {
    expect(HttpStatus.OK).toBe(200)
    expect(HttpStatus.CREATED).toBe(201)
    expect(HttpStatus.NO_CONTENT).toBe(204)
    expect(HttpStatus.BAD_REQUEST).toBe(400)
    expect(HttpStatus.UNAUTHORIZED).toBe(401)
    expect(HttpStatus.FORBIDDEN).toBe(403)
    expect(HttpStatus.NOT_FOUND).toBe(404)
    expect(HttpStatus.CONFLICT).toBe(409)
    expect(HttpStatus.UNPROCESSABLE_ENTITY).toBe(422)
    expect(HttpStatus.TOO_MANY_REQUESTS).toBe(429)
    expect(HttpStatus.INTERNAL_SERVER_ERROR).toBe(500)
    expect(HttpStatus.SERVICE_UNAVAILABLE).toBe(503)
  })

  it('test_type_safety', () => {
    // HttpStatusCode is a union of literal numbers
    const status: HttpStatusCode = HttpStatus.NOT_FOUND
    expect(status).toBe(404)
  })
})

describe('HttpException hierarchy', () => {
  it('test_exception_has_correct_status', () => {
    expect(new NotFoundException().statusCode).toBe(404)
    expect(new BadRequestException().statusCode).toBe(400)
    expect(new ConflictException().statusCode).toBe(409)
    expect(new UnauthorizedException().statusCode).toBe(401)
    expect(new ForbiddenException().statusCode).toBe(403)
    expect(new TooManyRequestsException().statusCode).toBe(429)
    expect(new UnprocessableEntityException().statusCode).toBe(422)
    expect(new InternalServerErrorException().statusCode).toBe(500)
    expect(new ServiceUnavailableException().statusCode).toBe(503)
  })

  it('test_exception_has_correct_code_string', () => {
    expect(new NotFoundException().code).toBe('NOT_FOUND')
    expect(new ConflictException().code).toBe('CONFLICT')
    expect(new TooManyRequestsException().code).toBe('TOO_MANY_REQUESTS')
  })

  it('test_custom_message', () => {
    const ex = new NotFoundException('Task 123 not found')
    expect(ex.message).toBe('Task 123 not found')
    expect(ex.statusCode).toBe(404)
  })

  it('test_default_message', () => {
    expect(new NotFoundException().message).toBe('Not Found')
    expect(new BadRequestException().message).toBe('Bad Request')
    expect(new TooManyRequestsException().message).toBe('Too Many Requests')
  })

  it('test_toJSON_format', () => {
    const ex = new ConflictException('Duplicate entry')
    const json = ex.toJSON()
    expect(json).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Duplicate entry',
        statusCode: 409,
      },
    })
  })

  it('test_toJSON_with_description', () => {
    const ex = new BadRequestException('Invalid input', { description: 'Check the title field' })
    const json = ex.toJSON()
    expect(json.error.description).toBe('Check the title field')
  })

  it('test_instanceof_chain', () => {
    const ex = new NotFoundException()
    expect(ex).toBeInstanceOf(NotFoundException)
    expect(ex).toBeInstanceOf(HttpException)
    expect(ex).toBeInstanceOf(Error)
  })

  it('test_cause_preservation', () => {
    const cause = new Error('DB connection failed')
    const ex = new InternalServerErrorException('Something went wrong', { cause })
    expect(ex.cause).toBe(cause)
  })

  it('test_custom_http_exception', () => {
    // Developer can use HttpException directly for non-standard codes
    const ex = new HttpException('Rate limited by upstream', 429)
    expect(ex.statusCode).toBe(429)
    expect(ex.code).toBe('TOO_MANY_REQUESTS')
  })
})
