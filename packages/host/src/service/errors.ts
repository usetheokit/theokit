import { HostError } from '../host-error.js'

/** No service backend exists for this platform (or restart is not supported on it). */
export class UnsupportedPlatformError extends HostError {
  readonly platform: string

  constructor(platform: string, message?: string) {
    super(
      'host_service_unsupported_platform',
      message ?? `service management is not supported on platform "${platform}"`,
    )
    this.name = 'UnsupportedPlatformError'
    this.platform = platform
  }
}

/** A service-manager command exited non-zero. */
export class ServiceCommandError extends HostError {
  readonly command: string
  readonly exitCode: number

  constructor(command: string, exitCode: number, detail: string, options?: { cause?: unknown }) {
    const suffix = detail === '' ? '' : ': ' + detail
    super(
      'host_service_command_failed',
      `${command} failed with exit code ${exitCode}${suffix}`,
      options,
    )
    this.name = 'ServiceCommandError'
    this.command = command
    this.exitCode = exitCode
  }
}

/** A value the unit format cannot hold. The message names the field, never the value. */
export class ServiceDefinitionError extends HostError {
  readonly field: string

  constructor(field: string, reason: string) {
    super('host_service_definition_invalid', `service ${field} ${reason}`)
    this.name = 'ServiceDefinitionError'
    this.field = field
  }
}

/** The successor process could not be started. `cause` is the spawn error. */
export class RestartError extends HostError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('host_service_restart_failed', message, options)
    this.name = 'RestartError'
  }
}
