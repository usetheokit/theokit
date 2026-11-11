import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createSkillsRegistryHandler } from '../src/skills/registry-server.js'

const servers: Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

async function start(dir: string): Promise<string> {
  const server = createServer(createSkillsRegistryHandler({ dir, token: 'secret' }))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function pkg(
  name: string,
  version = '1.0.0',
  extra: { path: string }[] = [],
  skill?: string,
): string {
  const md = skill ?? `---\nname: ${name}\ndescription: Summarize long text\n---\nBody`
  const b64 = (s: string): string => Buffer.from(s).toString('base64')
  return JSON.stringify({
    name,
    version,
    description: 'Summarize long text',
    files: [
      { path: 'SKILL.md', contentBase64: b64(md) },
      ...extra.map((e) => ({ path: e.path, contentBase64: b64('x') })),
    ],
  })
}

const put = (
  base: string,
  name: string,
  version: string,
  body: string,
  token: string | null = 'secret',
): Promise<Response> =>
  fetch(`${base}/v1/skills/${name}/${version}`, {
    method: 'PUT',
    body,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })

describe('skills registry server', () => {
  it('publishes, serves byte-identical packages, lists, searches, survives restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-'))
    const base = await start(dir)
    const body = pkg('summarize')
    expect((await put(base, 'summarize', '1.0.0', body)).status).toBe(201)
    expect(
      (await put(base, 'other', '1.0.0', pkg('other').replace('Summarize', 'Unrelated'))).status,
    ).toBe(201)
    const info = (await (await fetch(`${base}/v1/skills/summarize`)).json()) as {
      versions: { sha256: string }[]
    }
    const bytes = Buffer.from(
      await (await fetch(`${base}/v1/skills/summarize/1.0.0/package`)).arrayBuffer(),
    )
    expect(bytes.toString()).toBe(body)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(info.versions[0]?.sha256)
    const found = (await (await fetch(`${base}/v1/skills?q=SUMMAR`)).json()) as {
      skills: { name: string; latest: string }[]
    }
    expect(found.skills.map((s) => s.name)).toEqual(['summarize'])
    expect(found.skills[0]?.latest).toBe('1.0.0')
    expect(
      ((await (await fetch(`${base}/v1/skills`)).json()) as { skills: unknown[] }).skills,
    ).toHaveLength(2)
    expect((await fetch(`${base}/v1/skills/nope`)).status).toBe(404)
    const base2 = await start(dir)
    expect(await (await fetch(`${base2}/v1/skills/summarize/1.0.0/package`)).text()).toBe(body)
  })

  it('keeps versions immutable and demands the token', async () => {
    const base = await start(mkdtempSync(join(tmpdir(), 'reg-')))
    expect((await put(base, 'summarize', '1.0.0', pkg('summarize'))).status).toBe(201)
    expect(
      (await put(base, 'summarize', '1.0.0', pkg('summarize').replace('Body', 'Other'))).status,
    ).toBe(409)
    expect(await (await fetch(`${base}/v1/skills/summarize/1.0.0/package`)).text()).toBe(
      pkg('summarize'),
    )
    expect((await put(base, 'summarize', '1.0.1', pkg('summarize', '1.0.1'), null)).status).toBe(
      401,
    )
    expect((await put(base, 'summarize', '1.0.1', pkg('summarize', '1.0.1'), 'wrong')).status).toBe(
      401,
    )
    expect((await fetch(`${base}/v1/skills/summarize/1.0.1/package`)).status).toBe(404)
  })

  it('rejects invalid packages with 400', async () => {
    const base = await start(mkdtempSync(join(tmpdir(), 'reg-')))
    expect(
      (await put(base, 'summarize', '1.0.0', pkg('summarize', '1.0.0', [{ path: '../x' }]))).status,
    ).toBe(400)
    expect(
      (await put(base, 'summarize', '1.0.0', pkg('summarize', '1.0.0', [{ path: '/x' }]))).status,
    ).toBe(400)
    expect(
      (await put(base, 'summarize', '1.0.0', pkg('summarize', '1.0.0', [{ path: 'a\\b' }]))).status,
    ).toBe(400)
    const noSkill = JSON.stringify({
      name: 'summarize',
      version: '1.0.0',
      description: 'd',
      files: [],
    })
    expect((await put(base, 'summarize', '1.0.0', noSkill)).status).toBe(400)
    expect((await put(base, 'Bad_Name', '1.0.0', pkg('Bad_Name'))).status).toBe(400)
    expect((await put(base, 'summarize', '1.0', pkg('summarize', '1.0'))).status).toBe(400)
    expect(
      (
        await put(
          base,
          'summarize',
          '1.0.0',
          pkg('summarize', '1.0.0', [], '---\nname: other\ndescription: d\n---\n'),
        )
      ).status,
    ).toBe(400)
    expect((await put(base, 'summarize', '1.0.0', 'x'.repeat(1024 * 1024 + 1))).status).toBe(400)
  })
})
