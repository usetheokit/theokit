import { EventEmitter } from 'node:events'
import { randomInt } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { Agent } from '@theokit/sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { RunningTheoClaw } from '../../src/composition.js'
import type { SessionAgent } from '../../src/sessions/session-agents.js'
import { capturingStream, fakeBuilders } from '../composition-fixtures.js'
import { messageEvent, waitFor } from '../fakes.js'
import type { FakeAdapter } from '../fakes.js'

/**
 * AC-006 (B-378): OC-50, OC-51 and OC-52 against a real model, through the app's own composition:
 * `startTheoClaw` builds each session's agent with `sessionAgentOptions(process.env, workspace)`
 * and `Agent.getOrCreate`, and the test only wraps that call to watch each run. Events are built in
 * the gateway's shape (decision B-369: no check needs people sending real messages). It runs only
 * with THEOCLAW_LIVE=1 and the model settings in the environment; without the flag it skips, so CI
 * stays offline. With the flag and no model, every case fails rather than skips.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const TURN_TIMEOUT_MS = 120_000
/** The presenter's fixed sentence for a failed turn (`@theokit/presenter`). */
const ERROR_SENTENCE = 'Something went wrong on my side and I could not finish that.'

/** A random 8-letter word: what a reply can only hold if the model saw the earlier turn. */
function token(): string {
  return Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join('')
}

interface RunRecord {
  readonly text: string
  readonly sentAt: number
  endedAt: number | undefined
  status: string | undefined
}

const workspaces: string[] = []
const apps: RunningTheoClaw[] = []
let modelKey = ''

function freshWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'theoclaw-live-sessions-'))
  workspaces.push(directory)
  return directory
}

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

/** The session agent, watched: every send and when its run settled, with what status. */
function watched(agent: SessionAgent, runs: RunRecord[]): SessionAgent {
  return {
    send: async (text) => {
      const record: RunRecord = { text, sentAt: Date.now(), endedAt: undefined, status: undefined }
      runs.push(record)
      const run = await agent.send(text)
      return {
        stream: () => run.stream(),
        wait: async () => {
          const result = await run.wait()
          record.endedAt = Date.now()
          record.status = result.status
          return result
        },
      }
    },
    dispose: () => agent.dispose(),
  }
}

async function startLive(workspace: string) {
  const { startTheoClaw } = await import('../../src/composition.js')
  const runs: RunRecord[] = []
  const signals = new EventEmitter()
  const exit = vi.fn()
  const output = capturingStream()
  const { adapters, builders } = fakeBuilders()
  const app = await startTheoClaw({
    // Only the model settings come from the operator's environment; the one platform is a stand-in.
    env: {
      THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
      THEOKIT_API_KEY: process.env.THEOKIT_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      THEOCLAW_PORT: '0',
      THEOCLAW_WORKSPACE: workspace,
      THEOCLAW_TELEGRAM_TOKEN: 'live-stand-in-telegram-token',
      // Every start names its owners (B-371); each live sender is one, so a group answers it too, and
      // a group answers without a mention, since these events carry no bot identity to mention.
      THEOCLAW_OWNERS: LIVE_SENDERS.map((sender) => `telegram:${sender}`).join(','),
      THEOCLAW_DM_POLICY: 'allowlist',
      THEOCLAW_GROUP_ACTIVATION: 'always',
    },
    agentFactory: () => {
      throw new Error('the /control factory must not build a chat agent')
    },
    getOrCreate: async (id, options) => watched(await Agent.getOrCreate(id, options), runs),
    builders,
    signals,
    exit,
    streams: [output],
  })
  apps.push(app)
  await app.loop.ready
  return { app, telegram: adapters.get('telegram')!, runs, signals, exit, output }
}

function groupEvent(text: string, sender: string): MessageEvent {
  return {
    id: `live-group-${sender}`,
    platform: 'telegram',
    sender: { id: sender },
    channel: { id: `live-group-of-${sender}`, type: 'group' },
    text,
    receivedAt: 0,
    telegram: { raw: null },
  } as unknown as MessageEvent
}

/** Deliver `event` and return the reply it gets. */
async function ask(telegram: FakeAdapter, event: MessageEvent): Promise<string> {
  const before = telegram.sent.length
  await telegram.deliver(event)
  await waitFor(() => telegram.sent.length > before, TURN_TIMEOUT_MS - 10_000, `the reply to "${event.text}"`)
  return telegram.sent[before]!.text
}

/** The sender of each case: every one is an owner, the policy that admits a sender in a group. */
const LIVE_SENDERS = ['live-dm-recall', 'live-group-sender', 'live-restart', 'live-reset', 'live-queue'] as const

const SAY = (word: string): string => `For this conversation my code word is ${word}. Reply with just: noted.`
const RECALL = 'What is my code word? Answer with the code word only.'

/** No run failed and no reply is the failure sentence: the turns counted. */
function expectHealthy(runs: readonly RunRecord[], telegram: FakeAdapter): void {
  expect(runs.map((run) => run.status).filter((status) => status === 'error')).toEqual([])
  expect(telegram.sent.map((message) => message.text)).not.toContain(ERROR_SENTENCE)
}

describe.skipIf(!LIVE)('chat sessions against a real model', () => {
  beforeAll(() => {
    modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY ?? ''
    if (!process.env.THEOCLAW_MODEL || !modelKey) {
      throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
    }
  })

  afterAll(async () => {
    for (const app of apps.splice(0)) {
      await app.loop.stopAll()
      await app.sessions.disposeAll()
      await app.close()
    }
    for (const directory of workspaces.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it("a real model recalls an earlier turn of the same dm session", { timeout: TURN_TIMEOUT_MS * 2 }, async () => {
    const word = token()
    const { telegram, runs, output } = await startLive(freshWorkspace())

    await ask(telegram, messageEvent('telegram', SAY(word), 'live-dm-recall'))
    const reply = await ask(telegram, messageEvent('telegram', RECALL, 'live-dm-recall'))

    expect(reply.toLowerCase()).toContain(word)
    expectHealthy(runs, telegram)
    expect(output.text()).not.toContain(modelKey)
  })

  it("a group session does not see a dm session's turn", { timeout: TURN_TIMEOUT_MS * 2 }, async () => {
    const word = token()
    const { telegram, runs } = await startLive(freshWorkspace())

    await ask(telegram, messageEvent('telegram', SAY(word), 'live-group-sender'))
    // The positive control: the dm session itself recalls the word, so the group's not recalling it
    // is the sessions' isolation, not a model that ignores its history.
    expect((await ask(telegram, messageEvent('telegram', RECALL, 'live-group-sender'))).toLowerCase()).toContain(word)
    const reply = await ask(telegram, groupEvent(RECALL, 'live-group-sender'))

    expect(reply.toLowerCase()).not.toContain(word)
    expectHealthy(runs, telegram)
  })

  it("a real model recalls a turn written before TheoClaw restarted", { timeout: TURN_TIMEOUT_MS * 3 }, async () => {
    const word = token()
    const workspace = freshWorkspace()
    const first = await startLive(workspace)
    await ask(first.telegram, messageEvent('telegram', SAY(word), 'live-restart'))
    expectHealthy(first.runs, first.telegram)
    first.signals.emit('SIGTERM')
    await waitFor(() => first.exit.mock.calls.length === 1, 40_000, 'the first TheoClaw to stop')
    const files = transcripts(join(workspace, '.theoclaw', 'projects'))
    expect(files.some((file) => readFileSync(file, 'utf8').includes(word))).toBe(true)

    vi.resetModules()
    const second = await startLive(workspace)
    const reply = await ask(second.telegram, messageEvent('telegram', RECALL, 'live-restart'))

    expect(reply.toLowerCase()).toContain(word)
    expectHealthy(second.runs, second.telegram)
  })

  it("after reset a real model does not recall the earlier turn", { timeout: TURN_TIMEOUT_MS * 2 }, async () => {
    const word = token()
    const { telegram, runs } = await startLive(freshWorkspace())

    await ask(telegram, messageEvent('telegram', SAY(word), 'live-reset'))
    // The positive control: before the reset the session recalls the word.
    expect((await ask(telegram, messageEvent('telegram', RECALL, 'live-reset'))).toLowerCase()).toContain(word)
    expect(await ask(telegram, messageEvent('telegram', '/reset', 'live-reset'))).toBe('Started a new conversation.')
    const reply = await ask(telegram, messageEvent('telegram', RECALL, 'live-reset'))

    expect(reply.toLowerCase()).not.toContain(word)
    expectHealthy(runs, telegram)
  })

  it("a second message sent during a running turn is answered after it with the first turn in history", { timeout: TURN_TIMEOUT_MS * 2 }, async () => {
    const word = token()
    const { telegram, runs } = await startLive(freshWorkspace())
    const sender = 'live-queue'

    void telegram.deliver(
      messageEvent('telegram', `My code word is ${word}. Write four sentences about a lighthouse keeper, then repeat the code word.`, sender),
    )
    await waitFor(() => runs.length === 1, 60_000, 'the first send to be called on the session agent')
    const secondSentAt = Date.now()
    void telegram.deliver(messageEvent('telegram', RECALL, sender))
    await waitFor(() => telegram.sent.length === 2 && runs.every((run) => run.endedAt !== undefined), TURN_TIMEOUT_MS - 10_000, 'two replies')

    const [first, second] = runs
    expect(runs).toHaveLength(2)
    // The second message left while the first turn still ran, so the turns were queued, not serial.
    expect(secondSentAt).toBeLessThan(first!.endedAt!)
    expect(second!.endedAt!).toBeGreaterThan(first!.endedAt!)
    expect(telegram.sent[1]!.text.toLowerCase()).toContain(word)
    expectHealthy(runs, telegram)
  })
})
