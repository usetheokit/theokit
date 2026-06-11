import { setMeta, CONTROLLER_PREFIX } from '../metadata/index.js'

export interface ControllerOptions {
  host?: string
}

export interface ControllerMeta {
  prefix: string
  host?: string
}

/**
 * Infer route prefix from class name (Rails-style convention naming).
 *
 * UsersController → api/users
 * TasksController → api/tasks
 * AuthController  → api/auth
 * HealthCheckController → api/health-check
 *
 * Strips "Controller" suffix, converts PascalCase to kebab-case,
 * prepends "api/".
 */
function inferPrefix(className: string): string {
  const stripped = className.replace(/Controller$/, '')
  const kebab = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
  return `api/${kebab}`
}

/**
 * Class decorator that declares a route-prefix scope.
 *
 * Convention over configuration:
 *   @Controller()              → prefix inferred from class name
 *   @Controller('api/users')   → explicit prefix
 *
 * @example
 * ```ts
 * // Convention: UsersController → /api/users (zero config)
 * @Controller()
 * class UsersController { ... }
 *
 * // Explicit: override when convention doesn't fit
 * @Controller('api/v2/users')
 * class UsersController { ... }
 * ```
 */
export function Controller(prefix?: string, opts?: ControllerOptions): ClassDecorator
export function Controller(opts?: ControllerOptions): ClassDecorator
export function Controller(
  prefixOrOpts?: string | ControllerOptions,
  maybeOpts?: ControllerOptions,
): ClassDecorator {
  return (target) => {
    let prefix: string
    let opts: ControllerOptions

    if (typeof prefixOrOpts === 'string') {
      prefix = prefixOrOpts
      opts = maybeOpts ?? {}
    } else {
      // Convention naming: infer from class name
      prefix = inferPrefix(target.name)
      opts = prefixOrOpts ?? {}
    }

    setMeta<ControllerMeta>(CONTROLLER_PREFIX, target, {
      prefix,
      host: opts.host,
    })
  }
}
