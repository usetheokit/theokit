import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import { agentToolOptions } from '../../src/tools/tool-registry.js'
import { checkHostToolsPosture, resolveToolSettings } from '../../src/tools/tool-settings.js'
import type { ToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'

/**
 * AC-005 (B-382): the tools on a real model, built through the path the process uses
 * (`agentToolOptions` and `createTheoClawAgent`). It runs only with THEOCLAW_LIVE=1, and with
 * THEOCLAW_HOST_TOOLS=on for the host-changing cases; without the flag it skips, so CI stays
 * offline. Each case writes a token made at test time, so an answer given without the tool cannot
 * hold it, and asserts the tool-call event names the tool. Only the web search case may skip, and
 * only for a missing BRAVE_API_KEY.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const HOST_TOOLS = process.env.THEOCLAW_HOST_TOOLS ?? ''

function liveModel(): { readonly model: string; readonly apiKey: string } {
  const model = process.env.THEOCLAW_MODEL
  const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!apiKey) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  return { model, apiKey }
}

const token = (): string => `tok-${randomBytes(6).toString('hex')}`

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A host-tools workspace, its tool settings resolved and checked as the start does. */
function liveSettings(prepare?: (toolRoot: string) => void): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  if (prepare !== undefined) {
    // The tool root exists before the settings read it, so a repository is seen as one.
    const root = join(workspace.path, 'files')
    mkdirSync(root, { mode: 0o700 })
    prepare(root)
  }
  const env = {
    THEOCLAW_HOST_TOOLS: HOST_TOOLS,
    BRAVE_API_KEY: process.env.BRAVE_API_KEY,
    THEOKIT_SEARCH_API_URL: process.env.THEOKIT_SEARCH_API_URL,
    THEOKIT_SEARCH_API_KEY: process.env.THEOKIT_SEARCH_API_KEY,
  }
  const settings = resolveToolSettings(env, workspace.path)
  // The state directory the start would protect, outside every root the shell can write.
  checkHostToolsPosture(settings, [{ path: join(workspace.path, 'state'), variable: 'THEOCLAW_STATE_DIR' }])
  return settings
}

interface Turn {
  readonly answer: string
  readonly toolCalls: string[]
}

/** One turn on a fresh agent; fails naming the status when the run does not finish. */
async function turn(settings: ToolSettings, prompt: string): Promise<Turn> {
  const { model, apiKey } = liveModel()
  const agent = await createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions: agentToolOptions(settings) }))
  try {
    const run = await agent.send(prompt)
    const toolCalls: string[] = []
    for await (const event of run.stream()) {
      if (event.type === 'tool_call' && 'name' in event && 'status' in event && event.status === 'running') toolCalls.push(String(event.name))
    }
    const outcome = await run.wait()
    if (outcome.status !== 'finished') throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
    return { answer: String((outcome as { result?: unknown }).result ?? ''), toolCalls }
  } finally {
    await agent[Symbol.asyncDispose]()
  }
}

function requireHostTools(): void {
  if (HOST_TOOLS !== 'on') throw new Error('this case needs THEOCLAW_HOST_TOOLS=on')
}

describe.skipIf(!LIVE)('the core tools against a real model', () => {
  it('a real model reads a file holding a token made at test time', { timeout: 120_000 }, async () => {
    const value = token()
    const settings = liveSettings()
    writeFileSync(join(settings.toolRoot, 'token.txt'), `${value}\n`)
    const result = await turn(settings, 'Use the read_file tool to read token.txt, then reply with its exact content and nothing else.')
    expect(result.toolCalls).toContain('read_file')
    expect(result.answer).toContain(value)
  })

  it('a real model runs a shell command over that file', { timeout: 120_000 }, async () => {
    requireHostTools()
    const value = token()
    const settings = liveSettings()
    writeFileSync(join(settings.toolRoot, 'token.txt'), value)
    const digest = createHash('sha256').update(value).digest('hex')
    const result = await turn(settings, 'Use the shell_exec tool to run `sha256sum token.txt`, then reply with the hexadecimal digest it printed and nothing else.')
    expect(result.toolCalls).toContain('shell_exec')
    expect(result.answer).toContain(digest)
  })

  it('a real model fetches a page and uses the todolist', { timeout: 120_000 }, async () => {
    const settings = liveSettings()
    const result = await turn(
      settings,
      'First use the todolist tool to add the item "read example.com". Then use the web_fetch tool to fetch https://example.com/ and reply with the text of its <h1> heading and nothing else.',
    )
    expect(result.toolCalls).toContain('todolist')
    expect(result.toolCalls).toContain('web_fetch')
    expect(result.answer).toContain('Example Domain')
  })

  it('a real model lists, writes, edits and patches a file in the tool root', { timeout: 180_000 }, async () => {
    requireHostTools()
    const [old, edited, written, patched] = [token(), token(), token(), token()]
    const settings = liveSettings()
    // Each step touches its own file, so the steps hold even when a model issues the calls at once.
    writeFileSync(join(settings.toolRoot, 'notes.txt'), `${old}\n`)
    const result = await turn(
      settings,
      [
        'Do all four steps, each with the named tool:',
        '- list_dir on "." .',
        `- edit_file on notes.txt replacing ${old} with ${edited}`,
        `- write_file to create written.txt containing exactly: ${written}`,
        `- apply_patch with this patch:\n*** Begin Patch\n*** Add File: patched.txt\n+${patched}\n*** End Patch`,
        'Then reply with the word done.',
      ].join('\n'),
    )
    for (const name of ['list_dir', 'write_file', 'edit_file', 'apply_patch']) expect(result.toolCalls, JSON.stringify(result)).toContain(name)
    expect(readFileSync(join(settings.toolRoot, 'notes.txt'), 'utf8'), JSON.stringify(result)).toContain(edited)
    expect(readFileSync(join(settings.toolRoot, 'written.txt'), 'utf8')).toContain(written)
    expect(existsSync(join(settings.toolRoot, 'patched.txt'))).toBe(true)
    expect(readFileSync(join(settings.toolRoot, 'patched.txt'), 'utf8')).toContain(patched)
  })

  it('a real model shows the diff of a file changed in a tool root that is a repository', { timeout: 120_000 }, async () => {
    const value = token()
    const settings = liveSettings((root) => {
      execFileSync('git', ['init', '-q', root])
      writeFileSync(join(root, 'a.txt'), 'before\n')
      execFileSync('git', ['-C', root, 'add', 'a.txt'])
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a'])
      writeFileSync(join(root, 'a.txt'), `${value}\n`)
    })
    expect(settings.gitRepository, 'the tool root is a repository').toBe(true)
    expect(settings.sandboxEnforced, 'git_diff needs an enforced sandbox (bwrap)').toBe(true)
    const result = await turn(settings, 'Use the git_diff tool with path "a.txt", then reply with the line it added (without the + sign) and nothing else.')
    expect(result.toolCalls).toContain('git_diff')
    expect(result.answer).toContain(value)
  })

  it.skipIf(!process.env.BRAVE_API_KEY)('a real model answers from a web search (skipped without BRAVE_API_KEY)', { timeout: 120_000 }, async () => {
    const settings = liveSettings()
    const result = await turn(settings, 'Use the web_search tool to search for "theokit sdk github", then reply with the URL of the first result and nothing else.')
    expect(result.toolCalls).toContain('web_search')
    expect(result.answer).toMatch(/https?:\/\//)
  })
})
