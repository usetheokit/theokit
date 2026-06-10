/**
 * RolesGuard — RBAC authorization for controllers AND agents.
 *
 * Same guard, same pipeline, same behavior on both HTTP and AI routes.
 * Uses @Roles([Role.Admin]) on class/method and @IsPublic(true) to skip.
 */
import {
  createDecorator, Reflector,
  type CanActivate, type ExecutionContext,
} from '@theokit/http-decorators'

export enum Role {
  User = 'user',
  Admin = 'admin',
}

/** Declare required roles for a route or agent. */
export const Roles = createDecorator<Role[]>()

/** Mark a route as public — skips auth entirely. */
export const IsPublic = createDecorator<boolean>()

const reflector = new Reflector()

export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Public routes skip auth
    const isPublic = reflector.getAllAndOverride(
      IsPublic,
      context.getClass(),
      context.getMethodName(),
    )
    if (isPublic) return true

    // Check required roles
    const roles = reflector.getAllAndOverride(
      Roles,
      context.getClass(),
      context.getMethodName(),
    )
    if (!roles) return true // no roles required

    // Read role from request header (replace with JWT/session in production)
    const userRole = context.getRequest().headers.get('x-role') ?? ''
    return roles.some((r) => r === userRole)
  }
}
