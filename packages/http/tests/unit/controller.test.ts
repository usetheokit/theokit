import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Controller } from '../../src/decorators/controller.js'
import { getMeta, CONTROLLER_PREFIX } from '../../src/metadata/index.js'
import type { ControllerMeta } from '../../src/decorators/controller.js'

describe('T1.4 — @Controller decorator', () => {
  it('test_controller_no_args — infers prefix from class name (convention naming)', () => {
    @Controller()
    class UsersController {
      name = 'UsersController'
    }
    const meta = getMeta<ControllerMeta>(CONTROLLER_PREFIX, UsersController)
    expect(meta).toEqual({ prefix: 'api/users', host: undefined })
  })

  it('test_controller_with_prefix', () => {
    @Controller('cats')
    class CatsCtrl {
      name = 'CatsCtrl'
    }
    const meta = getMeta<ControllerMeta>(CONTROLLER_PREFIX, CatsCtrl)
    expect(meta?.prefix).toBe('cats')
  })

  it('test_controller_with_host', () => {
    @Controller('admin', { host: ':account.example.com' })
    class AdminCtrl {
      name = 'AdminCtrl'
    }
    const meta = getMeta<ControllerMeta>(CONTROLLER_PREFIX, AdminCtrl)
    expect(meta?.prefix).toBe('admin')
    expect(meta?.host).toBe(':account.example.com')
  })

  it('test_controller_inheritance_last_wins', () => {
    @Controller('parent')
    class ParentCtrl {
      name = 'ParentCtrl'
    }

    @Controller('child')
    class ChildCtrl extends ParentCtrl {
      override name = 'ChildCtrl'
    }

    const parentMeta = getMeta<ControllerMeta>(CONTROLLER_PREFIX, ParentCtrl)
    const childMeta = getMeta<ControllerMeta>(CONTROLLER_PREFIX, ChildCtrl)
    expect(parentMeta?.prefix).toBe('parent')
    expect(childMeta?.prefix).toBe('child')
  })
})
