import { HostError } from '../host-error.js'

/** Thrown by the instance config module. Messages name keys, variables and paths, never values. */
export class InstanceConfigError extends HostError {
  readonly variable?: string

  constructor(code: string, message: string, options?: { variable?: string; cause?: unknown }) {
    super(code, message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'InstanceConfigError'
    if (options?.variable !== undefined) this.variable = options.variable
  }
}
