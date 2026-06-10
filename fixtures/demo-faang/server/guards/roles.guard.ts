import { createDecorator, Reflector } from '../../../../packages/http-decorators/src/decorators/set-metadata.js'
import type { CanActivate, ExecutionContext } from '../../../../packages/http-decorators/src/bridge/execution-context.js'

export enum Role { User = 'user', Admin = 'admin' }

export const Roles = createDecorator<Role[]>()
export const IsPublic = createDecorator<boolean>()

const reflector = new Reflector()

/**
 * RolesGuard — works on BOTH @Controller AND @Agent.
 * Same guard, same pipeline, same RBAC.
 */
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const isPublic = reflector.getAllAndOverride(IsPublic, context.getClass(), context.getMethodName())
    if (isPublic) return true

    const roles = reflector.getAllAndOverride(Roles, context.getClass(), context.getMethodName())
    if (!roles) return true

    const role = context.getRequest().headers.get('x-role') ?? ''
    return roles.some((r) => r === role)
  }
}
