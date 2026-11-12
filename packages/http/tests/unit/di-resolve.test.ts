/* eslint-disable @typescript-eslint/no-extraneous-class -- fixture classes */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Container, Injectable } from '@theokit/di'
import { resolveOrNew, type DiContainer } from '../../src/bridge/di-resolve.js'

const deps = (C: Function, ...d: Function[]): void => {
  Injectable()(C as never)
  Reflect.defineMetadata('design:paramtypes', d, C)
}

describe('resolveOrNew', () => {
  it('propagates a missing dependency of a registered class', () => {
    class Db {}
    class Repo {
      constructor(public db: Db) {}
    }
    deps(Db)
    deps(Repo, Db)
    const c = new Container()
    c.register(Repo)
    expect(() => resolveOrNew(Repo, c as unknown as DiContainer)).toThrowError(
      expect.objectContaining({ name: 'TokenNotFoundError' }),
    )
  })

  it('propagates a constructor error, constructing once', () => {
    let calls = 0
    class Boom {
      constructor() {
        calls++
        throw new Error('boom')
      }
    }
    deps(Boom)
    const c = new Container()
    c.register(Boom)
    expect(() => resolveOrNew(Boom, c as unknown as DiContainer)).toThrow('boom')
    expect(calls).toBe(1)
  })

  it('builds an unregistered class with new', () => {
    class Plain {}
    const c = new Container()
    expect(resolveOrNew(Plain, c as unknown as DiContainer)).toBeInstanceOf(Plain)
  })

  it('builds with new when there is no container', () => {
    class Plain {}
    expect(resolveOrNew(Plain)).toBeInstanceOf(Plain)
  })

  it('without has(): falls back only for an error naming Ctor, rethrows others', () => {
    class A {}
    const err = (name: string, message: string) => () => {
      throw Object.assign(new Error(message), { name })
    }
    expect(
      resolveOrNew(A, { resolve: err('TokenNotFoundError', 'No provider for A') }),
    ).toBeInstanceOf(A)
    expect(() =>
      resolveOrNew(A, { resolve: err('TokenNotFoundError', 'No provider for Db') }),
    ).toThrow()
    expect(() => resolveOrNew(A, { resolve: err('Error', 'A failed') })).toThrow('A failed')
  })
})
