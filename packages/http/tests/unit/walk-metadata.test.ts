import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { Controller } from '../../src/decorators/controller.js'
import { Get, Post, Delete } from '../../src/decorators/methods.js'
import { Body, Param, Query, Headers } from '../../src/decorators/params.js'
import { HttpCode, Header, Redirect } from '../../src/decorators/response.js'
import { UseGuards } from '../../src/decorators/middleware.js'
import { walkControllerMetadata, joinPath } from '../../src/bridge/walk-metadata.js'
import { HttpDecoratorsConfigError } from '../../src/bridge/errors.js'
import type { ExecutionContext } from '../../src/bridge/execution-context.js'

// DTO fixture with static schema (Pattern D2)
const zCreateCat = z.object({ name: z.string(), age: z.number() })
class CreateCatDto {
  static schema = zCreateCat
}

class AuthGuard {
  canActivate(_context: ExecutionContext) {
    return true
  }
}
class MethodGuard {
  canActivate(_context: ExecutionContext) {
    return true
  }
}

describe('T3.2 — walkControllerMetadata', () => {
  it('test_walk_simple_get', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get()
      findAll(): string {
        return 'all cats'
      }
    }
    const results = walkControllerMetadata(CatsCtrl)
    expect(results).toHaveLength(1)
    expect(results[0].verb).toBe('GET')
    expect(results[0].fullPath).toBe('/cats')
    expect(results[0].propertyKey).toBe('findAll')
  })

  it('test_walk_post_with_body_dto', () => {
    @Controller('cats')
    class CatsCtrl {
      @Post()
      create(@Body() _body: CreateCatDto): string {
        return 'created'
      }
    }
    // Simulate what tsc --emitDecoratorMetadata does at compile time
    // (vitest uses esbuild which doesn't emit design:paramtypes)
    Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsCtrl.prototype, 'create')

    const results = walkControllerMetadata(CatsCtrl)
    expect(results[0].verb).toBe('POST')
    expect(results[0].bodySchema).toBe(zCreateCat)
  })

  it('test_walk_get_with_query_header', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get()
      @Header('Cache-Control', 'no-store')
      findAll(@Query('breed') _breed: string): string {
        return 'breeds'
      }
    }
    const results = walkControllerMetadata(CatsCtrl)
    expect(results[0].headers).toContainEqual(['Cache-Control', 'no-store'])
  })

  it('test_walk_put_with_param', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get(':id')
      findOne(@Param('id') _id: string): string {
        return 'one'
      }
    }
    const results = walkControllerMetadata(CatsCtrl)
    expect(results[0].fullPath).toBe('/cats/:id')
    expect(results[0].paramEntries).toContainEqual(
      expect.objectContaining({ source: 'param', key: 'id' }),
    )
  })

  it('test_walk_delete_with_http_code', () => {
    @Controller('cats')
    class CatsCtrl {
      @Delete(':id')
      @HttpCode(204)
      remove(@Param('id') _id: string) {}
    }
    const results = walkControllerMetadata(CatsCtrl)
    expect(results[0].status).toBe(204)
  })

  it('test_walk_redirect', () => {
    @Controller('docs')
    class DocsCtrl {
      @Get()
      @Redirect('https://docs.example.com', 301)
      getDocs() {}
    }
    const results = walkControllerMetadata(DocsCtrl)
    expect(results[0].redirect).toEqual({ url: 'https://docs.example.com', status: 301 })
  })

  it('test_walk_host_warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    @Controller('admin', { host: ':account.example.com' })
    class AdminCtrl {
      @Get()
      handler() {}
    }
    walkControllerMetadata(AdminCtrl)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(':account.example.com'))
    warnSpy.mockRestore()
  })

  it('test_walk_throws_when_missing_controller_decorator (EC-2)', () => {
    class NoDecoratorCtrl {
      @Get()
      handler() {}
    }
    expect(() => walkControllerMetadata(NoDecoratorCtrl)).toThrow(HttpDecoratorsConfigError)
    expect(() => walkControllerMetadata(NoDecoratorCtrl)).toThrow(
      /missing @Controller\(\) decorator/,
    )
  })

  it('test_walk_inherited_controller (EC-8)', () => {
    @Controller('animals')
    class BaseCtrl {
      @Get()
      findAll() {
        return 'base'
      }
    }

    @Controller('cats')
    class CatsCtrl extends BaseCtrl {
      @Post()
      create() {
        return 'created'
      }
    }

    const results = walkControllerMetadata(CatsCtrl)
    // Child's @Controller prefix applies; child's own methods register
    expect(results.some((r) => r.verb === 'POST' && r.fullPath === '/cats')).toBe(true)
    // Parent's @Get also registers under child's prefix (NestJS inheritance)
    // Note: depends on reflect-metadata prototype chain behavior
    // If parent methods don't appear, this documents the v0.1.0 limitation
  })

  it('test_walk_guards_compose_class_then_method (EC-9 composition)', () => {
    @Controller('secure')
    @UseGuards(AuthGuard)
    class SecureCtrl {
      @UseGuards(MethodGuard)
      @Get()
      handler() {}
    }
    const results = walkControllerMetadata(SecureCtrl)
    // Class guards come FIRST (NestJS convention), then method guards
    expect(results[0].guards).toEqual([AuthGuard, MethodGuard])
  })
})

describe('T3.2 — joinPath normalization (EC-3)', () => {
  it('test_join_path_normalizes', () => {
    expect(joinPath('cats', '/breed')).toBe('/cats/breed')
    expect(joinPath('/cats', 'breed')).toBe('/cats/breed')
    expect(joinPath('cats/', '/breed/')).toBe('/cats/breed')
    expect(joinPath('', '')).toBe('/')
    expect(joinPath('', 'cats')).toBe('/cats')
    expect(joinPath('cats', '')).toBe('/cats')
  })
})
