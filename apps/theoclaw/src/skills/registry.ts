import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TheoClaw's bundled skills ship as `<name>/SKILL.md` folders in this package. The SDK discovers
 * them (`SkillsSettings.bundledDirs`), lets a workspace skill of the same name win, and offers a
 * skill only when its `requires-bins` binaries are on PATH. Both `src/skills` and `dist/skills`
 * sit two levels below the package root.
 */
export const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../../skills', import.meta.url))

/** True when `bin` is an executable file in one of the PATH directories. */
export function binaryOnPath(bin: string, pathValue: string = process.env.PATH ?? ''): boolean {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const directory of pathValue.split(delimiter)) {
    if (directory === '') continue
    for (const extension of extensions) {
      try {
        accessSync(join(directory, bin + extension), constants.X_OK)
        return true
      } catch {
        // Not here.
      }
    }
  }
  return false
}
