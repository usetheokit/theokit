import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { ENTRY, killInstance, startInstance, type StartedInstance, waitForListener, waitForStartLine } from './support/instance-process.js'

/**
 * FR-013 (B-375, AC-016, AC-017): an imported Claude Code setup and an imported Hermes setup, each
 * written at test time with tokens made at test time, steer real-model turns on a started
 * `dist/main.js` over its `/control` socket: one turn each for the instructions, the memory, a skill
 * and an MCP server. A token cannot be in an answer the import did not supply, and the skill and MCP
 * turns are also checked for their tool-call events. Runs with THEOCLAW_LIVE=1 and the model
 * settings in the environment; skipped otherwise. Build first: `pnpm --filter theoclaw run build`.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const APP = fileURLToPath(new URL('../..', import.meta.url))
const IMPORT_ENTRY = join(APP, 'dist', 'import-main.js')
const MCP_SERVER = fileURLToPath(new URL('./fixtures/token-mcp-server.mjs', import.meta.url))

function modelEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const variable of ['THEOCLAW_MODEL', 'THEOKIT_API_KEY', 'OPENROUTER_API_KEY']) {
    const value = process.env[variable]
    if (value !== undefined && value !== '') env[variable] = value
  }
  if (env.THEOCLAW_MODEL === undefined || (env.THEOKIT_API_KEY ?? env.OPENROUTER_API_KEY) === undefined) {
    throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
  }
  for (const entry of [ENTRY, IMPORT_ENTRY]) if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm --filter theoclaw run build`)
  return { ...env, THEOCLAW_OWNERS: 'telegram:owner', THEOCLAW_DM_POLICY: 'allowlist', THEOCLAW_MDNS: 'off' }
}

const token = (): string => `tok-${randomBytes(6).toString('hex')}`

interface Tokens {
  readonly instruction: string
  readonly memory: string
  readonly skill: string
  readonly mcp: string
}

interface Turn {
  readonly answer: string
  readonly toolCalls: string[]
}

/** One `/control` turn: the text deltas joined and the tool-call names, resolved on the `done` frame. */
async function turn(instance: StartedInstance, message: string): Promise<Turn> {
  const socket = new WebSocket(`ws://127.0.0.1:${instance.port}/control`, { headers: { Authorization: `Bearer ${instance.token}` } })
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    return await new Promise<Turn>((resolve, reject) => {
      let answer = ''
      const toolCalls: string[] = []
      const timer = setTimeout(() => reject(new Error(`no done frame within 60000 ms: ${JSON.stringify({ answer, toolCalls })}`)), 60_000)
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; code?: string; event?: { type: string; content?: unknown; toolName?: unknown } }
        if (frame.type === 'event' && frame.event?.type === 'text_delta' && typeof frame.event.content === 'string') answer += frame.event.content
        if (frame.type === 'event' && frame.event?.type === 'tool_call' && typeof frame.event.toolName === 'string') toolCalls.push(frame.event.toolName)
        if (frame.type === 'done') {
          clearTimeout(timer)
          resolve({ answer, toolCalls })
        } else if (frame.type === 'error') {
          clearTimeout(timer)
          reject(new Error(`turn failed: ${frame.code ?? ''}`))
        }
      })
      // A dropped socket ends the turn at once, not at the deadline.
      socket.once('close', () => {
        clearTimeout(timer)
        reject(new Error(`the /control socket closed before the done frame: ${JSON.stringify({ answer, toolCalls })}`))
      })
      socket.send(JSON.stringify({ type: 'chat', message }))
    })
  } finally {
    socket.close()
  }
}

function skillFile(tokens: Tokens): string {
  return [
    '---',
    'name: vault-code',
    'description: Gives the vault code. Read it with skill_read when asked for the vault code.',
    '---',
    `The vault code is ${tokens.skill}. Reply with it exactly.`,
    '',
  ].join('\n')
}

/** A Claude Code home: `~/.claude/CLAUDE.md`, a user skill, a user MCP server, and the project's auto memory. */
function claudeCodeHome(root: string, tokens: Tokens): string[] {
  const home = join(root, 'claude-home')
  const project = join(root, 'claude-project')
  mkdirSync(join(home, '.claude', 'skills', 'vault-code'), { recursive: true })
  mkdirSync(project, { recursive: true })
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), `When asked for the house word, reply with ${tokens.instruction} exactly.\n`)
  writeFileSync(join(home, '.claude', 'skills', 'vault-code', 'SKILL.md'), skillFile(tokens))
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { token: { type: 'stdio', command: process.execPath, args: [MCP_SERVER, tokens.mcp] } } }))
  // Not a repository, so the project itself keys the auto memory (`session-transcript.ts:52-53`).
  const memory = join(home, '.claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')
  mkdirSync(memory, { recursive: true })
  writeFileSync(join(memory, 'MEMORY.md'), `The owner's locker number is ${tokens.memory}.\n`)
  return ['--from', 'claude-code', '--home', home, '--project', project]
}

/** A Hermes home: `SOUL.md`, a skill, an MCP server in `config.yaml`, and `memories/MEMORY.md`. */
function hermesHome(root: string, tokens: Tokens): string[] {
  const source = join(root, 'hermes-home')
  mkdirSync(join(source, 'skills', 'vault-code'), { recursive: true })
  mkdirSync(join(source, 'memories'), { recursive: true })
  writeFileSync(join(source, 'SOUL.md'), `When asked for the house word, reply with ${tokens.instruction} exactly.\n`)
  writeFileSync(join(source, 'skills', 'vault-code', 'SKILL.md'), skillFile(tokens))
  writeFileSync(join(source, 'config.yaml'), `mcp_servers:\n  token:\n    command: ${JSON.stringify(process.execPath)}\n    args: [${JSON.stringify(MCP_SERVER)}, ${JSON.stringify(tokens.mcp)}]\n`)
  writeFileSync(join(source, 'memories', 'MEMORY.md'), `The owner's locker number is ${tokens.memory}.\n`)
  return ['--from', 'hermes', '--source', source]
}

describe.skipIf(!LIVE)('an imported setup against a real model', () => {
  const children: StartedInstance[] = []
  const scratch: string[] = []

  afterEach(async () => {
    for (const instance of children.splice(0)) await killInstance(instance.child)
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function importAndAsk(write: (root: string, tokens: Tokens) => string[]): Promise<void> {
    const env = modelEnv()
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
    scratch.push(root)
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    mkdirSync(home)
    mkdirSync(cwd)
    const tokens: Tokens = { instruction: token(), memory: token(), skill: token(), mcp: token() }
    const args = write(root, tokens)
    // The profile's own state directory receives the import, as the start reads it (B-514).
    const imported = spawnSync(process.execPath, [IMPORT_ENTRY, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: home, THEOCLAW_PROFILE: 'migration' },
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(imported.status, imported.stderr).toBe(0)
    expect(imported.stdout).toContain('1 MCP servers')

    const instance = await startInstance({ profile: 'migration', home, cwd, env: { ...env, THEOCLAW_IMPORTED_MCP: 'on', THEOCLAW_WORKSPACE: cwd } })
    children.push(instance)
    // Named with the output, so a start that stops says why.
    await waitForStartLine(instance, 'migration').catch((error: unknown) => {
      throw new Error(`${String(error)}: ${instance.output()}`)
    })
    await waitForListener(instance.child, instance.port, 'migration')
    expect(instance.output()).toContain('setup: 1 instruction files, 1 memory files, 1 skills, 1 MCP servers (on)')

    const instruction = await turn(instance, 'What is the house word? Reply with it and nothing else.')
    const memory = await turn(instance, "What is the owner's locker number? Reply with it and nothing else.")
    const skill = await turn(instance, 'Use the skill_read tool to read the vault-code skill, then reply with the vault code and nothing else.')
    const mcp = await turn(instance, 'Call the reveal_token tool of the token MCP server, then reply with the token it returned and nothing else.')
    const seen = JSON.stringify({ instruction, memory, skill, mcp })

    expect(instruction.answer, seen).toContain(tokens.instruction)
    expect(memory.answer, seen).toContain(tokens.memory)
    expect(skill.answer, seen).toContain(tokens.skill)
    expect(skill.toolCalls, seen).toContain('skill_read')
    expect(mcp.answer, seen).toContain(tokens.mcp)
    expect(mcp.toolCalls.some((name) => name.includes('reveal_token')), seen).toBe(true)
    // A boolean, so a failure never prints the key itself.
    for (const key of [env.OPENROUTER_API_KEY, env.THEOKIT_API_KEY]) if (key !== undefined) expect(instance.output().includes(key)).toBe(false)
  }

  it(
    'imported Claude Code and Hermes setups each steer real-model turns through instructions, memory, a skill and an MCP server',
    { timeout: 600_000 },
    async () => {
      await importAndAsk(claudeCodeHome)
      for (const instance of children.splice(0)) await killInstance(instance.child)
      await importAndAsk(hermesHome)
    },
  )
})
