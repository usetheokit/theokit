import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

import { InstanceConfigError } from './errors.js'
import type { ResolvedPath } from './path.js'

export function loadInstanceConfig(
  resolved: ResolvedPath,
  declared: ReadonlySet<string>,
  env: NodeJS.ProcessEnv,
): string | undefined {
  let text: string
  try {
    text = readFileSync(resolved.path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (resolved.explicit) {
        throw new InstanceConfigError(
          'instance_config_missing',
          `${resolved.variable} points to a file that does not exist: ${resolved.path}`,
          { variable: resolved.variable },
        )
      }
      return undefined
    }
    throw new InstanceConfigError('instance_config_unreadable', `cannot read ${resolved.path}`, {
      cause: error,
    })
  }
  const parsed = parseEnv(text)
  for (const [key, value] of Object.entries(parsed)) {
    if (declared.has(key) && env[key] === undefined && value !== undefined) env[key] = value
  }
  return resolved.path
}
