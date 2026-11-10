import { describe, expect, it } from 'vitest'

import { NodeAcpTransport } from '../../src/server/agent/acp-tool.js'

/** B-681: `env` is the agent's whole environment, and its stderr goes to the caller's sink. */
const SCRIPT =
  'process.stdout.write(JSON.stringify(Object.keys(process.env).sort())+"\\n");process.stderr.write("oops")'

function run(env?: Record<string, string>, onStderr?: (c: string) => void) {
  return new Promise<{ out: string; err: string }>((resolve, reject) => {
    let err = ''
    const t = new NodeAcpTransport(
      process.execPath,
      ['-e', SCRIPT],
      undefined,
      env,
      onStderr === undefined
        ? undefined
        : (c) => {
            err += c
            onStderr(c)
          },
    )
    let out = ''
    t.subscribe((c) => {
      out += c
    })
    t.onClose(() => {
      // Let the pipes drain: onClose fires on process 'close'.
      void t.close().then(() => resolve({ out, err }), reject)
    })
  })
}

describe('createACPTool env and stderr', () => {
  it('gives the agent exactly the env option, none of the parent variables', async () => {
    process.env.THEOKIT_B681_SECRET = 'token'
    try {
      const { out } = await run({ ONLY_THIS: '1' })
      const keys = JSON.parse(out) as string[]
      expect(keys).toContain('ONLY_THIS')
      expect(keys).not.toContain('THEOKIT_B681_SECRET')
      expect(keys).not.toContain('PATH')
    } finally {
      delete process.env.THEOKIT_B681_SECRET
    }
  })

  it('inherits the parent env when no env option is given', async () => {
    process.env.THEOKIT_B681_SECRET = 'token'
    try {
      const { out } = await run()
      expect(JSON.parse(out) as string[]).toContain('THEOKIT_B681_SECRET')
    } finally {
      delete process.env.THEOKIT_B681_SECRET
    }
  })

  it("sends the agent's stderr to the caller's sink, not the parent's stderr", async () => {
    const parent: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((c: string | Uint8Array) => {
      parent.push(String(c))
      return true
    }) as typeof process.stderr.write
    try {
      const { err } = await run({}, () => undefined)
      expect(err).toBe('oops')
      expect(parent.join('')).not.toContain('oops')
    } finally {
      process.stderr.write = orig
    }
  })
})
