import { setMeta, CONTROLLER_PREFIX } from '../metadata/index.js'

export interface ControllerOptions {
  host?: string
}

export interface ControllerMeta {
  prefix: string
  host?: string
}

/**
 * Class decorator that declares a route-prefix scope.
 * Equivalent to NestJS's @Controller('prefix').
 */
export function Controller(prefix = '', opts: ControllerOptions = {}): ClassDecorator {
  return (target) => {
    setMeta<ControllerMeta>(CONTROLLER_PREFIX, target, {
      prefix,
      host: opts.host,
    })
  }
}
