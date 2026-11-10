import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

describe('.env.example THEOCLAW_BROADCAST_GROUPS', () => {
  it('documents the value double-quoted so the shell loader keeps every group', () => {
    const line = readFileSync(join(root, '.env.example'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('THEOCLAW_BROADCAST_GROUPS='))!
    expect(line).toMatch(/^THEOCLAW_BROADCAST_GROUPS="/)
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toMatch(/Double-quote the value/)
    const value = 'a=telegram:1,discord:2;b=slack:C3,matrix:!r:example.org'
    const out = execFileSync(
      'bash',
      [
        '-c',
        `set -a; ${line.replace(/"" #.*$/, `"${value}"`)}; set +a; printf %s "$THEOCLAW_BROADCAST_GROUPS"`,
      ],
      { encoding: 'utf8' },
    )
    expect(out).toBe(value)
  })
})
