import { createServer, type Server } from 'node:http'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { harness, scratchDir } from './support/cli-harness.js'

const TOKEN = 'tok-secret-123'
let server: Server | undefined
afterEach(() => server?.close())

async function registry(status: number) {
  const seen: { method?: string; url?: string; auth?: string; body?: { files: { path: string; contentBase64: string }[] } }[] = []
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) as never })
      res.statusCode = status
      res.end('{}')
    })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  return { seen, base: `http://127.0.0.1:${addr.port}` }
}

function skill(frontmatter = 'name: demo\ndescription: A demo\nversion: 1.2.3') {
  const dir = scratchDir()
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\nBody\n`)
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'data.bin'), Buffer.from([0, 255, 1, 2]))
  return dir
}

async function run(dir: string, base: string | undefined, token: string | null = TOKEN) {
  const h = harness()
  const env = { ...h.io.env, ...(base ? { THEOCLAW_SKILLS_REGISTRY: base } : {}), ...(token ? { THEOCLAW_SKILLS_TOKEN: token } : {}) }
  const code = await runCli(['skills', 'publish', dir], { ...h.io, env })
  return { code, out: h.stdout(), err: h.stderr() }
}

describe('theoclaw skills publish', () => {
  it('publishes byte-identical files', async () => {
    const { seen, base } = await registry(201)
    const r = await run(skill(), base)
    expect(r).toMatchObject({ code: 0, out: 'Published demo@1.2.3\n' })
    expect(seen[0]).toMatchObject({ method: 'PUT', url: '/v1/skills/demo/1.2.3', auth: `Bearer ${TOKEN}` })
    const bin = seen[0]!.body!.files.find((f) => f.path === 'sub/data.bin')
    expect(Buffer.from(bin!.contentBase64, 'base64')).toEqual(Buffer.from([0, 255, 1, 2]))
  })
  it('409 and 401', async () => {
    const a = await registry(409)
    expect(await run(skill(), a.base)).toMatchObject({ code: 1 })
    expect((await run(skill(), a.base)).err).toContain('demo@1.2.3 already exists')
    server?.close()
    const b = await registry(401)
    const r = await run(skill(), b.base)
    expect(r.code).toBe(1)
    expect(r.err + r.out).not.toContain(TOKEN)
  })
  it('refuses bad folders before any request', async () => {
    const { seen, base } = await registry(201)
    const empty = scratchDir()
    const noVersion = skill('name: demo\ndescription: A demo')
    const linked = skill()
    symlinkSync('/etc/hostname', join(linked, 'link'))
    for (const dir of [empty, noVersion, linked]) expect((await run(dir, base)).code).toBe(1)
    expect(seen).toHaveLength(0)
  })
  it('refuses a registry that is not http or https', async () => {
    const r = await run(skill(), 'file:///etc/passwd', TOKEN)
    expect(r.code).toBe(1)
    expect(r.err).toContain('http:// or https://')
  })
  it('names a missing variable', async () => {
    expect((await run(skill(), 'http://127.0.0.1:1', null)).err).toContain('THEOCLAW_SKILLS_TOKEN')
    expect((await run(skill(), undefined, TOKEN)).err).toContain('THEOCLAW_SKILLS_REGISTRY')
  })
})
