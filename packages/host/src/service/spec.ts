import { isAbsolute } from 'node:path'

import { ServiceDefinitionError } from './errors.js'
import type { Runner } from './runner.js'

export interface ServiceSpec {
  /** Service name; [A-Za-z0-9._-]+ only, refused otherwise. */
  readonly label: string
  readonly description?: string
  /** Absolute paths. */
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly workingDirectory: string
}

export type ServiceState = 'running' | 'stopped' | 'not-installed' | 'unknown'

export interface ServiceBackend {
  readonly platform: NodeJS.Platform
  definitionPath(spec: Pick<ServiceSpec, 'label'>): string
  /** Throws ServiceCommandError; systemd restores the previous definition; launchd removes the new one. */
  install(spec: ServiceSpec): Promise<void>
  uninstall(label: string): Promise<void>
  status(label: string): Promise<ServiceState>
  restart(label: string): Promise<void>
}

export interface ServiceBackendOptions {
  readonly runner?: Runner
  readonly homeDir?: string
  readonly env?: NodeJS.ProcessEnv
  readonly uid?: number
  /** launchd: the file stdout and stderr go to; defaults to ~/Library/Logs/<label>.log. */
  readonly logFile?: string
}

const LABEL = /^[A-Za-z0-9._-]+$/
const ENV_NAME = /^[A-Za-z_]\w*$/

export function assertLabel(label: string): void {
  if (!LABEL.test(label) || label === '.' || label === '..') {
    throw new ServiceDefinitionError('label', 'may only contain letters, digits, ".", "_" and "-"')
  }
}

/** A line break would end a unit directive and start another. */
function assertNoLineBreak(field: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new ServiceDefinitionError(field, 'cannot hold a line break')
}

/** A backslash before the newline that ends the directive would continue the line into the next one. */
function assertNoTrailingBackslash(field: string, value: string): void {
  if (value.endsWith('\\')) throw new ServiceDefinitionError(field, 'cannot end with a backslash')
}

function assertAbsolute(field: string, value: string): void {
  assertNoLineBreak(field, value)
  if (!isAbsolute(value)) throw new ServiceDefinitionError(field, 'must be an absolute path')
}

/** Check every field of a spec; throws ServiceDefinitionError naming the field, never the value. */
export function validateSpec(spec: ServiceSpec): void {
  assertLabel(spec.label)
  if (spec.description !== undefined) {
    assertNoLineBreak('description', spec.description)
    assertNoTrailingBackslash('description', spec.description)
  }
  assertAbsolute('command', spec.command)
  assertAbsolute('workingDirectory', spec.workingDirectory)
  assertNoTrailingBackslash('workingDirectory', spec.workingDirectory)
  for (const [index, arg] of (spec.args ?? []).entries()) assertNoLineBreak(`args[${index}]`, arg)
  for (const [name, value] of Object.entries(spec.env ?? {})) {
    if (!ENV_NAME.test(name))
      throw new ServiceDefinitionError('env', 'has a variable name that is not a valid identifier')
    assertNoLineBreak(`env.${name}`, value)
  }
}
