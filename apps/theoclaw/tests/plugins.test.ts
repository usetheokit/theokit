import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { installPlugin } from '../src/plugins/install.js'
import { parsePluginManifest } from '../src/plugins/manifest.js'
import { defineTheoClawPlugin } from '../src/plugins/sdk.js'

const MANIFEST = '---\nname: hello-plugin\nversion: 1.0.0\nentry: index.mjs\n---\nA plugin.\n'

function plugin(manifest = MANIFEST): string {
  const dir = mkdtempSync(join(tmpdir(), 'tc-plugin-src-'))
  writeFileSync(join(dir, 'PLUGIN.md'), manifest)
  writeFileSync(join(dir, 'index.mjs'), 'export default {}\n')
  return dir
}

describe('plugin manifest', () => {
  it('reads name, version and entry', () => {
    expect(parsePluginManifest(MANIFEST)).toEqual({ name: 'hello-plugin', version: '1.0.0', entry: 'index.mjs' })
  })
  it.each([
    ['no frontmatter', 'hello'],
    ['a bad name', '---\nname: ../x\nentry: a.mjs\n---\n'],
    ['no entry', '---\nname: a\n---\n'],
    ['an escaping entry', '---\nname: a\nentry: ../a.mjs\n---\n'],
    ['an absolute entry', '---\nname: a\nentry: /etc/a.mjs\n---\n'],
  ])('refuses %s', (_label, text) => {
    expect(() => parsePluginManifest(text)).toThrow()
  })
})

describe('plugin install', () => {
  it('copies the folder into the workspace and trusts its realpath', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'tc-plugin-ws-'))
    const trustFile = join(mkdtempSync(join(tmpdir(), 'tc-plugin-trust-')), 'trusted.json')
    writeFileSync(trustFile, 'not json')
    const manifest = await installPlugin({ source: plugin(), workspace, trustFile })
    expect(manifest.name).toBe('hello-plugin')
    const folder = join(workspace, '.theokit', 'plugins', 'hello-plugin')
    expect(readFileSync(join(folder, 'index.mjs'), 'utf8')).toContain('export default')
    const trusted = JSON.parse(readFileSync(trustFile, 'utf8')) as string[]
    expect(trusted).toHaveLength(1)
    expect(trusted[0]?.endsWith('hello-plugin')).toBe(true)
    await installPlugin({ source: plugin(), workspace, trustFile })
    expect(JSON.parse(readFileSync(trustFile, 'utf8'))).toHaveLength(1)
  })
  it('refuses a plugin whose entry is missing', async () => {
    const source = plugin()
    const workspace = mkdtempSync(join(tmpdir(), 'tc-plugin-ws-'))
    mkdirSync(join(workspace, 'x'))
    await expect(installPlugin({ source, workspace, trustFile: join(workspace, 't.json') })).resolves.toBeDefined()
    const bare = mkdtempSync(join(tmpdir(), 'tc-plugin-bare-'))
    writeFileSync(join(bare, 'PLUGIN.md'), MANIFEST)
    await expect(installPlugin({ source: bare, workspace, trustFile: join(workspace, 't.json') })).rejects.toThrow(/entry/)
  })
})

describe('plugin sdk and agent wiring', () => {
  it('registers every tool through the SDK plugin', async () => {
    const registered: string[] = []
    const p = defineTheoClawPlugin({ name: 'p', tools: [{ name: 'a' }, { name: 'b' }] as never })
    if (p.kind !== 'general') throw new Error('kind')
    await p.register({ registerTool: (t: { name: string }) => registered.push(t.name) } as never)
    expect(registered).toEqual(['a', 'b'])
  })
  it('loads plugin folders only for an agent given a plugin workspace', () => {
    const base = { model: 'm', apiKey: 'k' }
    expect(theoClawAgentOptions(base).local).not.toHaveProperty('settingSources')
    const local = theoClawAgentOptions({ ...base, pluginWorkspace: '/w' }).local
    expect(local.settingSources).toEqual(['plugins'])
    expect(local.cwd).toBe('/w')
  })
})
