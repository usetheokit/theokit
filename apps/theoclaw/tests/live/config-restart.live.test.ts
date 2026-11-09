import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { runControlTurn } from './support/control-turn.js'

/**
 * B-716, OC-94: a changed start-only setting (here the port and the control token) in the
 * configuration file of a running instance takes effect with no restart by the owner. The instance
 * answers a real-model turn on the first port, the file is rewritten, and a turn is answered on the
 * new port with the new token. Runs only with THEOCLAW_LIVE=1, THEOCLAW_MODEL and a key, on Linux
 * (the successor is found through /proc to be ended).
 */
const LIVE = process.env.THEOCLAW_LIVE === '1' && process.platform === 'linux'
const TURN_MS = 120_000
const TSX_LOADER = import.meta.resolve('tsx')
const ENTRY = join(import.meta.dirname, '..', '..', 'src', 'main.ts')

let root: string | undefined
let child: ChildProcess | undefined

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** Every process started with this THEOCLAW_CONFIG: the first instance and its successors. */
function instancesOf(config: string): number[] {
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .filter((name) => {
      try {
        return readFileSync(`/proc/${name}/environ`, 'utf8').split('\0').includes(`THEOCLAW_CONFIG=${config}`)
      } catch {
        return false
      }
    })
    .map(Number)
}

afterAll(() => {
  if (root !== undefined) for (const pid of instancesOf(join(root, 'theoclaw.env'))) process.kill(pid, 'SIGKILL')
  child?.kill('SIGKILL')
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!LIVE)('a changed start-only setting restarts the instance (OC-94)', () => {
  it('answers a turn on the new port and token after the file changed', { timeout: TURN_MS * 3 }, async () => {
    if (!process.env.THEOCLAW_MODEL || !(process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY)) {
      throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
    }
    root = mkdtempSync(join(tmpdir(), 'theoclaw-live-restart-'))
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const config = join(root, 'theoclaw.env')
    const model = [`THEOCLAW_MODEL="${process.env.THEOCLAW_MODEL}"`, ...(['THEOKIT_API_KEY', 'OPENROUTER_API_KEY'] as const).flatMap((k) => (process.env[k] ? [`${k}="${process.env[k]}"`] : []))]
    const write = (port: number, token: string): void => writeFileSync(config, [...model, `THEOCLAW_PORT="${port}"`, `THEOCLAW_CONTROL_TOKEN="${token}"`, ''].join('\n'))
    const [first, second] = [await freePort(), await freePort()]
    const [tokenA, tokenB] = [randomBytes(24).toString('base64url'), randomBytes(24).toString('base64url')]
    write(first, tokenA)
    child = spawn(process.execPath, ['--import', TSX_LOADER, ENTRY], {
      env: { PATH: process.env.PATH, HOME: root, THEOCLAW_CONFIG: config, THEOCLAW_WORKSPACE: workspace, THEOCLAW_STATE_DIR: join(root, 'state') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout!.on('data', (chunk: Buffer) => (log += chunk.toString()))
    child.stderr!.on('data', (chunk: Buffer) => (log += chunk.toString()))

    const word = (): string => `w${randomInt(10 ** 8)}`
    const ask = async (port: number, token: string): Promise<void> => {
      const expected = word()
      let turn = await runControlTurn(port, token, `Reply with just this word: ${expected}`, TURN_MS)
      for (let attempt = 0; attempt < 30 && turn.status !== 'finished' && !turn.text; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        turn = await runControlTurn(port, token, `Reply with just this word: ${expected}`, TURN_MS).catch(() => turn)
      }
      expect(turn.status, log).toBe('finished')
      expect(turn.text.toLowerCase(), log).toContain(expected)
    }
    await ask(first, tokenA)

    write(second, tokenB)
    await ask(second, tokenB)
    expect(log).toContain('restarting')
  })
})
