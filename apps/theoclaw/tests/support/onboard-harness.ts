import { expect } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { loadConfiguration } from '../../src/config-file.js'
import { TheoClawConfigError } from '../../src/control-plane/errors.js'
import { type OnboardIo, type OnboardOptions } from '../../src/onboard.js'

export const KEY = 'sk-onboard-test-key-0123456789'
const scratch: string[] = []
export interface Harness {
  readonly home: string
  readonly io: OnboardIo
  readonly stdoutText: () => string
}

export function harness(extraEnv: Record<string, string> = {}, tty = false): Harness {
  const home = mkdtempSync(join(tmpdir(), 'theoclaw-onboard-'))
  scratch.push(home)
  let stdoutText = ''
  const stdout = new PassThrough()
  stdout.on('data', (chunk: Buffer) => (stdoutText += chunk.toString()))
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'),
    ONBOARD_TEST_KEY: KEY,
    ...extraEnv,
  }
  const io: OnboardIo = { env, homeDir: home, stdin: new PassThrough(), stdout, isTTY: tty }
  return { home, io, stdoutText: () => stdoutText }
}

export const FLAGS: OnboardOptions = {
  yes: true,
  force: false,
  model: 'openrouter/google/gemini-2.5-flash-lite',
  apiKeyEnv: 'ONBOARD_TEST_KEY',
  port: '8787',
  owners: 'telegram:1',
}

export function configFile(h: Harness, name = 'theoclaw.env'): string {
  return join(h.home, 'config', 'theoclaw', name)
}

export function readBack(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path }
  loadConfiguration(env, '/nonexistent')
  delete env.THEOCLAW_CONFIG
  return env
}

export function mode(path: string): number {
  return statSync(path).mode & 0o777
}

export function listing(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true }).map(String).sort()
}

export async function refusal(promise: Promise<unknown>): Promise<TheoClawConfigError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(TheoClawConfigError)
  return error as TheoClawConfigError
}

/** Removes every scratch directory made since the last call. */
export function cleanScratch(): void {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
}
