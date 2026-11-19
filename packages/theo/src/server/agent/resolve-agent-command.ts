import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/** The absolute entries of a `PATH` value: empty, `.` and relative entries (which mean the cwd) are dropped. */
export function absolutePathEntries(path: string | undefined): string[] {
  return (path ?? '').split(delimiter).filter((entry) => entry !== '' && isAbsolute(entry))
}

function executableFile(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * The executable `command` names: itself when it is an absolute path to an executable file, else the
 * first executable file named `command` on an absolute entry of `path`. A relative command with a
 * `/` (`./agent`, `bin/agent`), a command with `=`, and relative or empty `PATH` entries are never
 * used, so nothing resolves inside the agent's working directory. `undefined` when nothing matches.
 *
 * Windows: PATHEXT lookup is out of scope, so there the command is returned as given and the
 * spawn behaves as it always did.
 */
export function resolveAgentCommand(command: string, path: string | undefined): string | undefined {
  if (process.platform === 'win32') return command
  if (command === '' || command.includes('=')) return undefined
  if (command.includes('/')) {
    return isAbsolute(command) && executableFile(command) ? command : undefined
  }
  for (const dir of absolutePathEntries(path)) {
    const candidate = join(dir, command)
    if (executableFile(candidate)) return candidate
  }
  return undefined
}
