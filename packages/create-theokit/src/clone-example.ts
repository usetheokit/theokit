import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bootstrap a project directory from an existing GitHub repository (`--example`).
 *
 * Only a full URL is accepted. A bare name used to be resolved against a hard-coded examples
 * repository that returns 404 under both orgs and was never published (theokit#315) — so the
 * named form could only ever fail, and it failed by shelling out to `degit` and then printing a
 * dead link. It now fails immediately, naming the form that works.
 *
 * @throws Error when `example` is not an `http(s)` URL.
 */
export function cloneExample(example: string, targetDir: string): void {
  if (!example.startsWith('http://') && !example.startsWith('https://')) {
    throw new Error(
      `Example "${example}" is not a repository URL. ` +
        `Pass a full GitHub URL, e.g. --example=https://github.com/user/repo`,
    )
  }
  execSync(`git clone --depth 1 ${example} ${targetDir}`, { stdio: 'inherit' })
  // Remove .git to let the user init fresh.
  rmSync(join(targetDir, '.git'), { recursive: true, force: true })
}
