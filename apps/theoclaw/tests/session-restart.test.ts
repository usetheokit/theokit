import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import type { AgentOptions } from '@theokit/sdk'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { composeTheoClaw, startTheoClaw } from '../src/composition.js'
import type { RunningTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { Generations } from '../src/sessions/generations.js'
import type { SessionAgent } from '../src/sessions/session-agents.js'
import { capturingStream, fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAgent, assistant, finished, messageEvent, waitFor } from './fakes.js'
import type { FakeAdapter } from './fakes.js'
import { startModelStub } from './session-model-stub.js'
import type { ModelStub } from './session-model-stub.js'

/** The SDK's openai profile refuses a key that does not look like one, so the stub runs get this. */
const STUB_KEY = 'sk-stub-key-0123456789'
const CONFIRMATION = 'Started a new conversation.'

const running: RunningTheoClaw[] = []
const workspaces: string[] = []
afterAll(async () => {
  for (const app of running.splice(0)) {
    await app.loop.stopAll()
    await app.sessions.disposeAll()
    await app.close()
  }
  for (const directory of workspaces.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A workspace of the test's own, so no case reads another's transcripts or generations. */
function freshWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'theoclaw-restart-'))
  workspaces.push(directory)
  return directory
}

/** Every `.jsonl` under `directory`, found by walking: the SDK names them by a hash of the agent id. */
function transcripts(directory: string): string[] {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return transcripts(path)
    return entry.name.endsWith('.jsonl') ? [path] : []
  })
}

/** A TheoClaw over the real SDK, its model replaced by the loopback stub. */
async function startOverStub(workspace: string, stub: ModelStub) {
  const { adapters, builders } = fakeBuilders()
  const app = await startTheoClaw({
    env: { ...TELEGRAM_AND_LINE, OPENROUTER_API_KEY: STUB_KEY, THEOCLAW_WORKSPACE: workspace },
    agentFactory: () => {
      throw new Error('the /control factory must not build a chat agent')
    },
    getOrCreate: (id, options) => Agent.getOrCreate(id, { ...options, model: { id: 'openai/stub', url: stub.url } }),
    builders,
    signals: new EventEmitter(),
    exit: vi.fn(),
    streams: [capturingStream()],
  })
  running.push(app)
  await app.loop.ready
  return { app, telegram: adapters.get('telegram')! }
}

/** Deliver `text` from `sender` and wait for the reply count to grow by one. */
async function say(telegram: FakeAdapter, text: string, sender = 'u1'): Promise<string> {
  const before = telegram.sent.length
  await telegram.deliver(messageEvent('telegram', text, sender))
  await waitFor(() => telegram.sent.length === before + 1, 15_000, `the reply to ${text}`)
  return telegram.sent.at(-1)!.text
}

describe('/new and /reset', () => {
  it('reset starts the next message with an empty history and keeps the old transcript on disk', { timeout: 30_000 }, async () => {
    const workspace = freshWorkspace()
    const stub = await startModelStub()
    const { telegram } = await startOverStub(workspace, stub)

    await say(telegram, 'the word is heron')
    await waitFor(() => transcripts(join(workspace, '.theoclaw')).length === 1, 5000, 'the generation 0 transcript')
    expect(await say(telegram, '/reset')).toBe(CONFIRMATION)
    await say(telegram, 'what was the word')

    const last = stub.requests.at(-1)!
    expect(stub.userTexts(last)).toEqual(['what was the word'])
    const files = transcripts(join(workspace, '.theoclaw'))
    expect(files.some((file) => readFileSync(file, 'utf8').includes('the word is heron'))).toBe(true)
    await stub.close()
  })

  it('new and reset run no model turn', { timeout: 30_000 }, async () => {
    const workspace = freshWorkspace()
    const stub = await startModelStub()
    const { telegram } = await startOverStub(workspace, stub)

    expect(await say(telegram, '/new')).toBe(CONFIRMATION)
    expect(await say(telegram, '  /reset ')).toBe(CONFIRMATION)

    expect(stub.requests).toHaveLength(0)
    expect(telegram.sent.map((message) => message.text)).toEqual([CONFIRMATION, CONFIRMATION])
    await stub.close()
  })

  it('a message that only starts with /new is an ordinary turn', { timeout: 30_000 }, async () => {
    const workspace = freshWorkspace()
    const stub = await startModelStub()
    const { telegram } = await startOverStub(workspace, stub)

    // Its own sender: the SDK keeps every agent it built in this process by id, whatever the
    // workspace, so a case reusing an earlier case's id would resume that case's agent.
    expect(await say(telegram, '/new chat please', 'u3')).toBe('reply 1')
    expect(stub.requests).toHaveLength(1)
    await stub.close()
  })

  it('a reset after a failed resolve answers without a lease and the next message opens generation 1', async () => {
    const ids: string[] = []
    const { adapters, builders } = fakeBuilders()
    const { loop, sessions } = composeTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_WORKSPACE: freshWorkspace() },
      agentFactory: () => {
        throw new Error('the /control factory must not build a chat agent')
      },
      getOrCreate: async (id: string, _options: AgentOptions): Promise<SessionAgent> => {
        ids.push(id)
        if (id.endsWith('-g0')) throw new Error('provider down')
        return Object.assign(new FakeAgent({ frames: [assistant('fresh'), finished()] }), { dispose: async () => undefined })
      },
      builders,
      write: () => undefined,
    })
    await loop.ready
    const telegram = adapters.get('telegram')!

    await say(telegram, 'hello')
    expect(await say(telegram, '/reset')).toBe(CONFIRMATION)
    expect(ids).toEqual(['theoclaw-telegram-dm-u1-g0'])
    expect(await say(telegram, 'hello again')).toBe('fresh')
    expect(ids).toEqual(['theoclaw-telegram-dm-u1-g0', 'theoclaw-telegram-dm-u1-g1'])
    await loop.stopAll()
    await sessions.disposeAll()
  })
})

describe('sessions.json', () => {
  it('sessions.json is 0600 and never read half written over 200 cycles', async () => {
    const workspace = freshWorkspace()
    const file = join(workspace, '.theoclaw', 'sessions.json')
    await mkdir(join(workspace, '.theoclaw'))
    const generations = Generations.load(file)
    let parseFailures = 0
    let reads = 0

    const reader = async (): Promise<void> => {
      try {
        JSON.parse(readFileSync(file, 'utf8'))
        reads += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') parseFailures += 1
      }
    }
    await Promise.all(Array.from({ length: 200 }, (_, index) => Promise.all([generations.next(`key-${index % 7}`).then(reader), reader()])))

    expect(parseFailures).toBe(0)
    expect(reads).toBeGreaterThan(0)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(Generations.load(file).current('key-0')).toBe(29)
  })

  it('two resets of one session at once move its generation by exactly 2', async () => {
    const workspace = freshWorkspace()
    const file = join(workspace, '.theoclaw', 'sessions.json')
    const generations = Generations.load(file)

    await Promise.all([generations.next('k'), generations.next('k')])

    expect(generations.current('k')).toBe(2)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, generations: { k: 2 } })
  })

  it('a start over a malformed sessions.json is refused naming the file, and the file is unchanged', async () => {
    const workspace = freshWorkspace()
    const file = join(workspace, '.theoclaw', 'sessions.json')
    await mkdir(join(workspace, '.theoclaw'))
    writeFileSync(file, '{ not json')
    const { builders } = fakeBuilders()
    const spy = vi.fn(builders)

    const start = startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_WORKSPACE: workspace },
      agentFactory: () => {
        throw new Error('unused')
      },
      builders: spy,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })

    await expect(start).rejects.toBeInstanceOf(TheoClawConfigError)
    await expect(start).rejects.toThrow(file)
    expect(spy).toHaveBeenCalledTimes(0)
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })
})

/**
 * FR-007 in one test process. What "restart" covers here: the first TheoClaw stops through its
 * shutdown path (which disposes every agent, flushing its transcript), the app's modules are
 * re-imported after `vi.resetModules()`, and a second TheoClaw starts over the same workspace. The
 * SDK is an external dependency vitest does not re-import, so its in-process caches survive; that is
 * why the transcript is also read on disk (NFR-007), and why the stub is reached through
 * `OPENAI_API_BASE_URL` as well as `model.url`: a resumed agent takes its model from the registry,
 * which keeps only the model id. Hydrating `registry.json` in a fresh process is not exercised; the
 * live check of T4.1 restarts the same way.
 */
describe('a restart', () => {
  const workspace = freshWorkspace()
  const sender = 'restart-1'
  let stub: ModelStub

  it('the first turn is on disk under the workspace before the restart', { timeout: 30_000 }, async () => {
    stub = await startModelStub()
    vi.stubEnv('OPENAI_API_BASE_URL', stub.url)
    const signals = new EventEmitter()
    const exit = vi.fn()
    const { adapters, builders } = fakeBuilders()
    const app = await startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, OPENROUTER_API_KEY: STUB_KEY, THEOCLAW_WORKSPACE: workspace },
      agentFactory: () => {
        throw new Error('the /control factory must not build a chat agent')
      },
      getOrCreate: (id, options) => Agent.getOrCreate(id, { ...options, model: { id: 'openai/stub', url: stub.url } }),
      builders,
      signals,
      exit,
      streams: [capturingStream()],
    })
    await app.loop.ready

    await say(adapters.get('telegram')!, 'the word is heron', sender)
    signals.emit('SIGTERM')
    await waitFor(() => exit.mock.calls.length === 1, 35_000, 'the first TheoClaw to stop')

    expect(exit).toHaveBeenCalledWith(0)
    const files = transcripts(join(workspace, '.theoclaw', 'projects'))
    expect(files.some((file) => readFileSync(file, 'utf8').includes('the word is heron'))).toBe(true)
  })

  it('a turn written before a restart is in the request the stub receives after it', { timeout: 30_000 }, async () => {
    vi.resetModules()
    const reloaded = await import('../src/composition.js')
    const { adapters, builders } = fakeBuilders()
    const app = await reloaded.startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, OPENROUTER_API_KEY: STUB_KEY, THEOCLAW_WORKSPACE: workspace },
      agentFactory: () => {
        throw new Error('the /control factory must not build a chat agent')
      },
      getOrCreate: (id, options) => Agent.getOrCreate(id, { ...options, model: { id: 'openai/stub', url: stub.url } }),
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    running.push(app)
    await app.loop.ready

    await say(adapters.get('telegram')!, 'what was the word', sender)

    expect(stub.userTexts(stub.requests.at(-1)!)).toEqual(['the word is heron', 'what was the word'])
    vi.unstubAllEnvs()
    await stub.close()
  })
})
