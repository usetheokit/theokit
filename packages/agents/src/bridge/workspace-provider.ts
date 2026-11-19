import { execFile } from 'node:child_process'
import { copyFile, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
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

/**
 * Copies `src` to `dest`, entry by entry. A symlink anywhere in the source is refused (its target
 * could be outside the repository), and so is a destination that is, or sits under, a link leaving
 * the workspace (a tracked symlink in the checkout would otherwise redirect the copy).
 */
async function copyEntry(src: string, dest: string, workspaceReal: string): Promise<void> {
  const info = await lstat(src)
  if (info.isSymbolicLink()) {
    throw new WorkspaceProviderError(`${src} is a symlink, which .worktreeinclude does not copy`)
  }
  await mkdir(dirname(dest), { recursive: true })
  if (!inside(workspaceReal, await realpath(dirname(dest)))) {
    throw new WorkspaceProviderError(`${dest} would be written outside the workspace`)
  }
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true })
    for (const name of await readdir(src)) {
      await copyEntry(join(src, name), join(dest, name), workspaceReal)
    }
    return
  }
  try {
    if ((await lstat(dest)).isSymbolicLink()) {
      throw new WorkspaceProviderError(`${dest} is a symlink in the workspace; refusing to write`)
    }
  } catch (error) {
    if (error instanceof WorkspaceProviderError) throw error
  }
  await copyFile(src, dest)
}

/**
 * Copies the paths listed in `<repo>/<include>` into the new worktree. One literal, repository-
 * relative path per line (files or directories); blank lines and `#` comments are skipped. A path
 * that leaves the repository (lexically or through a symlink) is refused, as is any symlink inside
 * a listed directory. A missing include file or a listed path that does not exist is skipped.
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
    if (!inside(repoReal, await realpath(dirname(src)))) {
      throw new WorkspaceProviderError(`${include}: "${line}" resolves outside the repository`)
    }
    await copyEntry(src, dest, workspaceReal)
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
          released = true
          await remove(path, branch)
        },
      }
    },
  }
}
