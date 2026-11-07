/**
 * Managed git worktrees for delegated tasks (OC-83, B-395): each task runs in its own worktree on
 * its own branch, so concurrent tasks never share a working tree. The disposable remote machine
 * half of OC-83 is not built here.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface TaskWorktree {
  readonly path: string
  readonly branch: string
}

export interface DelegatedTask<T> {
  readonly id: string
  readonly work: (worktree: TaskWorktree) => Promise<T>
}

export interface WorktreeRunnerOptions {
  /** The repository the worktrees branch from. */
  readonly repo: string
  /** Where worktrees are created; one subdirectory per task. */
  readonly root: string
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function createWorktreeRunner(options: WorktreeRunnerOptions) {
  const git = (...args: string[]) => run('git', ['-C', options.repo, ...args])
  return {
    /** Run the task inside a fresh worktree and remove the worktree and branch afterwards, even on failure. */
    async run<T>(task: DelegatedTask<T>): Promise<T> {
      if (!SAFE_ID.test(task.id) || task.id.includes('..')) throw new Error(`unsafe task id: ${task.id}`)
      const worktree: TaskWorktree = { path: join(options.root, task.id), branch: `task/${task.id}` }
      await git('worktree', 'add', '-b', worktree.branch, worktree.path)
      try {
        return await task.work(worktree)
      } finally {
        await git('worktree', 'remove', '--force', worktree.path)
        await git('branch', '-D', worktree.branch)
      }
    },
  }
}
