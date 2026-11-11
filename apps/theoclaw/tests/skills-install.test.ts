import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { SkillRegistry } from '../src/skills/registry.js'
import { harness, scratchDir } from './support/cli-harness.js'

let server: Server | undefined
afterEach(() => server?.close())

const md = (name: string) => `---\nname: ${name}\ndescription: Does ${name}\n---\nBody\n`
function pack(
  name: string,
  version: string,
  files?: { path: string; text: string }[],
  pkgName = name,
) {
  const list = files ?? [{ path: 'SKILL.md', text: md(name) }]
  return Buffer.from(
    JSON.stringify({
      name: pkgName,
      version,
      description: 'd',
      files: list.map((f) => ({
        path: f.path,
        contentBase64: Buffer.from(f.text).toString('base64'),
      })),
    }),
  )
}
interface Ver {
  version: string
  bytes: Buffer
  sha?: string
}
async function registry(name: string, versions: Ver[]) {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === `/v1/skills/${name}`) {
      res.end(
        JSON.stringify({
          name,
          description: 'd',
          versions: versions.map((v) => ({
            version: v.version,
            size: v.bytes.length,
            sha256: v.sha ?? createHash('sha256').update(v.bytes).digest('hex'),
          })),
        }),
      )
      return
    }
    const m = new RegExp(`^/v1/skills/${name}/([^/]+)/package$`).exec(url)
    const v = versions.find((x) => x.version === m?.[1])
    if (v === undefined) {
      res.statusCode = 404
      res.end('{}')
    } else res.end(v.bytes)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
async function run(args: string[], base: string, workspace: string | undefined) {
  const h = harness()
  const env = {
    ...h.io.env,
    THEOCLAW_SKILLS_REGISTRY: base,
    ...(workspace === undefined ? {} : { THEOCLAW_WORKSPACE: workspace }),
  }
  const code = await runCli(args, { ...h.io, env })
  return { code, out: h.stdout(), err: h.stderr() }
}

describe('theoclaw skills install', () => {
  it('installs the highest version and the skill resolves', async () => {
    const ws = scratchDir()
    const base = await registry('summarize', [
      { version: '1.0.0', bytes: pack('summarize', '1.0.0') },
      { version: '1.10.0', bytes: pack('summarize', '1.10.0') },
      { version: '1.9.0', bytes: pack('summarize', '1.9.0') },
    ])
    const r = await run(['skills', 'install', 'summarize'], base, ws)
    expect(r.code).toBe(0)
    expect(r.out).toBe(`Installed summarize@1.10.0 -> ${join(ws, 'skills', 'summarize')}\n`)
    expect(
      new SkillRegistry({ workspaceDir: join(ws, 'skills') }).resolve('summarize'),
    ).toBeDefined()
    const origin = JSON.parse(readFileSync(join(ws, 'skills/summarize/.origin.json'), 'utf8'))
    expect(origin).toMatchObject({ registry: base, name: 'summarize', version: '1.10.0' })
    expect(origin.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('installs a pinned version, and a newer one replaces it', async () => {
    const ws = scratchDir()
    const base = await registry('summarize', [
      { version: '1.0.0', bytes: pack('summarize', '1.0.0') },
      { version: '2.0.0', bytes: pack('summarize', '2.0.0') },
    ])
    expect((await run(['skills', 'install', 'summarize@1.0.0'], base, ws)).out).toContain(
      'summarize@1.0.0',
    )
    expect((await run(['skills', 'install', 'summarize'], base, ws)).code).toBe(0)
    const origin = JSON.parse(readFileSync(join(ws, 'skills/summarize/.origin.json'), 'utf8'))
    expect(origin.version).toBe('2.0.0')
    expect(readdirSync(join(ws, 'skills'))).toEqual(['summarize'])
  })
  it('refuses a digest mismatch and writes nothing', async () => {
    const ws = scratchDir()
    const base = await registry('summarize', [
      { version: '1.0.0', bytes: pack('summarize', '1.0.0'), sha: 'a'.repeat(64) },
    ])
    const r = await run(['skills', 'install', 'summarize'], base, ws)
    expect(r.code).toBe(1)
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
  })
  it('refuses unsafe paths', async () => {
    const ws = scratchDir()
    for (const path of ['../evil', '/abs', 'a\\b', 'a/../../b']) {
      const base = await registry('summarize', [
        {
          version: '1.0.0',
          bytes: pack('summarize', '1.0.0', [
            { path: 'SKILL.md', text: md('summarize') },
            { path, text: 'x' },
          ]),
        },
      ])
      expect((await run(['skills', 'install', 'summarize'], base, ws)).code).toBe(1)
      server?.close()
    }
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
    expect(existsSync(join(ws, 'evil'))).toBe(false)
  })
  it('refuses mismatched names and keeps the old install on a failed reinstall', async () => {
    const ws = scratchDir()
    let base = await registry('summarize', [
      { version: '1.0.0', bytes: pack('summarize', '1.0.0') },
    ])
    await run(['skills', 'install', 'summarize'], base, ws)
    server?.close()
    base = await registry('summarize', [
      {
        version: '2.0.0',
        bytes: pack('summarize', '2.0.0', [{ path: 'SKILL.md', text: md('other') }]),
      },
      { version: '3.0.0', bytes: pack('summarize', '3.0.0', undefined, 'other') },
    ])
    expect((await run(['skills', 'install', 'summarize@2.0.0'], base, ws)).code).toBe(1)
    expect((await run(['skills', 'install', 'summarize@3.0.0'], base, ws)).code).toBe(1)
    expect(
      JSON.parse(readFileSync(join(ws, 'skills/summarize/.origin.json'), 'utf8')).version,
    ).toBe('1.0.0')
    expect(readdirSync(join(ws, 'skills'))).toEqual(['summarize'])
  })
  it('fails in one line for an unknown name or version, and without a workspace', async () => {
    const ws = scratchDir()
    const base = await registry('summarize', [
      { version: '1.0.0', bytes: pack('summarize', '1.0.0') },
    ])
    for (const spec of ['nope', 'summarize@9.9.9']) {
      const r = await run(['skills', 'install', spec], base, ws)
      expect(r.code).toBe(1)
      expect(r.err.trim().split('\n')).toHaveLength(1)
    }
    const r = await run(['skills', 'install', 'summarize'], base, undefined)
    expect(r.code).toBe(1)
    expect(r.err).toContain('THEOCLAW_WORKSPACE')
  })
  it('refuses an oversized package', async () => {
    const ws = scratchDir()
    const base = await registry('summarize', [
      {
        version: '1.0.0',
        bytes: pack('summarize', '1.0.0', [
          { path: 'SKILL.md', text: md('summarize') },
          { path: 'big.txt', text: 'x'.repeat(1_100_000) },
        ]),
      },
    ])
    expect((await run(['skills', 'install', 'summarize'], base, ws)).code).toBe(1)
    expect(existsSync(join(ws, 'skills', 'summarize'))).toBe(false)
  })
})
