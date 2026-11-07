import { spawn } from 'node:child_process'

/**
 * The restart TheoClaw performs itself when a reloaded setting is read once at the start (B-716,
 * OC-94). A small waiter process is started, which polls until this process is gone (so the port
 * and the instance lock are released) and then starts the same command again with `env`, which
 * the entry passes without the values the configuration file filled in, so the new process reads
 * the changed file. No argument or value is written to any output.
 */
const WAITER = `
const { spawn } = require('node:child_process')
const [pid, command, args, env] = [Number(process.argv[1]), process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])]
const gone = () => { try { process.kill(pid, 0); return false } catch (e) { return e.code === 'ESRCH' } }
const started = Date.now()
const tick = () => {
  if (!gone() && Date.now() - started < 30000) return setTimeout(tick, 100)
  spawn(command, args, { env, stdio: 'inherit', detached: true }).unref()
}
tick()
`

export interface RestartCommand {
  readonly execPath: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Start the waiter; call it from the exit path, after the shutdown has begun. */
export function spawnReplacement(command: RestartCommand, pid: number): void {
  const env = Object.fromEntries(Object.entries(command.env).filter(([, value]) => value !== undefined))
  spawn(process.execPath, ['-e', WAITER, String(pid), command.execPath, JSON.stringify(command.args), JSON.stringify(env)], {
    stdio: 'inherit',
    detached: true,
  }).unref()
}
