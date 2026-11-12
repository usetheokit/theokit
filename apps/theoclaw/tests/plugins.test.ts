import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { advertisedTools, startModelStub } from './model-stub.js'
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
    const bare = mkdtempSync(join(tmpdir(), 'tc-plugin-bare-'))
    writeFileSync(join(bare, 'PLUGIN.md'), MANIFEST)
    const workspace = mkdtempSync(join(tmpdir(), 'tc-plugin-ws-'))
    await expect(installPlugin({ source: bare, workspace, trustFile: join(workspace, 't.json') })).rejects.toThrow(/entry/)
  })
  it('refuses an entry that is a symlink out of the plugin folder', async () => {
    const source = plugin()
    const outside = join(mkdtempSync(join(tmpdir(), 'tc-plugin-out-')), 'evil.mjs')
    writeFileSync(outside, 'export default {}\n')
    rmSync(join(source, 'index.mjs'))
    symlinkSync(outside, join(source, 'index.mjs'))
    const workspace = mkdtempSync(join(tmpdir(), 'tc-plugin-ws-'))
    await expect(installPlugin({ source, workspace, trustFile: join(workspace, 't.json') })).rejects.toThrow(/entry/)
  })
  it('refuses an entry that is a directory', async () => {
    const source = plugin()
    rmSync(join(source, 'index.mjs'))
    mkdirSync(join(source, 'index.mjs'))
    const workspace = mkdtempSync(join(tmpdir(), 'tc-plugin-ws-'))
    await expect(installPlugin({ source, workspace, trustFile: join(workspace, 't.json') })).rejects.toThrow(/entry/)
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
  afterEach(() => vi.unstubAllEnvs())
  it('an installed plugin adds its tool to a real SDK agent (offline, no model call)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tc-plugin-home-'))
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    const source = mkdtempSync(join(tmpdir(), 'tc-plugin-src-'))
    writeFileSync(join(source, 'PLUGIN.md'), MANIFEST)
    writeFileSync(
      join(source, 'index.mjs'),
      `export default { kind: 'general', name: 'hello-plugin', version: '1.0.0', register(ctx) { ctx.registerTool({ name: 'hello_plugin_tool', description: 'says hello', inputSchema: { type: 'object', properties: {} }, handler: async () => 'plugin-says-hello' }) } }\n`,
    )
    const workspace = mkdtempSync(join(tmpdir(), 'tc-plugin-ws-'))
    await installPlugin({ source, workspace, trustFile: join(home, '.theokit', 'plugins', 'trusted-workspace-plugins.json') })
    const stub = await startModelStub([{ toolCalls: [{ name: 'hello_plugin_tool', args: {} }] }, { text: 'done' }])
    const options = theoClawAgentOptions({ model: { id: 'stub/m', url: stub.url }, apiKey: 'sk-or-0123456789abcdef', pluginWorkspace: workspace })
    const agent = await createTheoClawAgent(options)
    try {
      const run = await agent.send('say hello')
      const result = await run.wait()
      expect(result.status).toBe('finished')
      expect(advertisedTools(stub.requests[0])).toContain('hello_plugin_tool')
      // The second request carries the tool's result, so the agent ran the plugin's tool.
      expect(JSON.stringify(stub.requests[1])).toContain('plugin-says-hello')
      expect(stub.requests.length).toBeGreaterThanOrEqual(2)
    } finally {
      await agent[Symbol.asyncDispose]()
      await stub.close()
    }
  })
})
