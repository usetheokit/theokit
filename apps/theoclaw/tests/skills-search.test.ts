import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { harness } from './support/cli-harness.js'

let server: Server | undefined
afterEach(() => server?.close())

async function registry(status: number, body: string) {
  server = createServer((req, res) => {
    res.statusCode = status
    res.end(req.url?.startsWith('/v1/skills?q=summarize') ? body : '{"skills":[]}')
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

async function run(args: string[], base?: string) {
  const h = harness()
  const env = { ...h.io.env, ...(base ? { THEOCLAW_SKILLS_REGISTRY: base } : {}) }
  const code = await runCli(args, { ...h.io, env })
  return { code, out: h.stdout(), err: h.stderr() }
}

describe('theoclaw skills search', () => {
  it('lists a matching skill', async () => {
    const base = await registry(
      200,
      '{"skills":[{"name":"summarize","description":"Summarize text","latest":"1.0.0","versions":["1.0.0"]}]}',
    )
    expect(await run(['skills', 'search', 'summarize'], base)).toMatchObject({
      code: 0,
      out: 'summarize  1.0.0  Summarize text\n',
    })
  })
  it('says so when nothing matches', async () => {
    const base = await registry(200, '{"skills":[]}')
    expect(await run(['skills', 'search', 'summarize'], base)).toMatchObject({
      code: 0,
      out: 'no skills found\n',
    })
  })
  it('names the variable when unset', async () => {
    const r = await run(['skills', 'search', 'x'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('THEOCLAW_SKILLS_REGISTRY')
  })
  it('uses exit 2 without a verb or with an unknown one', async () => {
    expect((await run(['skills'])).code).toBe(2)
    expect((await run(['skills', 'bogus'])).code).toBe(2)
  })
  it('fails with one line on 500 or invalid JSON', async () => {
    for (const [status, body] of [
      [500, '{}'],
      [200, 'nope'],
      [200, '{"skills":[{"name":1}]}'],
    ] as const) {
      const base = await registry(status, body)
      const r = await run(['skills', 'search', 'summarize'], base)
      expect(r.code).toBe(1)
      expect(r.err.trim().split('\n')).toHaveLength(1)
      server?.close()
    }
  })
  it('lists the verb in --help', async () => {
    expect((await run(['--help'])).out).toContain('skills search')
  })
})
