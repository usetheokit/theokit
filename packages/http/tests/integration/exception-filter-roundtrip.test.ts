import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import type http from 'node:http'
import { Controller, Get, UseFilters, Catch } from '../../src/index.js'
import {
  NotFoundException,
  BadRequestException,
  HttpException,
} from '../../src/exceptions/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import type { ExceptionFilter, ArgumentsHost } from '../../src/bridge/exception-filter-chain.js'
import { z } from 'zod'
import { Body, Post } from '../../src/decorators/index.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ─── Custom filter ───

@Catch(HttpException)
class CustomErrorFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost) {
    const ex = exception as HttpException
    return new Response(JSON.stringify({ custom: true, code: ex.code, msg: ex.message }), {
      status: ex.statusCode,
      headers: { 'content-type': 'application/json' },
    })
  }
}

// ─── Controller ───

const schema = z.object({ name: z.string().min(1) })

@Controller('items')
class ItemsCtrl {
  @Get(':id')
  findOne() {
    throw new NotFoundException('Item not found')
  }

  @Get('bad')
  bad() {
    throw new BadRequestException('Invalid request')
  }

  @Get('crash')
  crash() {
    throw new Error('unexpected boom')
  }

  @Get('custom')
  @UseFilters(CustomErrorFilter)
  custom() {
    throw new NotFoundException('Custom handled')
  }

  @Post()
  create(@Body(schema) body: z.infer<typeof schema>) {
    return body
  }
}

describe.skipIf(!isVitest)('T3.1 — Exception filter HTTP roundtrip', () => {
  let server: http.Server
  let port: number

  async function start() {
    server = createDecoratorServer([ItemsCtrl])
    await new Promise<void>((r) => server.listen(0, r))
    port = (server.address() as { port: number }).port
  }

  async function fetchJSON(path: string, opts?: RequestInit) {
    const res = await fetch(`http://localhost:${port}${path}`, opts)
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  }

  it('test_not_found_exception_returns_404', async () => {
    await start()
    try {
      const { status, body } = await fetchJSON('/items/999')
      expect(status).toBe(404)
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toBe('Item not found')
    } finally {
      server.close()
    }
  })

  it('test_bad_request_returns_400', async () => {
    await start()
    try {
      const { status, body } = await fetchJSON('/items/bad')
      expect(status).toBe(400)
      expect(body.error.code).toBe('BAD_REQUEST')
    } finally {
      server.close()
    }
  })

  it('test_custom_filter_formats_error', async () => {
    await start()
    try {
      const { status, body } = await fetchJSON('/items/custom')
      expect(status).toBe(404)
      expect(body.custom).toBe(true)
      expect(body.code).toBe('NOT_FOUND')
    } finally {
      server.close()
    }
  })

  it('test_unhandled_exception_returns_500', async () => {
    await start()
    try {
      const { status, body } = await fetchJSON('/items/crash')
      expect(status).toBe(500)
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
    } finally {
      server.close()
    }
  })

  it('test_existing_validation_422_unchanged', async () => {
    await start()
    try {
      const { status, body } = await fetchJSON('/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(status).toBe(422)
      expect(body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      server.close()
    }
  })
})
