import { HostError } from '../host-error.js'

export interface AppHostStepFailure {
  readonly step: string
  readonly error: unknown
}

/** `start()` failed: `step` is the service whose start threw, `cause` its error. Started services were stopped again. */
export class AppHostStartError extends HostError {
  readonly step: string
  readonly rollbackFailures: readonly AppHostStepFailure[]

  constructor(step: string, cause: unknown, rollbackFailures: readonly AppHostStepFailure[] = []) {
    super('host_app_start_failed', `App host failed to start service "${step}"`, { cause })
    this.name = 'AppHostStartError'
    this.step = step
    this.rollbackFailures = rollbackFailures
  }
}
