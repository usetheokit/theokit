import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
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

it('publish, search and install through the CLI make the skill usable on the open session next turn', async () => {
  const server: Server = createServer(createSkillsRegistryHandler({ dir: scratchDir(), token: 'tok' }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  cleanups.push(() => void server.close())
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const src = scratchDir()
  writeFileSync(join(src, 'SKILL.md'), '---\nname: summarize\ndescription: Summarize long text.\nversion: 1.0.0\n---\nBODY-E2E\n')
  const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-e2e-'))
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }))
  const cli = async (args: string[]) => {
    const h = harness()
    const env = { ...h.io.env, THEOCLAW_SKILLS_REGISTRY: base, THEOCLAW_SKILLS_TOKEN: 'tok', THEOCLAW_WORKSPACE: workspace }
    const code = await runCli(args, { ...h.io, env })
    return { code, out: h.stdout(), err: h.stderr() }
  }

  const stub = await startModelStub([{ text: 'one' }, { text: 'two' }])
  cleanups.push(() => stub.close())
  const skills = join(workspace, 'skills')
  mkdirSync(skills, { recursive: true })
  const agent = await Agent.create(
    withSdkSkills(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir: skills })) as never,
  )
  cleanups.push(() => agent[Symbol.asyncDispose]())
  await (await agent.send('first')).wait()
  expect(JSON.stringify(stub.requests[0])).not.toContain('Summarize long text.')

  expect(await cli(['skills', 'publish', src])).toMatchObject({ code: 0 })
  const found = await cli(['skills', 'search', 'summarize'])
  expect(found.code).toBe(0)
  expect(found.out).toContain('summarize')
  expect(await cli(['skills', 'install', 'summarize'])).toMatchObject({ code: 0 })

  await (await agent.send('second')).wait()
  expect(JSON.stringify(stub.requests[1])).toContain('Summarize long text.')
})
