import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  Controller,
  Get,
  Post,
  Delete,
  UseGuards,
  createDecorator,
  SetMetadata,
  Reflector,
} from '../../src/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import type { ExecutionContext, CanActivate } from '../../src/bridge/execution-context.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ─── RBAC setup (NestJS pattern) ────────────────────────────

enum Role {
  User = 'user',
  Admin = 'admin',
  Editor = 'editor',
}

const Roles = createDecorator<Role[]>()
const reflector = new Reflector()

/** NestJS-style RolesGuard — reads @Roles() metadata via Reflector + ExecutionContext. */
class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const roles = reflector.getAllAndOverride(Roles, context.getClass(), context.getMethodName())
    if (!roles) return true // no roles required → open access

    // Simulate user from request header (real app: JWT decode)
    const req = context.getRequest()
    const userRoles = req.headers.get('x-roles')?.split(',') ?? []
    return roles.some((role) => userRoles.includes(role))
  }
}

// ─── Claims/Permissions setup ───────────────────────────────

enum Permission {
  CREATE_POST = 'create:post',
  DELETE_POST = 'delete:post',
  READ_POST = 'read:post',
}

const RequirePermissions = createDecorator<Permission[]>()

class PermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const permissions = reflector.getAllAndOverride(
      RequirePermissions,
      context.getClass(),
      context.getMethodName(),
    )
    if (!permissions) return true

    const req = context.getRequest()
    const userPerms = req.headers.get('x-permissions')?.split(',') ?? []
    return permissions.every((perm) => userPerms.includes(perm))
  }
}

// ─── Policy-based authorization setup ───────────────────────

type PolicyHandler = (user: { roles: string[] }) => boolean

const CheckPolicies = createDecorator<PolicyHandler[]>()

class PoliciesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const policies = reflector.getAllAndOverride(
      CheckPolicies,
      context.getClass(),
      context.getMethodName(),
    )
    if (!policies) return true

    const req = context.getRequest()
    const userRoles = req.headers.get('x-roles')?.split(',') ?? []
    const user = { roles: userRoles }
    return policies.every((handler) => handler(user))
  }
}

// ─── Unit tests ─────────────────────────────────────────────

describe.skipIf(!isVitest)('Authorization — RBAC, Claims, Policies', () => {
  describe('Reflector.getAllAndOverride', () => {
    it('test_method_level_overrides_class_level', () => {
      @Roles([Role.User])
      @Controller('posts')
      class Ctrl {
        @Get()
        list() {}

        @Post()
        @Roles([Role.Admin])
        create() {}
      }

      // Method-level override
      expect(reflector.getAllAndOverride(Roles, Ctrl, 'create')).toEqual([Role.Admin])
      // Class-level fallback
      expect(reflector.getAllAndOverride(Roles, Ctrl, 'list')).toEqual([Role.User])
    })

    it('test_returns_undefined_when_no_metadata', () => {
      @Controller('plain')
      class Ctrl {
        @Get()
        handler() {}
      }
      expect(reflector.getAllAndOverride(Roles, Ctrl, 'handler')).toBeUndefined()
    })

    it('test_class_level_only', () => {
      @Roles([Role.Editor])
      @Controller('docs')
      class Ctrl {
        @Get()
        read() {}
      }
      expect(reflector.getAllAndOverride(Roles, Ctrl, 'read')).toEqual([Role.Editor])
    })
  })

  describe('Reflector.getAllAndMerge', () => {
    it('test_merges_method_and_class_metadata', () => {
      const Tags = createDecorator<string[]>()

      @Tags(['api', 'v2'])
      @Controller('items')
      class Ctrl {
        @Get()
        @Tags(['public', 'cached'])
        list() {}

        @Post()
        create() {}
      }

      // Method + class merged
      expect(reflector.getAllAndMerge(Tags, Ctrl, 'list')).toEqual([
        'public',
        'cached',
        'api',
        'v2',
      ])
      // Only class
      expect(reflector.getAllAndMerge(Tags, Ctrl, 'create')).toEqual(['api', 'v2'])
    })

    it('test_returns_empty_array_when_no_metadata', () => {
      @Controller('empty')
      class Ctrl {
        @Get()
        handler() {}
      }
      const Tags = createDecorator<string[]>()
      expect(reflector.getAllAndMerge(Tags, Ctrl, 'handler')).toEqual([])
    })
  })

  describe('Reflector.getAllAndOverrideByKey', () => {
    it('test_works_with_string_keys', () => {
      @Controller('meta')
      class Ctrl {
        @SetMetadata('isPublic', true)
        @Get()
        publicRoute() {}

        @Get('private')
        privateRoute() {}
      }

      expect(reflector.getAllAndOverrideByKey('isPublic', Ctrl, 'publicRoute')).toBe(true)
      expect(reflector.getAllAndOverrideByKey('isPublic', Ctrl, 'privateRoute')).toBeUndefined()
    })
  })

  describe('RBAC — RolesGuard HTTP roundtrip', () => {
    it('test_admin_route_rejects_without_role', async () => {
      @Controller('admin')
      @UseGuards(RolesGuard)
      class AdminCtrl {
        @Get()
        @Roles([Role.Admin])
        dashboard() {
          return { admin: true }
        }

        @Get('public')
        publicPage() {
          return { public: true }
        }
      }

      const server = createDecoratorServer([AdminCtrl])
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        // No roles → 403
        const r1 = await fetch(`http://localhost:${port}/admin`)
        expect(r1.status).toBe(403)

        // User role → 403 (needs Admin)
        const r2 = await fetch(`http://localhost:${port}/admin`, {
          headers: { 'x-roles': 'user' },
        })
        expect(r2.status).toBe(403)

        // Admin role → 200
        const r3 = await fetch(`http://localhost:${port}/admin`, {
          headers: { 'x-roles': 'admin' },
        })
        expect(r3.status).toBe(200)
        expect(await r3.json()).toEqual({ admin: true })

        // Public page (no @Roles) → 200 without any header
        const r4 = await fetch(`http://localhost:${port}/admin/public`)
        expect(r4.status).toBe(200)
        expect(await r4.json()).toEqual({ public: true })
      } finally {
        server.close()
      }
    })

    it('test_method_roles_override_class_roles', async () => {
      @Controller('posts')
      @UseGuards(RolesGuard)
      @Roles([Role.User])
      class PostsCtrl {
        @Get()
        list() {
          return [{ id: 1 }]
        }

        @Delete(':id')
        @Roles([Role.Admin]) // stricter: only admin can delete
        remove() {
          return { deleted: true }
        }
      }

      const server = createDecoratorServer([PostsCtrl])
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        // User can list
        const r1 = await fetch(`http://localhost:${port}/posts`, {
          headers: { 'x-roles': 'user' },
        })
        expect(r1.status).toBe(200)

        // User cannot delete
        const r2 = await fetch(`http://localhost:${port}/posts/1`, {
          method: 'DELETE',
          headers: { 'x-roles': 'user' },
        })
        expect(r2.status).toBe(403)

        // Admin can delete
        const r3 = await fetch(`http://localhost:${port}/posts/1`, {
          method: 'DELETE',
          headers: { 'x-roles': 'admin' },
        })
        expect(r3.status).toBe(200)
      } finally {
        server.close()
      }
    })
  })

  describe('Claims-based — PermissionsGuard HTTP roundtrip', () => {
    it('test_requires_all_permissions', async () => {
      @Controller('articles')
      @UseGuards(PermissionsGuard)
      class ArticlesCtrl {
        @Get()
        @RequirePermissions([Permission.READ_POST])
        list() {
          return [{ title: 'Hello' }]
        }

        @Post()
        @RequirePermissions([Permission.CREATE_POST])
        create() {
          return { created: true }
        }

        @Delete(':id')
        @RequirePermissions([Permission.DELETE_POST])
        remove() {
          return { deleted: true }
        }
      }

      const server = createDecoratorServer([ArticlesCtrl])
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        // read:post → can list
        const r1 = await fetch(`http://localhost:${port}/articles`, {
          headers: { 'x-permissions': 'read:post' },
        })
        expect(r1.status).toBe(200)

        // read:post → cannot create
        const r2 = await fetch(`http://localhost:${port}/articles`, {
          method: 'POST',
          headers: {
            'x-permissions': 'read:post',
            'content-type': 'application/json',
          },
          body: '{}',
        })
        expect(r2.status).toBe(403)

        // create:post → can create
        const r3 = await fetch(`http://localhost:${port}/articles`, {
          method: 'POST',
          headers: {
            'x-permissions': 'create:post',
            'content-type': 'application/json',
          },
          body: '{}',
        })
        expect(r3.status).toBe(201)
      } finally {
        server.close()
      }
    })
  })

  describe('Policy-based — PoliciesGuard HTTP roundtrip', () => {
    it('test_inline_policy_function', async () => {
      @Controller('settings')
      @UseGuards(PoliciesGuard)
      class SettingsCtrl {
        @Get()
        @CheckPolicies([(user) => user.roles.includes('admin')])
        adminSettings() {
          return { settings: true }
        }
      }

      const server = createDecoratorServer([SettingsCtrl])
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        // No admin role → 403
        const r1 = await fetch(`http://localhost:${port}/settings`, {
          headers: { 'x-roles': 'user' },
        })
        expect(r1.status).toBe(403)

        // Admin role → 200
        const r2 = await fetch(`http://localhost:${port}/settings`, {
          headers: { 'x-roles': 'admin' },
        })
        expect(r2.status).toBe(200)
      } finally {
        server.close()
      }
    })
  })

  describe('ExecutionContext — guard access to handler metadata', () => {
    it('test_guard_sees_correct_class_and_method', async () => {
      let capturedClass: Function | undefined
      let capturedMethod: string | symbol | undefined

      class MetaCapture implements CanActivate {
        canActivate(ctx: ExecutionContext) {
          capturedClass = ctx.getClass()
          capturedMethod = ctx.getMethodName()
          return true
        }
      }

      @Controller('inspect')
      class InspectCtrl {
        @Get('info')
        @UseGuards(MetaCapture)
        info() {
          return { ok: true }
        }
      }

      const server = createDecoratorServer([InspectCtrl])
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        const r = await fetch(`http://localhost:${port}/inspect/info`)
        expect(r.status).toBe(200)
        expect(capturedClass).toBe(InspectCtrl)
        expect(capturedMethod).toBe('info')
      } finally {
        server.close()
      }
    })
  })

  describe('Guard rejection produces NestJS-compatible 403 JSON', () => {
    it('test_guard_403_response_format', async () => {
      class RejectGuard implements CanActivate {
        canActivate() {
          return false
        }
      }

      @Controller('locked')
      class LockedCtrl {
        @Get()
        @UseGuards(RejectGuard)
        secret() {
          return { never: true }
        }
      }

      const server = createDecoratorServer([LockedCtrl])
      await new Promise<void>((r) => server.listen(0, r))
      const port = (server.address() as { port: number }).port

      try {
        const res = await fetch(`http://localhost:${port}/locked`)
        expect(res.status).toBe(403)
        const body = (await res.json()) as {
          error: { code: string; message: string; statusCode: number }
        }
        expect(body.error.code).toBe('FORBIDDEN')
        expect(body.error.message).toBe('Forbidden resource')
        expect(body.error.statusCode).toBe(403)
      } finally {
        server.close()
      }
    })
  })
})
