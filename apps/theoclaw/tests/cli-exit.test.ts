import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Runs the real CLI entry point; the reader starts late, so the pipe's buffer fills first. */
function runCli(args: string[], home: string): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cli, ...args], {
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.pause()
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    setTimeout(() => child.stdout.resume(), 1500)
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({ code, out: Buffer.concat(out).toString(), err: Buffer.concat(err).toString() }),
    )
  })
}

describe('the theoclaw command line', () => {
  it('delivers all of a large output through a pipe, then exits 0', async () => {
    const home = mkdtempSync(join(tmpdir(), 'theoclaw-cli-exit-'))
    dirs.push(home)
    const file = join(home, 'big.log')
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`)
    lines.push('the last line')
    writeFileSync(file, `${lines.join('\n')}\n`)
    const result = await runCli(['logs', '--lines', '100000', '--file', file], home)
    expect(result.code).toBe(0)
    expect(result.out.length).toBeGreaterThan(1_000_000)
    expect(result.out.trimEnd().split('\n').at(-1)).toBe('the last line')
  }, 60_000)

  it('keeps the message and a nonzero exit code of a failing command', async () => {
    const home = mkdtempSync(join(tmpdir(), 'theoclaw-cli-exit-'))
    dirs.push(home)
    const result = await runCli(['logs', '--lines', '0'], home)
    expect(result.code).not.toBe(0)
    expect(result.err).toContain('theoclaw logs: expected')
  }, 60_000)
})
