import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { createDecorator, SetMetadata, Reflector } from '../../src/decorators/set-metadata.js'
import { Controller, Get, UseGuards } from '../../src/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import type { ExecutionContext } from '../../src/bridge/execution-context.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ─── Role-based auth example (NestJS Reflector pattern) ───

const Roles = createDecorator<string[]>()
const reflector = new Reflector()

class RolesGuard {
  canActivate(context: ExecutionContext) {
    const req = context.getRequest()
    // In real app: extract user from JWT, check roles via reflector
    // For test: check x-role header
    const userRole = req.headers.get('x-role')
    if (!userRole) return false
    // Guard needs to know which roles are required — in NestJS this
    // uses ExecutionContext.getHandler() + Reflector. Here simplified:
    // the guard checks if user has ANY role (non-empty header = allowed)
    return userRole.length > 0
  }
}

describe.skipIf(!isVitest)('@SetMetadata + createDecorator + Reflector', () => {
  it('test_create_decorator_sets_metadata_on_method', () => {
    class Ctrl {
      @Roles(['admin', 'editor'])
      @Get()
      create() {}
    }
    const roles = reflector.get(Roles, Ctrl, 'create')
    expect(roles).toEqual(['admin', 'editor'])
  })

  it('test_create_decorator_sets_metadata_on_class', () => {
    @Roles(['superadmin'])
    class Ctrl {
      name = 'Ctrl'
    }
    const roles = reflector.get(Roles, Ctrl)
    expect(roles).toEqual(['superadmin'])
  })

  it('test_set_metadata_with_string_key', () => {
    class Ctrl {
      @SetMetadata('isPublic', true)
      @Get()
      health() {}
    }
    const isPublic = reflector.getByKey<boolean>('isPublic', Ctrl, 'health')
    expect(isPublic).toBe(true)
  })

  it('test_reflector_returns_undefined_when_no_metadata', () => {
    class Ctrl {
      @Get()
      noMeta() {}
    }
    expect(reflector.get(Roles, Ctrl, 'noMeta')).toBeUndefined()
  })

  it('test_multiple_decorators_independent', () => {
    const Permissions = createDecorator<string[]>()

    class Ctrl {
      @Roles(['admin'])
      @Permissions(['read', 'write'])
      @Get()
      handler() {}
    }

    expect(reflector.get(Roles, Ctrl, 'handler')).toEqual(['admin'])
    expect(reflector.get(Permissions, Ctrl, 'handler')).toEqual(['read', 'write'])
  })

  it('test_roles_guard_http_roundtrip', async () => {
    @Controller('admin')
    class AdminCtrl {
      @Get()
      @UseGuards(RolesGuard)
      dashboard() {
        return { admin: true }
      }
    }

    const server = createDecoratorServer([AdminCtrl])
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    try {
      // No role header → 403
      const r1 = await fetch(`http://localhost:${port}/admin`)
      expect(r1.status).toBe(403)

      // With role header → 200
      const r2 = await fetch(`http://localhost:${port}/admin`, {
        headers: { 'x-role': 'admin' },
      })
      expect(r2.status).toBe(200)
      const body = (await r2.json()) as { admin: boolean }
      expect(body.admin).toBe(true)
    } finally {
      server.close()
    }
  })
})
