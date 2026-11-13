import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Container, Injectable } from '@theokit/di'
import { resolveOrNew, type DiContainer } from '../../src/bridge/di-resolve.js'

/** Real container; @theokit/di's Token<T> is wider than DiContainer's Function. */
const asDi = (c: Container): DiContainer => c as unknown as DiContainer

const deps = (C: Function, ...d: Function[]): void => {
  Injectable()(C as never)
  Reflect.defineMetadata('design:paramtypes', d, C)
}

describe('resolveOrNew', () => {
  it('propagates a missing dependency of a registered class', () => {
    class Db {
      readonly x = 1
    }
    class Repo {
      constructor(public db?: Db) {}
    }
    deps(Db)
    deps(Repo, Db)
    const c = new Container()
    c.register(Repo)
    expect(() => resolveOrNew(Repo, asDi(c))).toThrow(
      expect.objectContaining({ name: 'TokenNotFoundError' }),
    )
  })

  it('propagates a constructor error, running the constructor once', () => {
    let runs = 0
    class Boom {
      readonly x = 1
      constructor() {
        runs++
        throw new Error('boom')
      }
    }
    deps(Boom)
    const c = new Container()
    c.register(Boom)
    expect(() => resolveOrNew(Boom, asDi(c))).toThrow('boom')
    expect(runs).toBe(1)
  })

  it('builds an unregistered class with new', () => {
    class Plain {
      readonly x = 1
    }
    expect(resolveOrNew(Plain, asDi(new Container()))).toBeInstanceOf(Plain)
  })

  it('builds with new when there is no container', () => {
    class Plain {
      readonly x = 1
    }
    expect(resolveOrNew(Plain)).toBeInstanceOf(Plain)
  })

  it('without has(): falls back only for a missing registration of Ctor itself', () => {
    class A {
      readonly x = 1
    }
    const missing = {
      resolve: () => {
        throw Object.assign(new Error('No provider for A'), { name: 'TokenNotFoundError' })
      },
    }
    expect(resolveOrNew(A, missing)).toBeInstanceOf(A)
    const other = {
      resolve: () => {
        throw Object.assign(new Error('No provider for Db'), { name: 'TokenNotFoundError' })
      },
    }
    expect(() => resolveOrNew(A, other)).toThrow('Db')
  })
})
