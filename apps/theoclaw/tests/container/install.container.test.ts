import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { Docker, type DockerResult, parseTurn, TURN_CLIENT, waitUntil } from './support/docker.js'

/**
 * OC-30, OC-31 and OC-34 in a clean container (B-374, T5.2): a non-root user in `node:22-bookworm`
 * runs the README's documented install command against a clone of this checkout, onboards, starts,
 * gets a real-model reply within 60 s, then updates on the dev channel and gets a second reply.
 * Runs only with THEOCLAW_CONTAINER=1, where Docker and the model key are required, never skipped.
 */
const CONTAINER = process.env.THEOCLAW_CONTAINER === '1'
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const REPO = join(APP_DIR, '..', '..')
const USER = 'claw'
const CONFIG = `/home/${USER}/.config/theoclaw/theoclaw.env`

let docker: Docker | undefined
let name: string | undefined

function report(step: string, result: DockerResult): void {
  process.stdout.write(`[${step}] exit ${result.code} in ${result.elapsedMs} ms\n`)
}

/** A bash script run as the non-root user, with the launcher's directory on PATH. */
function asUser(script: string, deadlineMs: number, options: { detach?: boolean; capture?: boolean } = {}): Promise<DockerResult> {
  const detach = options.detach === true ? ['-d'] : []
  return docker!.run(['exec', ...detach, '-u', USER, '-w', `/home/${USER}`, name!, 'bash', '-c', `export PATH="$HOME/.local/bin:$PATH"; ${script}`], deadlineMs, options)
}

/** The README's documented install command, with the scratch origin as the URL. */
function documentedInstall(origin: string): string {
  const readme = readFileSync(join(APP_DIR, 'README.md'), 'utf8')
  const section = readme.split(/^## /m).find((part) => part.startsWith('Install\n'))!
  const command = /```bash\n([\s\S]*?)```/.exec(section)![1]!.trim()
  return command.replace('https://github.com/usetheokit/theokit.git', origin)
}

async function turn(startedAt: number): Promise<{ status: string; text: string; elapsedMs: number; error: string }> {
  const result = await docker!.run(
    ['exec', '-u', USER, '-w', `/home/${USER}/theokit/apps/theoclaw`, name!, 'node', '--input-type=module', '-e', TURN_CLIENT, '8787', CONFIG, String(startedAt + 60_000)],
    90_000,
  )
  const parsed = parseTurn(result)
  process.stdout.write(`[turn] ${parsed.status} after ${parsed.finishedAt - startedAt} ms: ${parsed.text.slice(0, 200)}\n`)
  return { ...parsed, elapsedMs: parsed.finishedAt - startedAt }
}

async function startInstance(): Promise<number> {
  const started = await asUser('echo $$ > ~/theoclaw.pid; exec theoclaw start > ~/theoclaw.log 2>&1', 30_000, { detach: true })
  expect(started.code).toBe(0)
  return Date.now()
}

async function stopInstance(): Promise<void> {
  expect((await asUser('kill -TERM "$(cat ~/theoclaw.pid)"', 30_000)).code).toBe(0)
  await waitUntil(async () => (await asUser('! kill -0 "$(cat ~/theoclaw.pid)" 2>/dev/null', 30_000)).code === 0, 30_000, 'the instance did not stop')
}

afterEach(async () => {
  const current = docker
  const container = name
  docker = undefined
  name = undefined
  if (current === undefined || container === undefined) return
  try {
    const log = await current.run(['exec', container, 'cat', `/home/${USER}/theoclaw.log`], 30_000)
    process.stdout.write(`[instance log]\n${log.stdout.slice(-4000)}\n`)
    const config = await current.run(['exec', container, 'cat', CONFIG], 30_000, { capture: false })
    const token = parseEnv(config.stdout).THEOCLAW_CONTROL_TOKEN ?? ''
    const key = process.env.OPENROUTER_API_KEY ?? ''
    // 'no container command printed the key or the control token' (NFR-004).
    expect(current.leaks(key), 'commands that printed the model key').toEqual([])
    expect(current.leaks(token), 'commands that printed the control token').toEqual([])
  } finally {
    await current.run(['rm', '-f', container], 60_000)
  }
}, 120_000)

describe.skipIf(!CONTAINER)('a clean container installs TheoClaw from source', () => {
  it('a clean container installs, onboards, replies within 60 s and updates', { timeout: 900_000 }, async () => {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('THEOCLAW_CONTAINER=1 needs OPENROUTER_API_KEY')
    if (!process.env.THEOCLAW_MODEL) throw new Error('THEOCLAW_CONTAINER=1 needs THEOCLAW_MODEL')
    docker = Docker.require()
    name = `theoclaw-check-${randomBytes(4).toString('hex')}`
    const run = await docker.run(['run', '-d', '--name', name, '-v', `${REPO}:/src:ro`, '-e', 'OPENROUTER_API_KEY', '-e', 'THEOCLAW_MODEL', 'node:22-bookworm', 'sleep', 'infinity'], 300_000)
    expect(run.code, run.stderr).toBe(0)
    expect((await docker.run(['exec', name, 'useradd', '-m', '-s', '/bin/bash', USER], 30_000)).code).toBe(0)

    // /src belongs to the runner's uid, and git refuses a repository another user owns.
    const origin = `/home/${USER}/origin.git`
    const prepare = await asUser(
      [
        'git config --global --add safe.directory /src',
        'git config --global --add safe.directory /src/.git',
        'git config --global user.email check@example.com',
        'git config --global user.name check',
        `git clone -q --bare /src ${origin}`,
        `git -C ${origin} rev-parse --verify --quiet refs/heads/develop >/dev/null || git -C ${origin} branch develop HEAD`,
      ].join(' && '),
      120_000,
    )
    report('prepare origin', prepare)
    expect(prepare.code, prepare.stderr).toBe(0)

    const install = await asUser(documentedInstall(origin), 600_000)
    report('install', install)
    expect(install.code, install.stderr.slice(-2000)).toBe(0)

    const onboard = await asUser('theoclaw onboard --yes --model "$THEOCLAW_MODEL" --api-key-env OPENROUTER_API_KEY --port 8787 --owners telegram:owner', 60_000)
    report('onboard', onboard)
    expect(onboard.code, onboard.stderr).toBe(0)
    const modes = await asUser(`stat -c %a ${CONFIG} "$(dirname ${CONFIG})"`, 30_000)
    const [configMode, dirMode] = modes.stdout.trim().split('\n')
    expect(configMode).toBe('600')
    expect(dirMode).toBe('700')

    const firstTurn = await turn(await startInstance())
    expect(firstTurn.status, firstTurn.error).toBe('finished')
    expect(firstTurn.elapsedMs).toBeLessThan(60_000)

    const push = await asUser(
      [`git clone -q ${origin} upstream`, 'cd upstream', 'git switch -q develop', 'echo update >> apps/theoclaw/UPDATE-CHECK', 'git add apps/theoclaw/UPDATE-CHECK', 'git commit -q -m "update check"', 'git push -q origin develop'].join(' && '),
      120_000,
    )
    report('push to develop', push)
    expect(push.code, push.stderr).toBe(0)
    const update = await asUser('theoclaw update --channel dev', 600_000)
    report('update', update)
    expect(update.code, update.stderr.slice(-2000)).toBe(0)
    expect(update.stdout).toMatch(/^updated /m)

    await stopInstance()
    const secondTurn = await turn(await startInstance())
    expect(secondTurn.status, secondTurn.error).toBe('finished')
  })
})
