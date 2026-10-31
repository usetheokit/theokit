import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { TheoClawConfigError } from './control-plane/errors.js'
import { type DaemonIo, type Runner, unitPath } from './daemon.js'
import { resolveInstance } from './instance.js'

/**
 * `theoclaw update [--channel stable|dev]` (B-374, OC-34, plan D4): the channels are branches of
 * the checkout, `stable` following `main` (reached only by releases) and `dev` following `develop`.
 * A dirty checkout, or a branch with commits its channel lacks, is refused before anything moves:
 * a fast-forward cannot discard a user's commit.
 *
 * Two markers in `dist/` (gitignored) make a retry finish what a failed run left: `install.sh`
 * writes `.installed-commit` as its last step, and this command writes `.restarted-commit-<label>`
 * once `systemctl --user restart` of that label's unit exits 0. When HEAD did not move, `from` is
 * the commit the stale marker names. `daemon install` writes no restart marker, so the first update
 * after it rebuilds and restarts even when HEAD did not move.
 */

export type UpdateIo = DaemonIo

const CHANNELS: Readonly<Record<string, 'main' | 'develop'>> = { stable: 'main', dev: 'develop' }

export function channelBranch(channel: string): 'main' | 'develop' {
  const branch = CHANNELS[channel]
  if (branch === undefined) {
    throw new TheoClawConfigError('the update channel must be stable or dev', { variable: 'THEOCLAW_UPDATE_CHANNEL' })
  }
  return branch
}

/** A git step that failed: its own message, and which step it was. */
class StepFailed extends Error {}

function readMarker(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() || undefined : undefined
}

function gitIn(root: string, runner: Runner): (...args: string[]) => Promise<{ code: number; stdout: string }> {
  return async (...args) => {
    const result = await runner('git', ['-C', root, ...args])
    return { code: result.code, stdout: result.stdout.trim() }
  }
}

async function must(runner: Runner, root: string, step: string, ...args: string[]): Promise<string> {
  const result = await runner('git', ['-C', root, ...args])
  if (result.code !== 0) throw new StepFailed(`${step} failed: ${result.stderr.trim() || `git exited ${result.code}`}`)
  return result.stdout.trim()
}

/** Moves the checkout onto `branch` and fast-forwards it; refuses, untouched, a branch that diverged. */
async function advance(runner: Runner, root: string, branch: string): Promise<void> {
  const git = gitIn(root, runner)
  if ((await git('status', '--porcelain')).stdout !== '') throw new StepFailed('the checkout has local changes; commit or discard them first')
  await must(runner, root, `git fetch origin ${branch}`, 'fetch', 'origin', branch)
  const local = (await git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)).code === 0
  if (local && (await git('merge-base', '--is-ancestor', branch, `origin/${branch}`)).code !== 0) {
    throw new StepFailed(`${branch} has diverged from origin/${branch}; nothing was changed`)
  }
  if ((await must(runner, root, 'git rev-parse', 'rev-parse', '--abbrev-ref', 'HEAD')) !== branch) {
    if (local) await must(runner, root, `git switch ${branch}`, 'switch', branch)
    else await must(runner, root, `git switch -c ${branch}`, 'switch', '-c', branch, '--track', `origin/${branch}`)
  }
  await must(runner, root, `git merge --ff-only origin/${branch}`, 'merge', '--ff-only', `origin/${branch}`)
}

export async function update(opts: { readonly channel?: string }, io: UpdateIo, runner: Runner): Promise<number> {
  const branch = channelBranch(opts.channel ?? io.env.THEOCLAW_UPDATE_CHANNEL ?? 'stable')
  const dist = dirname(io.entry)
  const label = resolveInstance(io.env, { homeDir: io.homeDir }).label
  try {
    const root = await must(runner, dist, 'git rev-parse --show-toplevel', 'rev-parse', '--show-toplevel')
    const before = await must(runner, root, 'git rev-parse HEAD', 'rev-parse', 'HEAD')
    await advance(runner, root, branch)
    const head = await must(runner, root, 'git rev-parse HEAD', 'rev-parse', 'HEAD')
    const installed = readMarker(join(dist, '.installed-commit'))
    const restartedMarker = join(dist, `.restarted-commit-${label}`)
    const restarted = readMarker(restartedMarker)
    const unitInstalled = existsSync(unitPath(label, io.homeDir))
    if (head === before && installed === head && (!unitInstalled || restarted === head)) {
      io.stdout.write(`theoclaw update: already up to date on ${branch} at ${head}\n`)
      return 0
    }
    const from = head !== before ? before : installed !== head ? installed : restarted
    const install = await runner(join(dirname(dist), 'install.sh'), [])
    io.stdout.write(install.stdout)
    if (install.code !== 0) throw new StepFailed(`install.sh failed (exit ${install.code}): ${install.stderr.trim()}`)
    if (unitInstalled) {
      const restart = await runner('systemctl', ['--user', 'restart', `${label}.service`])
      if (restart.code !== 0) throw new StepFailed(`systemctl --user restart ${label}.service failed: ${restart.stderr.trim()}`)
      writeFileSync(restartedMarker, `${head}\n`)
    }
    io.stdout.write(`updated ${from ?? 'an unrecorded build'} -> ${head}\n`)
    return 0
  } catch (error) {
    if (!(error instanceof StepFailed)) throw error
    io.stderr.write(`theoclaw update: ${error.message}\n`)
    return 1
  }
}
