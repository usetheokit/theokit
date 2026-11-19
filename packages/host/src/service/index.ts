import { UnsupportedPlatformError } from './errors.js'
import type { ServiceBackend, ServiceBackendOptions } from './spec.js'
import { createSystemdBackend } from './systemd.js'

export {
  RestartError,
  ServiceCommandError,
  ServiceDefinitionError,
  UnsupportedPlatformError,
} from './errors.js'
export { runCommand, type Runner, type RunResult } from './runner.js'
export type { ServiceBackend, ServiceBackendOptions, ServiceSpec, ServiceState } from './spec.js'
export { systemdUnit } from './systemd.js'
export {
  RESTART_AFTER_PID_VARIABLE,
  RESTART_EXIT_CODE,
  isSupervised,
  restartSelf,
  restartSelfAsync,
  waitForPredecessor,
  type RestartSelfOptions,
} from './self-restart.js'

/** linux -> systemd here; darwin and win32 come in follow-up issues. Throws UnsupportedPlatformError. */
export function serviceBackend(
  platform: NodeJS.Platform = process.platform,
  options: ServiceBackendOptions = {},
): ServiceBackend {
  if (platform === 'linux') return createSystemdBackend(options)
  throw new UnsupportedPlatformError(platform)
}
