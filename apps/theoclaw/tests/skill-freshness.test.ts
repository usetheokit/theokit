import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { Agent, type SDKAgent } from '@theokit/sdk'
import { theoClawAgentOptions, withSdkSkills } from '../src/agent/create-agent.js'
import { startModelStub, type ModelStub } from './model-stub.js'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function skill(root: string, name: string, body: string, extra = ''): void {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: About ${name}.\n${extra}---\n${body}\n`)
}

/** Everything the model was sent in one request, as text. */
function requestText(stub: ModelStub, index: number): string {
  return JSON.stringify(stub.requests[index])
}

async function open(replies: Parameters<typeof startModelStub>[0], seed?: (skillsDir: string) => void): Promise<{ stub: ModelStub; skills: string; agent: SDKAgent }> {
  const stub = await startModelStub(replies)
  cleanups.push(() => stub.close())
  const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-fresh-'))
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }))
  const skills = join(workspace, 'skills')
  seed?.(skills)
  const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir: skills })
  const agent = await Agent.create(withSdkSkills(options) as never)
  cleanups.push(() => agent[Symbol.asyncDispose]())
  return { stub, skills, agent }
}

async function turn(agent: SDKAgent, text: string): Promise<void> {
  const run = await agent.send(text)
  await run.wait()
}

it('offers a skill added after turn 1 on turn 2 of the same agent, keeping history', async () => {
  const { stub, skills, agent } = await open([{ text: 'one' }, { toolCalls: [{ name: 'skill_read', args: { name: 'summarize' } }] }, { text: 'done' }])
  await turn(agent, 'first turn marker')
  expect(requestText(stub, 0)).not.toContain('About summarize.')
  skill(skills, 'summarize', 'BODY-SUMMARIZE-1')
  skill(skills, 'needs-missing', 'x', 'requires: no-such-binary-xyz\n')
  await turn(agent, 'second turn')
  const second = requestText(stub, 1)
  expect(second).toContain('About summarize.')
  expect(second).not.toContain('needs-missing')
  expect(second).toContain('first turn marker')
  expect(requestText(stub, 2)).toContain('BODY-SUMMARIZE-1')
})

it('drops a skill whose folder is removed on the next turn', async () => {
  const { stub, skills, agent } = await open([{ text: 'one' }, { text: 'two' }], (dir) => skill(dir, 'summarize', 'BODY'))
  await turn(agent, 'a')
  expect(requestText(stub, 0)).toContain('About summarize.')
  rmSync(join(skills, 'summarize'), { recursive: true })
  await turn(agent, 'b')
  expect(requestText(stub, 1)).not.toContain('About summarize.')
})

it('does the same for a chat session resolved by getOrCreate with the same id', async () => {
  const stub = await startModelStub([{ text: 'one' }, { text: 'two' }])
  cleanups.push(() => stub.close())
  const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-fresh-'))
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }))
  const options = withSdkSkills(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', skillsDir: join(workspace, 'skills') }))
  const agent = await Agent.getOrCreate('fresh-session', options as never)
  cleanups.push(() => agent[Symbol.asyncDispose]())
  await turn(agent, 'one')
  skill(join(workspace, 'skills'), 'summarize', 'BODY')
  await turn(agent, 'two')
  expect(requestText(stub, 0)).not.toContain('About summarize.')
  expect(requestText(stub, 1)).toContain('About summarize.')
})
