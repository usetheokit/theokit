import { describe, expect, it } from 'vitest'

import { createACPTool } from '../../src/server/agent/acp-tool.js'

/** B-681: `env` is the agent's whole environment, and `stderr` replaces the parent's stderr. */
const SCRIPT = `
process.stderr.write(JSON.stringify({ secret: process.env.B681_PARENT_SECRET ?? null, mine: process.env.B681_MINE ?? null }))
setTimeout(() => process.exit(0), 20)
`

async function run(extra: { env?: Record<string, string> }): Promise<string> {
  const chunks: string[] = []
  const tool = createACPTool({
    command: process.execPath,
    args: ['-e', SCRIPT],
    name: 'code_agent',
    description: 'A coding agent',
    onPermissionRequest: () => ({ granted: false }),
    timeoutMs: 5_000,
    stderr: (c) => chunks.push(c),
    ...extra,
  })
  await (tool.handler as (a: { message: string }, c?: unknown) => Promise<unknown>)(
    { message: 'hi' },
    {},
  ).catch(() => undefined)
  return chunks.join('')
}

describe('createACPTool env and stderr', () => {
  it('gives the agent only the env option, and sends its stderr to the sink', async () => {
    process.env.B681_PARENT_SECRET = 'token'
    try {
      const seen = JSON.parse(await run({ env: { B681_MINE: 'x', PATH: process.env.PATH ?? '' } }))
      expect(seen).toEqual({ secret: null, mine: 'x' })
      const inherited = JSON.parse(/\{.*?\}/.exec(await run({}))?.[0] ?? '{}')
      expect(inherited.secret).toBe('token')
    } finally {
      delete process.env.B681_PARENT_SECRET
    }
  })
})
