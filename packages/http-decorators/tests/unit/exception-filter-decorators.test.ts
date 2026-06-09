import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Catch, UseFilters } from '../../src/decorators/middleware.js'
import { getMeta, USE_FILTERS, CATCH_EXCEPTIONS } from '../../src/metadata/index.js'
import { Get } from '../../src/decorators/methods.js'
import { Controller } from '../../src/decorators/controller.js'
import { walkControllerMetadata } from '../../src/bridge/walk-metadata.js'
import { HttpException, NotFoundException } from '../../src/exceptions/index.js'

class MyFilter {
  catch() {}
}

describe('T2.1 — @Catch + @UseFilters decorators', () => {
  it('test_catch_stores_exception_types', () => {
    @Catch(HttpException)
    class F {
      catch() {}
    }
    expect(getMeta<Function[]>(CATCH_EXCEPTIONS, F)).toEqual([HttpException])
  })

  it('test_catch_no_args_catches_all', () => {
    @Catch()
    class F {
      catch() {}
    }
    expect(getMeta<Function[]>(CATCH_EXCEPTIONS, F)).toEqual([])
  })

  it('test_use_filters_method_level', () => {
    class Ctrl {
      @UseFilters(MyFilter)
      @Get()
      handler() {}
    }
    expect(getMeta<Function[]>(USE_FILTERS, Ctrl, 'handler')).toEqual([MyFilter])
  })

  it('test_use_filters_class_level', () => {
    @UseFilters(MyFilter)
    class Ctrl {}
    expect(getMeta<Function[]>(USE_FILTERS, Ctrl)).toEqual([MyFilter])
  })

  it('test_walk_metadata_collects_filters', () => {
    @UseFilters(MyFilter)
    @Controller('test')
    class Ctrl {
      @Get()
      handler() {
        return 'ok'
      }
    }
    const walks = walkControllerMetadata(Ctrl)
    expect(walks[0].filters).toEqual([MyFilter])
  })
})
