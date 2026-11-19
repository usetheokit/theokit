import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { TheokitAgentError } from '@theokit/sdk/errors'

const execFileAsync = promisify(execFile)

/** A directory a sub-agent may edit without sharing a working tree with anyone else. */
export interface IsolatedWorkspace {
  readonly path: string
  readonly branch?: string
  /** Removes the workspace (and its branch). `keep: true` leaves both in place. */
  release(options?: { keep?: boolean }): Promise<void>
}

export interface WorkspaceProvider {
  acquire(taskId: string): Promise<IsolatedWorkspace>
}

/** A bad task id, a git failure (its stderr is in the message) or a cleanup failure. */
export class WorkspaceProviderError extends TheokitAgentError {
  override readonly name = 'WorkspaceProviderError'
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(`[@theokit/agents] ${message}`, {
      code: 'WORKSPACE_PROVIDER_FAILED',
      isRetryable: false,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    })
  }
}

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return stdout
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr
    const detail = typeof stderr === 'string' && stderr.trim() ? stderr.trim() : String(error)
    throw new WorkspaceProviderError(`git ${args.join(' ')} failed: ${detail}`, { cause: error })
  }
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Creates `dir` one component at a time, refusing any existing symlink on the way. */
async function ensureDirInside(workspace: string, dir: string, label: string): Promise<void> {
  const parts = relative(workspace, dir).split(sep).filter(Boolean)
  let current = workspace
  for (const part of parts) {
    current = join(current, part)
    const info = await lstat(current).catch(() => undefined)
    if (!info) await mkdir(current)
    else if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new WorkspaceProviderError(`${label} would be written through a symlink`)
    }
  }
}

/**
 * Copies `src` to `dest`, entry by entry. A symlink (the listed path or one nested in a directory)
 * is followed only when its target stays inside the repository; the destination's parent must
 * resolve inside the workspace and the destination itself must not be a symlink.
 */
async function copyEntry(
  src: string,
  dest: string,
  roots: { repo: string; workspace: string },
  label: string,
): Promise<void> {
  let source: string
  try {
    // realpath resolves every component, so `ignored-link/secret` is checked as well as a final link.
    source = await realpath(src)
  } catch {
    return // dangling link: nothing to copy
  }
  if (!inside(roots.repo, source)) {
    throw new WorkspaceProviderError(`${label} resolves outside the repository`)
  }
  await ensureDirInside(roots.workspace, dirname(dest), label)
  if ((await stat(source)).isDirectory()) {
    await ensureDirInside(roots.workspace, dest, label)
    for (const name of await readdir(source)) {
      await copyEntry(join(source, name), join(dest, name), roots, `${label}/${name}`)
    }
    return
  }
  await copyFileAnchored(source, dest, roots, label)
}

/**
 * Copies one file through open descriptors instead of paths. Both ends are opened with O_NOFOLLOW
 * (a link swapped in at the last component fails), and after each open the descriptor is compared
 * with the path's current realpath, so a directory swapped for a symlink since the checks above is
 * caught before any byte is read or written. Nothing is truncated until the destination is verified.
 */
async function copyFileAnchored(
  source: string,
  dest: string,
  roots: { repo: string; workspace: string },
  label: string,
): Promise<void> {
  const refused = () => new WorkspaceProviderError(`${label} changed while it was being copied`)
  const verify = async (
    fd: { stat(): Promise<{ ino: number; dev: number }> },
    path: string,
    root: string,
  ) => {
    const [here, now] = await Promise.all([fd.stat(), stat(await realpath(path))])
    if (!inside(root, await realpath(path)) || here.ino !== now.ino || here.dev !== now.dev) {
      throw refused()
    }
  }
  const open_ = async (path: string, flags: number) => {
    try {
      return await open(path, flags | constants.O_NOFOLLOW, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new WorkspaceProviderError(`${label} would be written through a symlink`)
      }
      throw error
    }
  }
  const from = await open_(source, constants.O_RDONLY)
  try {
    await verify(from, source, roots.repo)
    const to = await open_(dest, constants.O_WRONLY | constants.O_CREAT)
    try {
      await verify(to, dest, roots.workspace)
      await to.truncate(0)
      await to.writeFile(await from.readFile())
    } finally {
      await to.close()
    }
  } finally {
    await from.close()
  }
}

/**
 * Copies the paths listed in `<repo>/<include>` into the new worktree. One literal, repository-
 * relative path per line (files or directories); blank lines and `#` comments are skipped. A path
 * that leaves the repository (lexically or through a symlink) is refused. A missing include file
 * or a listed path that does not exist is skipped.
 */
async function copyIncluded(repo: string, workspace: string, include: string): Promise<void> {
  let text: string
  try {
    text = await readFile(join(repo, include), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const repoReal = await realpath(repo)
  const workspaceReal = await realpath(workspace)
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const src = resolve(repo, line)
    const dest = resolve(workspace, line)
    if (isAbsolute(line) || !inside(resolve(repo), src) || !inside(resolve(workspace), dest)) {
      throw new WorkspaceProviderError(`${include}: "${line}" is outside the repository`)
    }
    try {
      await lstat(src)
    } catch {
      continue
    }
    await copyEntry(
      src,
      dest,
      { repo: repoReal, workspace: workspaceReal },
      `${include}: "${line}"`,
    )
  }
}

/**
 * One `git worktree add -b <prefix><id> <root>/<id>` per task. Gitignored files named in the
 * `include` file (default `.worktreeinclude`) are copied into the new worktree.
 */
export function worktreeProvider(
  repo: string,
  root: string,
  options: { branchPrefix?: string; include?: string } = {},
): WorkspaceProvider {
  const prefix = options.branchPrefix ?? 'task/'
  const include = options.include ?? '.worktreeinclude'

  async function remove(path: string, branch: string): Promise<void> {
    const failures: unknown[] = []
    try {
      await git(repo, ['worktree', 'remove', '--force', path])
    } catch (error) {
      failures.push(error)
    }
    try {
      await git(repo, ['branch', '-D', branch])
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) {
      throw new WorkspaceProviderError(
        `cleanup of ${path} failed: ${failures.map((f) => (f as Error).message).join('; ')}`,
        {
          cause:
            failures.length === 1
              ? failures[0]
              : new AggregateError(failures, 'worktree and branch cleanup failed'),
        },
      )
    }
  }

  return {
    async acquire(taskId) {
      if (!TASK_ID.test(taskId) || taskId.includes('..')) {
        throw new WorkspaceProviderError(`invalid task id "${taskId}"`)
      }
      const path = resolve(root, taskId)
      const branch = `${prefix}${taskId}`
      await mkdir(resolve(root), { recursive: true })
      await git(repo, ['worktree', 'add', '-b', branch, path])
      try {
        await copyIncluded(repo, path, include)
      } catch (error) {
        try {
          await remove(path, branch)
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], 'workspace setup and its cleanup both failed')
        }
        throw error
      }
      let released = false
      return {
        path,
        branch,
        async release(releaseOptions) {
          if (releaseOptions?.keep || released) return
          await remove(path, branch)
          released = true
        },
      }
    },
  }
}
