import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

import { type InlineSkill, Skill } from '@theokit/sdk'

/**
 * TheoClaw's own skills. They are inline, not SKILL.md files, so they travel inside the single
 * executable (`build:sea`). The SDK offers one only when its `requiresBins` are on PATH, and
 * `resolveSkills` leaves one out when a skills folder holds a skill of the same name.
 */
export function bundledSkills(): InlineSkill[] {
  return [
    {
      ...Skill.create({
        name: 'git-helper',
        description: 'Inspect repository state and history with git before changing anything.',
        instructions: 'Run `git status` and `git log --oneline -10` first; never rewrite history without being asked.',
      }),
      requiresBins: ['git'],
    },
    Skill.create({
      name: 'summarize-text',
      description: 'Summarize a long text into a short list of points.',
      instructions: 'Read the whole text, then answer with at most five bullet points that keep names and numbers.',
    }),
  ]
}

/**
 * True when `bin` is an executable file in one of the PATH directories. The same rule as the SDK's own
 * gate (which is not exported): a name with a path separator is never on PATH, and on Windows the
 * `PATHEXT` extensions count.
 */
export function binaryOnPath(bin: string, pathValue: string = process.env.PATH ?? ''): boolean {
  if (bin.length === 0 || /[\\/]/.test(bin)) return false
  const extensions = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD').split(';')] : ['']
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
