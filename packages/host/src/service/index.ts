import { UnsupportedPlatformError } from './errors.js'
import { createLaunchdBackend } from './launchd.js'
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
export { launchdPlist } from './launchd.js'
export { systemdUnit } from './systemd.js'
export {
  RESTART_AFTER_PID_VARIABLE,
  RESTART_EXIT_CODE,
  isSupervised,
  restartSelf,
  waitForPredecessor,
  type RestartSelfOptions,
} from './self-restart.js'

/** linux -> systemd, darwin -> launchd; win32 comes in a follow-up issue. Throws UnsupportedPlatformError. */
export function serviceBackend(
  platform: NodeJS.Platform = process.platform,
  options: ServiceBackendOptions = {},
): ServiceBackend {
  if (platform === 'linux') return createSystemdBackend(options)
  if (platform === 'darwin') return createLaunchdBackend(options)
  throw new UnsupportedPlatformError(platform)
}
