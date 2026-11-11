/**
 * Cloud workers (OC-83, B-395): a delegated coding task runs on a provisioned, disposable machine,
 * its commit is brought back onto a task branch of the instance's repository, and the machine is
 * torn down. A `CloudMachineProvider` is the seam to a real provider; the default one provisions a
 * throwaway clone, so the protocol (provision, prepare, dispatch, result return, teardown) runs everywhere.
 * The checkout is prepared by the repository's environment recipe (OC-123) before the worker starts.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { detectRecipe, runRecipe, type RecipeExec } from './environment-recipe.js'

const run = promisify(execFile)

export interface CloudMachine {
  /** The checkout on the machine that the worker edits. */
  readonly path: string
  /** Where the instance fetches the worker's commits from (a git URL or path). */
  readonly remote: string
  /** Dispose of the machine; must be safe to call once after success or failure. */
  teardown(): Promise<void>
}

export interface CloudMachineProvider {
  provision(request: { id: string; repo: string }): Promise<CloudMachine>
}

/** The default provider: a clone of the repository in a fresh temporary directory. */
export function cloneMachineProvider(root: string): CloudMachineProvider {
  return {
    async provision({ id, repo }) {
      await mkdir(root, { recursive: true })
      const dir = await mkdtemp(join(root, `${id}-`))
      const path = join(dir, 'checkout')
      try {
        await run('git', ['clone', '-q', repo, path])
      } catch (error) {
        await rm(dir, { recursive: true, force: true })
        throw error
      }
      return { path, remote: path, teardown: () => rm(dir, { recursive: true, force: true }) }
    },
  }
}

export interface CloudRunResult {
  readonly branch: string
  readonly committed: boolean
  /** The environment recipe that prepared the checkout, when the repository has one. */
  readonly recipe?: string
}

export function createCloudRunner(options: {
  repo: string
  provider: CloudMachineProvider
  exec?: RecipeExec
}) {
  const git = (cwd: string, ...args: string[]) =>
    run('git', [
      '-C',
      cwd,
      '-c',
      'user.name=theoclaw',
      '-c',
      'user.email=theoclaw@localhost',
      ...args,
    ])
  return {
    /**
     * Provision a machine, let `work` edit its checkout, commit there, fetch the commit onto
     * `task/<id>` in the repository (only when something changed), and always tear the machine down.
     */
    async run(id: string, work: (machine: CloudMachine) => Promise<void>): Promise<CloudRunResult> {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..'))
        throw new Error(`unsafe task id: ${id}`)
      const machine = await options.provider.provision({ id, repo: options.repo })
      try {
        const recipe = await detectRecipe(machine.path)
        if (recipe) await runRecipe(recipe, machine.path, options.exec)
        await work(machine)
        await git(machine.path, 'add', '-A')
        const dirty = (await git(machine.path, 'status', '--porcelain')).stdout.trim() !== ''
        const branch = `task/${id}`
        if (!dirty) return { branch, committed: false, recipe: recipe?.source }
        await git(machine.path, 'commit', '-q', '-m', `theoclaw cloud worker ${id}`)
        await git(options.repo, 'fetch', '-q', machine.remote, `HEAD:refs/heads/${branch}`)
        return { branch, committed: true, recipe: recipe?.source }
      } finally {
        await machine.teardown()
      }
    },
  }
}
