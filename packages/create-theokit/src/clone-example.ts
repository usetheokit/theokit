import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

/** Runs a program with a fixed argv. Injected so the argv can be asserted without cloning. */
export type ExecFile = (file: string, args: string[]) => void

const runGit: ExecFile = (file, args) => {
  execFileSync(file, args, { stdio: 'inherit' })
}

/**
 * Bootstrap a project directory from an existing GitHub repository (`--example`).
 *
 * Only a full URL is accepted. A bare name used to be resolved against a hard-coded examples
 * repository that returns 404 under both orgs and was never published (theokit#315) — so the
 * named form could only ever fail, and it failed by shelling out to `degit` and then printing a
 * dead link. It now fails immediately, naming the form that works.
 *
 * The URL reaches `git` as ONE argv entry, never through a shell. It is command-line input, so
 * interpolating it into a shell string (`git clone ${example}`) lets a `;` or a backtick run
 * whatever follows with the user's privileges — CodeQL `js/indirect-command-line-injection` and
 * `js/shell-command-injection-from-environment`. `execFileSync` with an argv array has no shell to
 * interpret them, which removes the class instead of escaping around it.
 *
 * @throws Error when `example` is not an `http(s)` URL.
 */
export function cloneExample(example: string, targetDir: string, exec: ExecFile = runGit): void {
  if (!example.startsWith('http://') && !example.startsWith('https://')) {
    throw new Error(
      `Example "${example}" is not a repository URL. ` +
        `Pass a full GitHub URL, e.g. --example=https://github.com/user/repo`,
    )
  }
  exec('git', ['clone', '--depth', '1', example, targetDir])
  // Remove .git to let the user init fresh.
  rmSync(join(targetDir, '.git'), { recursive: true, force: true })
}
