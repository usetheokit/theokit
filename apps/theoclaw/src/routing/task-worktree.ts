/**
 * Managed git worktrees for delegated tasks (OC-83, B-395): each task runs in its own worktree on
 * its own branch, so concurrent tasks never share a working tree. Acquire and release are the framework's
 * `worktreeProvider`; only `remove(id)` for a kept task is git here, as the provider has no remove by id.
 * The provider also copies the `.worktreeinclude` files into each worktree. The disposable remote machine
 * half of OC-83 is not built here.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { worktreeProvider } from '@theokit/agents/bridge'

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
  const provider = worktreeProvider(options.repo, options.root)
  return {
    /** Run the task inside a fresh worktree and remove the worktree and branch afterwards, even on failure. */
    async run<T>(task: DelegatedTask<T>): Promise<T> {
      const workspace = await provider.acquire(task.id)
      const worktree: TaskWorktree = { path: workspace.path, branch: workspace.branch ?? `task/${task.id}` }
      let succeeded = false
      try {
        const result = await task.work(worktree)
        succeeded = true
        return result
      } finally {
        await workspace.release({ keep: succeeded && task.keep === true })
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
