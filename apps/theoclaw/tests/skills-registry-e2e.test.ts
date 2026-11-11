import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { Agent } from '@theokit/sdk'
import { theoClawAgentOptions, withSdkSkills } from '../src/agent/create-agent.js'
import { runCli } from '../src/cli.js'
import { createSkillsRegistryHandler } from '../src/skills/registry-server.js'
import { harness, scratchDir } from './support/cli-harness.js'
import { startModelStub } from './model-stub.js'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function cli(args: string[], env: Record<string, string>) {
  const h = harness()
  const code = await runCli(args, { ...h.io, env: { ...h.io.env, ...env } })
  return { code, out: h.stdout(), err: h.stderr() }
}

it('publish, search and install through the CLI make the skill usable on the next turn of an open session', async () => {
  const registryDir = mkdtempSync(join(tmpdir(), 'theoclaw-reg-'))
  const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-ws-'))
  cleanups.push(() => rmSync(registryDir, { recursive: true, force: true }), () => rmSync(workspace, { recursive: true, force: true }))
  const server: Server = createServer(createSkillsRegistryHandler({ dir: registryDir, token: 'secret' }))
  cleanups.push(() => void server.close())
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const src = scratchDir()
  mkdirSync(join(src, 'summarize'))
  writeFileSync(join(src, 'summarize', 'SKILL.md'), '---\nname: summarize\ndescription: Summarize long text\nversion: 1.0.0\n---\nBODY-FROM-REGISTRY\n')

  const stub = await startModelStub([{ text: 'one' }, { toolCalls: [{ name: 'skill_read', args: { name: 'summarize' } }] }, { text: 'done' }])
  cleanups.push(() => stub.close())
  const skillsDir = join(workspace, 'skills')
  const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir })
  const agent = await Agent.create(withSdkSkills(options) as never)
  cleanups.push(() => agent[Symbol.asyncDispose]())
  await (await agent.send('first turn')).wait()
  expect(JSON.stringify(stub.requests[0])).not.toContain('Summarize long text')

  const env = { THEOCLAW_SKILLS_REGISTRY: base, THEOCLAW_SKILLS_TOKEN: 'secret', THEOCLAW_WORKSPACE: workspace }
  expect((await cli(['skills', 'publish', join(src, 'summarize')], env)).code).toBe(0)
  const found = await cli(['skills', 'search', 'summarize'], env)
  expect(found.code).toBe(0)
  expect(found.out).toContain('summarize')
  expect((await cli(['skills', 'install', 'summarize'], env)).code).toBe(0)

  await (await agent.send('second turn')).wait()
  expect(JSON.stringify(stub.requests[1])).toContain('Summarize long text')
  expect(JSON.stringify(stub.requests[2])).toContain('BODY-FROM-REGISTRY')
})
