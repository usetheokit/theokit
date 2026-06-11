import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { Controller } from '../../src/decorators/controller.js'
import { Get, Post, Put, Delete } from '../../src/decorators/methods.js'
import { Body, Param } from '../../src/decorators/params.js'
import { HttpCode } from '../../src/decorators/response.js'
import { registerControllers } from '../../src/bridge/register-controllers.js'

const zCreateCat = z.object({ name: z.string() })
class CreateCatDto {
  static schema = zCreateCat
}

describe('T3.3 — registerControllers', () => {
  it('test_register_single_method', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get()
      findAll() {
        return 'all'
      }
    }
    const regs = registerControllers([CatsCtrl])
    expect(regs).toHaveLength(1)
    expect(regs[0].verb).toBe('GET')
    expect(regs[0].fullPath).toBe('/cats')
  })

  it('test_register_multi_method', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get()
      findAll() {}
      @Post()
      create() {}
      @Put(':id')
      update() {}
      @Delete(':id')
      remove() {}
    }
    const regs = registerControllers([CatsCtrl])
    expect(regs).toHaveLength(4)
    expect(regs.map((r) => r.verb).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT'])
  })

  it('test_register_body_dto', () => {
    @Controller('cats')
    class CatsCtrl {
      @Post()
      create(@Body() _body: CreateCatDto) {
        return 'created'
      }
    }
    // Simulate tsc --emitDecoratorMetadata (vitest uses esbuild)
    Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsCtrl.prototype, 'create')

    const regs = registerControllers([CatsCtrl])
    expect(regs[0].walkResult.bodySchema).toBe(zCreateCat)
  })

  it('test_register_http_code_override', () => {
    @Controller('cats')
    class CatsCtrl {
      @Delete(':id')
      @HttpCode(204)
      remove(@Param('id') _id: string) {}
    }
    const regs = registerControllers([CatsCtrl])
    expect(regs[0].walkResult.status).toBe(204)
  })

  it('test_register_multiple_controllers', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get()
      findAll() {}
    }
    @Controller('dogs')
    class DogsCtrl {
      @Get()
      findAll() {}
    }
    const regs = registerControllers([CatsCtrl, DogsCtrl])
    expect(regs).toHaveLength(2)
    expect(regs.map((r) => r.fullPath).sort()).toEqual(['/cats', '/dogs'])
  })

  it('test_register_duplicate_controllers_dedupes_with_warn (EC-5)', () => {
    @Controller('cats')
    class CatsCtrl {
      @Get()
      findAll() {}
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const regs = registerControllers([CatsCtrl, CatsCtrl])
    expect(regs).toHaveLength(1) // deduped
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('registered multiple times'))
    warnSpy.mockRestore()
  })
})
