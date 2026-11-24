import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { exitAfterFlush } from '@theokit/agents/commands'

describe('exitAfterFlush', () => {
  it('exits only after every stream has handed its pending output to the system', async () => {
    const order: string[] = []
    const stream = (name: string) => ({
      write: (_chunk: string, done: () => void) => {
        setTimeout(() => {
          order.push(`${name} flushed`)
          done()
        }, 5)
        return false
      },
    })
    await exitAfterFlush(3, {
      streams: [stream('stdout'), stream('stderr')],
      exit: (code) => order.push(`exit ${code}`),
    })
    expect(order).toEqual(['stdout flushed', 'stderr flushed', 'exit 3'])
  })

  it('keeps all of a large output that is followed at once by the exit, through a pipe', () => {
    // `theoclaw update` prints install.sh's output (over 64 KiB) and then `updated ...`; a bare
    // process.exit dropped everything past the pipe's buffer, and with it that last line.
    const module = import.meta.resolve('@theokit/agents/commands')
    const script = `import { exitAfterFlush } from ${JSON.stringify(module)}; process.stdout.write('x'.repeat(300_000) + '\\nupdated a -> b\\n'); void exitAfterFlush(0)`
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout.length).toBe(300_000 + '\nupdated a -> b\n'.length)
    expect(child.stdout).toMatch(/^updated a -> b$/m)
  })
})
