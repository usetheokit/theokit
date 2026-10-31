import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent } from '../../src/agent/create-agent.js'
import { createContainer } from '../../src/composition.js'
import { createAgentFactory, createChannelAgentFactory } from '../../src/control-plane/agent-factory.js'
import { agentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import { createWorkflowTools } from '../../src/workflows/workflow-tools.js'

/**
 * AC-004 (B-387, OC-66): the `digest` workflow on a real model, from a `/control` agent built the
 * way the start builds one: `createAgentFactory` with `agentToolOptions(settings, workflow tools)`,
 * the draft agents from `createChannelAgentFactory` over the real request boundary. It runs only with
 * THEOCLAW_LIVE=1. The text carries a token made at test time, but the token in the answer is not
 * proof on its own (the model could repeat the text): the `digest` tool-call event and the
 * `completed 2/2 steps` line are what tell a workflow run from the model answering alone.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function liveEnv(): Readonly<Record<string, string | undefined>> {
  if (!process.env.THEOCLAW_MODEL) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  return process.env
}

describe.skipIf(!LIVE)('the digest workflow against a real model', () => {
  it('a real model runs the two-step digest workflow for OC-66', { timeout: 120_000 }, async () => {
    const env = liveEnv()
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-workflows-live-'))
    cleanups.push(() => rmSync(workspace, { recursive: true, force: true }))
    const lines: string[] = []
    const drafts = createContainer({ factory: createChannelAgentFactory(env, createTheoClawAgent) })
    const workflowTools = createWorkflowTools({ withDraftAgent: drafts.withAgent, write: (line) => lines.push(line) })
    const settings = resolveToolSettings({}, workspace, { warn: () => undefined })
    const agent = await createAgentFactory(env, createTheoClawAgent)(agentToolOptions(settings, workflowTools))
    const token = `tok-${randomBytes(6).toString('hex')}`
    const text = [
      `The release code for this quarter is ${token}.`,
      'The team moved the build to a new runner, which halved its duration.',
      'Two flaky tests were fixed and one was deleted.',
    ].join(' ')
    const toolCalls: string[] = []
    let answer = ''
    try {
      const run = await agent.send(
        `Use the digest tool on the following text, then reply with the points it returned, one per line.\n\n${text}`,
      )
      for await (const event of run.stream()) {
        if (event.type === 'tool_call' && 'name' in event && 'status' in event && event.status === 'running') toolCalls.push(String(event.name))
      }
      const outcome = await run.wait()
      if (outcome.status !== 'finished') throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
      answer = String((outcome as { result?: unknown }).result ?? '')
    } finally {
      await (agent as unknown as AsyncDisposable)[Symbol.asyncDispose]()
    }
    // Named in every failure, so a model that never called the tool is told apart from a tool that failed.
    const seen = JSON.stringify({ toolCalls, lines, answer })
    expect(toolCalls, seen).toContain('digest')
    expect(lines, seen).toContainEqual(expect.stringMatching(/^theoclaw-workflow: digest wfr-\S+ completed 2\/2 steps$/))
    expect(answer, seen).toContain(token)
  })
})
