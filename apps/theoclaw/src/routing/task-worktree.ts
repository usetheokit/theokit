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
  /**
   * Keep the worktree and branch when the work succeeds, so the branch's commits can be reviewed;
   * `remove(id)` is the cleanup. A failed task is always cleaned up.
   */
  readonly keep?: boolean
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
      let succeeded = false
      try {
        const result = await task.work(worktree)
        succeeded = true
        return result
      } finally {
        if (!(succeeded && task.keep === true)) {
          await git('worktree', 'remove', '--force', worktree.path)
          await git('branch', '-D', worktree.branch)
        }
      }
    },
    /** Clean up a kept task: remove its worktree and, unless `keepBranch`, its branch. */
    async remove(id: string, keepBranch = false): Promise<void> {
      if (!SAFE_ID.test(id) || id.includes('..')) throw new Error(`unsafe task id: ${id}`)
      await git('worktree', 'remove', '--force', join(options.root, id))
      if (!keepBranch) await git('branch', '-D', `task/${id}`)
    },
  }
}
