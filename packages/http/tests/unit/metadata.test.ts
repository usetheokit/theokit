import { describe, it, expect } from 'vitest'
import { setMeta, getMeta } from '../../src/metadata/storage.js'
import {
  CONTROLLER_PREFIX,
  ROUTE_METHODS,
  ROUTE_PARAMS,
  ROUTE_STATUS,
  ROUTE_HEADERS,
  ROUTE_REDIRECT,
  USE_GUARDS,
  USE_INTERCEPTORS,
} from '../../src/metadata/keys.js'

describe('T1.2 — Metadata storage', () => {
  it('test_set_get_roundtrip', () => {
    const key = Symbol('test-roundtrip')
    class Target {
      name = 'Target'
    }
    setMeta(key, Target, 'hello')
    expect(getMeta<string>(key, Target)).toBe('hello')
  })

  it('test_missing_key_returns_undefined', () => {
    const key = Symbol('test-missing')
    class Target {
      name = 'Target'
    }
    expect(getMeta(key, Target)).toBeUndefined()
  })

  it('test_property_key_isolation', () => {
    const key = Symbol('test-isolation')
    class Target {
      name = 'Target'
    }
    setMeta(key, Target, 'class-level')
    setMeta(key, Target, 'method-level', 'myMethod')
    expect(getMeta<string>(key, Target)).toBe('class-level')
    expect(getMeta<string>(key, Target, 'myMethod')).toBe('method-level')
  })

  it('test_consumer_inherits_reflect_metadata_via_package_import (EC-11)', () => {
    // Verify that importing from our metadata module automatically loads
    // reflect-metadata polyfill — consumer doesn't need explicit import
    expect(typeof Reflect.defineMetadata).toBe('function')
    expect(typeof Reflect.getMetadata).toBe('function')
  })

  it('exports 8 symbol constants from keys.ts', () => {
    const keys = [
      CONTROLLER_PREFIX,
      ROUTE_METHODS,
      ROUTE_PARAMS,
      ROUTE_STATUS,
      ROUTE_HEADERS,
      ROUTE_REDIRECT,
      USE_GUARDS,
      USE_INTERCEPTORS,
    ]
    expect(keys).toHaveLength(8)
    keys.forEach((k) => expect(typeof k).toBe('symbol'))
    // All unique
    expect(new Set(keys).size).toBe(8)
  })
})
