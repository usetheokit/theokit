import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { bindToolScope } from '@theokit/agents/tool-scope'
import {
  createApplyPatchTool,
  createEditFileTool,
  createWriteFileTool,
} from '@theokit/agents/tools'
import type { DelegationPort, DelegationResult } from '@theokit/agents'
import type { CustomTool } from '@theokit/sdk'

import {
  cloneMachineProvider,
  createCloudRunner,
  type CloudMachineProvider,
} from '../routing/cloud-worker.js'
import { createWorktreeRunner } from '../routing/task-worktree.js'
import type { TurnMessage } from '../agent-port.js'
import type { ToolSettings } from './tool-settings.js'

const exec = promisify(execFile)

/** Whether a `coder` worker can be offered: host tools on, writes allowed, the tool root a repository. */
export function codingWorkersAvailable(settings: ToolSettings): boolean {
  return settings.hostTools && settings.gitRepository && settings.sandboxMode !== 'read-only'
}

/** The tools of a coding worker: the read-only ones and the file writers, all bound to its worktree. */
export function coderTools(
  settings: ToolSettings,
  worktreePath: string,
  readOnlyTools: (settings: ToolSettings) => CustomTool[],
): CustomTool[] {
  const inTree: ToolSettings = { ...settings, toolRoot: worktreePath }
  const scope = bindToolScope({
    projectRoot: worktreePath,
    writeRoot: worktreePath,
    sandbox: settings.sandbox,
    mode: settings.mode,
  })
  return [
    ...readOnlyTools(inTree),
    scope.bind(createWriteFileTool)(),
    scope.bind(createEditFileTool)(),
    scope.bind(createApplyPatchTool)(),
  ]
}

/**
 * The `coder` roster entry (OC-83, B-395): each task gets its own git worktree and branch under
 * `<workspace>/.theoclaw/worktrees`, a worker whose file tools write only there, and a commit of
 * what it changed. The worktree and branch stay until removed (the result gives the commands; a failed task's are removed at once).
 */
export function codingWorkerPort(
  settings: ToolSettings,
  readOnlyTools: (settings: ToolSettings) => CustomTool[],
  runWorker: (
    tools: CustomTool[],
    task: TurnMessage,
    signal: AbortSignal | undefined,
  ) => Promise<DelegationResult>,
): DelegationPort {
  const runner = createWorktreeRunner({
    repo: settings.toolRoot,
    root: join(settings.workspace, '.theoclaw', 'worktrees'),
  })
  return {
    run: (task, options) => {
      const id = `coder-${randomBytes(4).toString('hex')}`
      return runner.run({
        id,
        keep: true,
        work: async (worktree) => {
          const result = await runWorker(
            coderTools(settings, worktree.path, readOnlyTools),
            task as TurnMessage,
            options?.signal,
          )
          const git = (...args: string[]) =>
            exec('git', [
              '-C',
              worktree.path,
              '-c',
              'user.name=theoclaw',
              '-c',
              'user.email=theoclaw@localhost',
              ...args,
            ])
          await git('add', '-A')
          const dirty = (await git('status', '--porcelain')).stdout.trim() !== ''
          if (dirty) await git('commit', '-q', '-m', `theoclaw coder ${id}`)
          const note = `\n\n[worktree ${worktree.path} on branch ${worktree.branch}${dirty ? '' : '; no changes to commit'}; clean up with: git worktree remove --force ${worktree.path} && git branch -D ${worktree.branch}]`
          return { ...result, response: result.response + note }
        },
      })
    },
  }
}

/**
 * The `cloud` roster entry (OC-83): the coding task runs against a checkout on a provisioned
 * machine, its commit lands on a task branch of the repository, and the machine is torn down.
 */
export function cloudWorkerPort(
  settings: ToolSettings,
  readOnlyTools: (settings: ToolSettings) => CustomTool[],
  runWorker: (
    tools: CustomTool[],
    task: TurnMessage,
    signal: AbortSignal | undefined,
  ) => Promise<DelegationResult>,
  provider: CloudMachineProvider = cloneMachineProvider(
    join(settings.workspace, '.theoclaw', 'cloud-workers'),
  ),
): DelegationPort {
  const runner = createCloudRunner({ repo: settings.toolRoot, provider })
  return {
    run: async (task, options) => {
      const id = `cloud-${randomBytes(4).toString('hex')}`
      let result: DelegationResult | undefined
      const outcome = await runner.run(id, async (machine) => {
        result = await runWorker(
          coderTools(settings, machine.path, readOnlyTools),
          task as TurnMessage,
          options?.signal,
        )
      })
      const note = `\n\n[cloud worker ${id}: ${outcome.committed ? `commit on branch ${outcome.branch}` : 'no changes to commit'}; ${outcome.recipe ? `environment ${outcome.recipe}; ` : ''}machine torn down]`
      return {
        ...(result as DelegationResult),
        response: (result as DelegationResult).response + note,
      }
    },
  }
}
