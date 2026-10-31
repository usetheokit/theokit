import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { runControlTurn } from '../live/support/control-turn.js'
import { Docker, waitUntil } from './support/docker.js'

/**
 * OC-33 (B-374, T5.2): `apps/theoclaw/Dockerfile` built from a copy of this checkout's committed
 * files, with a planted `apps/theoclaw/.env` the build context must leave out, then run as the
 * runner's uid with a configuration file mounted at /data. It answers /health and a real-model turn
 * within 60 s of `docker run` returning. Runs only with THEOCLAW_CONTAINER=1.
 */
const CONTAINER = process.env.THEOCLAW_CONTAINER === '1'
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const REPO = join(APP_DIR, '..', '..')

let docker: Docker | undefined
let image: string | undefined
let container: string | undefined
let token = ''
const scratch: string[] = []

afterEach(async () => {
  const current = docker
  docker = undefined
  try {
    if (current !== undefined && container !== undefined) {
      const logs = await current.run(['logs', container], 30_000)
      process.stdout.write(`[container log]\n${`${logs.stdout}${logs.stderr}`.slice(-4000)}\n`)
      // 'no container command printed the key or the control token' (NFR-004).
      expect(current.leaks(process.env.OPENROUTER_API_KEY ?? ''), 'commands that printed the model key').toEqual([])
      expect(current.leaks(token), 'commands that printed the control token').toEqual([])
    }
  } finally {
    if (current !== undefined && container !== undefined) await current.run(['rm', '-f', container], 60_000)
    if (current !== undefined && image !== undefined) await current.run(['rmi', '-f', image], 120_000)
    container = undefined
    image = undefined
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
}, 240_000)

describe.skipIf(!CONTAINER)("TheoClaw's image", () => {
  it('the image answers health and a real-model turn', { timeout: 900_000 }, async () => {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) throw new Error('THEOCLAW_CONTAINER=1 needs OPENROUTER_API_KEY')
    if (!process.env.THEOCLAW_MODEL) throw new Error('THEOCLAW_CONTAINER=1 needs THEOCLAW_MODEL')
    docker = Docker.require()
    const run = randomBytes(4).toString('hex')

    // The committed files, plus a credential file where the README tells people to keep theirs.
    const context = mkdtempSync(join(tmpdir(), 'theoclaw-image-context-'))
    scratch.push(context)
    const copied = spawnSync('bash', ['-o', 'pipefail', '-c', `git -C "${REPO}" archive --format=tar HEAD | tar -x -C "${context}"`], { encoding: 'utf8' })
    expect(copied.status, copied.stderr).toBe(0)
    const marker = `theoclaw-context-marker-${run}`
    writeFileSync(join(context, 'apps', 'theoclaw', '.env'), `OPENROUTER_API_KEY=${marker}\n`)

    image = `theoclaw-check:${run}`
    const build = await docker.run(['build', '-f', 'apps/theoclaw/Dockerfile', '-t', image, '.'], 600_000, { cwd: context })
    process.stdout.write(`[build] exit ${build.code} in ${build.elapsedMs} ms\n`)
    expect(build.code, build.stderr.slice(-3000)).toBe(0)

    // Exit 1 is grep's "no file matched"; 0 names a file holding the marker, 2 a failed search.
    const canary = await docker.run(['run', '--rm', '--entrypoint', 'grep', image, '-rlF', marker, '/app'], 120_000)
    expect(canary.stdout.trim(), 'files in the image holding the planted credential').toBe('')
    expect(canary.code, canary.stderr).toBe(1)

    const data = mkdtempSync(join(tmpdir(), 'theoclaw-image-data-'))
    scratch.push(data)
    chmodSync(data, 0o700)
    mkdirSync(join(data, 'state'), { mode: 0o700 })
    token = randomBytes(24).toString('hex')
    const config = [`THEOCLAW_MODEL="${process.env.THEOCLAW_MODEL}"`, `OPENROUTER_API_KEY="${key}"`, 'THEOCLAW_PORT="8787"', 'THEOCLAW_OWNERS="telegram:owner"', `THEOCLAW_CONTROL_TOKEN="${token}"`, '']
    writeFileSync(join(data, 'theoclaw.env'), config.join('\n'), { mode: 0o600 })

    container = `theoclaw-image-${run}`
    const user = `${process.getuid!()}:${process.getgid!()}`
    const started = await docker.run(['run', '-d', '--name', container, '--user', user, '-v', `${data}:/data`, '-p', '127.0.0.1::8787', image], 120_000)
    const startedAt = Date.now()
    expect(started.code, started.stderr).toBe(0)
    const portLine = await docker.run(['port', container, '8787/tcp'], 30_000)
    const port = Number(/:(\d+)\s*$/m.exec(portLine.stdout)?.[1])
    expect(port, portLine.stdout).toBeGreaterThan(0)

    let health = { status: 0 }
    await waitUntil(
      async () => {
        health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => ({ status: response.status }), () => ({ status: 0 }))
        return health.status === 200
      },
      60_000,
      'GET /health never answered 200',
    )
    expect(health.status).toBe(200)
    const turn = await runControlTurn(port, token, 'Reply with the single word: pong', 60_000 - (Date.now() - startedAt))
    const finishedAt = Date.now()
    process.stdout.write(`[turn] ${turn.status} after ${finishedAt - startedAt} ms: ${turn.text.slice(0, 200)}\n`)
    expect(turn.status, turn.error).toBe('finished')
    expect(finishedAt - startedAt).toBeLessThan(60_000)
  })
})
