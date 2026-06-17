import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Get, Post, Put, Patch, Delete, Options, Head, All } from '../../src/decorators/methods.js'
import { getMeta, ROUTE_METHODS } from '../../src/metadata/index.js'
import type { RouteMethodEntry } from '../../src/decorators/methods.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

describe.skipIf(!isVitest)('T1.5 — HTTP-verb method decorators', () => {
  it('test_each_verb_stores_entry', () => {
    const verbs = [
      ['GET', Get],
      ['POST', Post],
      ['PUT', Put],
      ['PATCH', Patch],
      ['DELETE', Delete],
      ['OPTIONS', Options],
      ['HEAD', Head],
      ['ALL', All],
    ] as const

    for (const [expected, decorator] of verbs) {
      class TestCtrl {
        @((decorator as typeof Get)())
        handler() {
          return 'ok'
        }
      }
      const entries = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, TestCtrl)
      expect(entries).toHaveLength(1)
      expect(entries![0].verb).toBe(expected)
    }
  })

  it('test_multiple_methods_accumulate', () => {
    class CatsCtrl {
      @Get()
      findAll() {
        return 'all'
      }

      @Post()
      create() {
        return 'created'
      }
    }
    const entries = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, CatsCtrl)
    expect(entries).toHaveLength(2)
    expect(entries!.map((e) => e.verb)).toEqual(['GET', 'POST'])
  })

  it('test_get_with_subpath', () => {
    class CatsCtrl {
      @Get('breed')
      findBreeds() {
        return 'breeds'
      }
    }
    const entries = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, CatsCtrl)
    expect(entries![0].path).toBe('breed')
    expect(entries![0].propertyKey).toBe('findBreeds')
  })

  it('test_method_with_multiple_verb_decorators (EC-6)', () => {
    class CatsCtrl {
      @Get()
      @Post()
      handler() {
        return 'dual'
      }
    }
    const entries = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, CatsCtrl)
    // Both verbs should register — mirrors NestJS dual-route behavior
    expect(entries).toHaveLength(2)
    const verbs = entries!.map((e) => e.verb).sort((a, b) => a.localeCompare(b))
    expect(verbs).toEqual(['GET', 'POST'])
  })
})
