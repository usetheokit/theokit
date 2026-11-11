import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { SkillRegistry } from '../src/skills/registry.js'
import { harness, scratchDir } from './support/cli-harness.js'

let server: Server | undefined
afterEach(() => server?.close())

interface Pkg {
  name: string
  version: string
  files: { path: string; contentBase64: string }[]
}
const b64 = (s: string) => Buffer.from(s).toString('base64')
function pkg(version: string, extra: { path: string; contentBase64: string }[] = [], name = 'summarize'): Pkg {
  return {
    name,
    version,
    files: [{ path: 'SKILL.md', contentBase64: b64(`---\nname: ${name}\ndescription: v${version}\n---\nBody ${version}\n`) }, ...extra],
  }
}

async function serve(packages: Pkg[], lie = false) {
  const bytes = new Map(packages.map((p) => [p.version, Buffer.from(JSON.stringify(p))]))
  server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/v1/skills/summarize') {
      res.end(
        JSON.stringify({
          name: 'summarize',
          description: 'd',
          versions: [...bytes].map(([version, b]) => ({
            version,
            size: b.length,
            sha256: lie ? '0'.repeat(64) : createHash('sha256').update(b).digest('hex'),
          })),
        }),
      )
      return
    }
    const m = /^\/v1\/skills\/summarize\/([^/]+)\/package$/.exec(url)
    const b = m ? bytes.get(m[1]!) : undefined
    if (b) res.end(b)
    else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

async function install(base: string, ws: string | undefined, ref = 'summarize') {
  const h = harness()
  const env = { ...h.io.env, THEOCLAW_SKILLS_REGISTRY: base, ...(ws ? { THEOCLAW_WORKSPACE: ws } : {}) }
  const code = await runCli(['skills', 'install', ref], { ...h.io, env })
  return { code, out: h.stdout(), err: h.stderr() }
}

describe('theoclaw skills install', () => {
  it('installs the highest version, usable by the registry, with .origin.json', async () => {
    const base = await serve([pkg('1.2.0'), pkg('1.10.0'), pkg('1.9.0')])
    const ws = scratchDir()
    const r = await install(base, ws)
    expect(r.code).toBe(0)
    expect(r.out).toBe(`Installed summarize@1.10.0 -> ${join(ws, 'skills', 'summarize')}\n`)
    expect(new SkillRegistry({ workspaceDir: join(ws, 'skills') }).resolve('summarize')).toBeDefined()
    const origin = JSON.parse(readFileSync(join(ws, 'skills', 'summarize', '.origin.json'), 'utf8')) as Record<string, string>
    expect(origin).toMatchObject({ name: 'summarize', version: '1.10.0', registry: base })
    expect(origin.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('installs a named version and replaces an older install', async () => {
    const base = await serve([pkg('1.0.0'), pkg('2.0.0')])
    const ws = scratchDir()
    expect((await install(base, ws, 'summarize@1.0.0')).code).toBe(0)
    expect(readFileSync(join(ws, 'skills', 'summarize', 'SKILL.md'), 'utf8')).toContain('Body 1.0.0')
    expect((await install(base, ws)).code).toBe(0)
    expect(readFileSync(join(ws, 'skills', 'summarize', 'SKILL.md'), 'utf8')).toContain('Body 2.0.0')
    expect(readdirSync(join(ws, 'skills'))).toEqual(['summarize'])
  })
  it('refuses a digest mismatch and writes nothing', async () => {
    const ws = scratchDir()
    const r = await install(await serve([pkg('1.0.0')], true), ws)
    expect(r.code).toBe(1)
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
  })
  it('a failed reinstall keeps the old version', async () => {
    const ws = scratchDir()
    expect((await install(await serve([pkg('1.0.0')]), ws)).code).toBe(0)
    server?.close()
    const bad = pkg('2.0.0', [{ path: '../evil', contentBase64: b64('x') }])
    const r = await install(await serve([bad]), ws)
    expect(r.code).toBe(1)
    expect(existsSync(join(ws, 'evil'))).toBe(false)
    expect(existsSync(join(ws, 'skills', 'evil'))).toBe(false)
    expect(readFileSync(join(ws, 'skills', 'summarize', 'SKILL.md'), 'utf8')).toContain('Body 1.0.0')
    expect(readdirSync(join(ws, 'skills'))).toEqual(['summarize'])
  })
  it.each(['/abs', 'a\\b', 'a/../../b'])('rejects path %s', async (path) => {
    const ws = scratchDir()
    const r = await install(await serve([pkg('1.0.0', [{ path, contentBase64: b64('x') }])]), ws)
    expect(r.code).toBe(1)
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
  })
  it('rejects a SKILL.md whose name differs', async () => {
    const p = pkg('1.0.0')
    p.files[0] = { path: 'SKILL.md', contentBase64: b64('---\nname: other\ndescription: x\n---\n') }
    const ws = scratchDir()
    expect((await install(await serve([p]), ws)).code).toBe(1)
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
  })
  it('rejects an oversized package', async () => {
    const ws = scratchDir()
    const big = pkg('1.0.0', [{ path: 'big.bin', contentBase64: Buffer.alloc(1024 * 1024 + 1).toString('base64') }])
    expect((await install(await serve([big]), ws)).code).toBe(1)
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
  })
  it('unknown name or version exits 1 with one line', async () => {
    const base = await serve([pkg('1.0.0')])
    const ws = scratchDir()
    for (const ref of ['summarize@9.9.9', 'nothere']) {
      const r = await install(base, ws, ref)
      expect(r.code).toBe(1)
      expect(r.err.trim().split('\n')).toHaveLength(1)
    }
  })
  it('needs THEOCLAW_WORKSPACE', async () => {
    const r = await install(await serve([pkg('1.0.0')]), undefined)
    expect(r.code).toBe(1)
    expect(r.err).toContain('THEOCLAW_WORKSPACE')
  })
  it('usage error on unknown verb', async () => {
    const h = harness()
    expect(await runCli(['skills', 'frob', 'x'], h.io)).toBe(2)
  })
})
