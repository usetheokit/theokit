import { join } from 'node:path'

import { InstanceConfigError } from './errors.js'

const NAME = /^[a-z0-9-]+$/

export function assertAppName(app: string): void {
  if (!NAME.test(app)) {
    throw new InstanceConfigError('instance_config_bad_app', 'app must match [a-z0-9-]+')
  }
}

export function defaultVariable(app: string, suffix: string): string {
  return `${app.toUpperCase().replaceAll('-', '_')}_${suffix}`
}

export interface ResolvedPath {
  readonly path: string
  readonly explicit: boolean
  readonly variable: string
}

export function resolveConfigPath(
  app: string,
  pathVariable: string,
  profileVariable: string,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): ResolvedPath {
  const explicit = env[pathVariable]
  if (explicit !== undefined && explicit !== '') {
    return { path: explicit, explicit: true, variable: pathVariable }
  }
  const profile = env[profileVariable]
  if (profile !== undefined && profile !== '' && !NAME.test(profile)) {
    throw new InstanceConfigError(
      'instance_config_bad_profile',
      `${profileVariable} must match [a-z0-9-]+`,
      {
        variable: profileVariable,
      },
    )
  }
  const { XDG_CONFIG_HOME: xdg } = env
  const base = xdg !== undefined && xdg !== '' ? xdg : join(homeDir, '.config')
  const file = profile !== undefined && profile !== '' ? `${app}-${profile}.env` : `${app}.env`
  return { path: join(base, app, file), explicit: false, variable: pathVariable }
}
