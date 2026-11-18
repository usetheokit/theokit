import { readdirSync } from 'node:fs'

/** Entry names of a directory, `[]` when it is missing or unreadable. */
export function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
