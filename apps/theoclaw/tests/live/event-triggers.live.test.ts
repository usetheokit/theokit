import { createHmac, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EmailMessageEvent, MessageEvent } from '@theokit/gateway'
import { EmailAdapter } from '@theokit/gateway-email'
import { Agent } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { hookFingerprint } from '../../src/agent/hook-approval.js'
import { startTheoClaw } from '../../src/composition.js'
import type { RunningTheoClaw } from '../../src/composition.js'
import { agentOptionsFor } from '../../src/control-plane/agent-factory.js'
import { capturingStream, fakeBuilders } from '../composition-fixtures.js'
import { messageEvent, waitFor } from '../fakes.js'

/**
 * AC-007 (B-397 FR-011): the signed trigger, the hook gate, `/goal` and the e-mail path against a
 * real model, through the app's own start and its own option builders. It runs only with
 * THEOCLAW_LIVE=1 and the model settings in the environment, so CI stays offline. Each case fails
 * if its part were faked or skipped: the trigger reply must arrive exactly once with text, the hook
 * case has an approved control, and the goal reply must carry the status the budget forces.
 *
 * The e-mail case needs two mailboxes, because `@theokit/gateway-email` drops a message from its own
 * address (`[email] dropped own-address loopback`): the watched one (`THEOCLAW_EMAIL_*`) and a
 * sender (`THEOCLAW_EMAIL_TEST_FROM_ADDRESS`, `THEOCLAW_EMAIL_TEST_FROM_PASSWORD`, on the same hosts
 * unless `THEOCLAW_EMAIL_TEST_FROM_IMAP_HOST` and `..._SMTP_HOST` say otherwise). Without them it
 * skips, and B-397 carries the `access` impediment instead (FR-011), never a fake mailbox.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const EMAIL = ['THEOCLAW_EMAIL_ADDRESS', 'THEOCLAW_EMAIL_PASSWORD', 'THEOCLAW_EMAIL_IMAP_HOST', 'THEOCLAW_EMAIL_SMTP_HOST', 'THEOCLAW_EMAIL_TEST_FROM_ADDRESS', 'THEOCLAW_EMAIL_TEST_FROM_PASSWORD'].every(
  (variable) => (process.env[variable] ?? '').trim() !== '',
)
const RUN_TIMEOUT_MS = 120_000
const SECRET = `live-trigger-${randomBytes(8).toString('hex')}`

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function scratch(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

/** The model settings from the environment, and nothing else of it: no real channel is configured by accident. */
function modelEnv(): Record<string, string> {
  const model = process.env.THEOCLAW_MODEL
  if (model === undefined || model.trim() === '') throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  const keys = Object.fromEntries(
    ['THEOKIT_API_KEY', 'OPENROUTER_API_KEY'].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]])),
  )
  return { THEOCLAW_MODEL: model, ...keys }
}

/** A started app whose only channel is a fake Telegram adapter, with one trigger replying to it. */
async function startOnFakeTelegram(extra: Record<string, string> = {}) {
  const { adapters, builders } = fakeBuilders()
  const output = capturingStream()
  const app: RunningTheoClaw = await startTheoClaw({
    cwd: scratch('theoclaw-live-triggers-cwd-'),
    env: {
      ...modelEnv(),
      THEOCLAW_TELEGRAM_TOKEN: 'fake-telegram-token',
      THEOCLAW_OWNERS: 'telegram:owner',
      THEOCLAW_DM_POLICY: 'open',
      THEOCLAW_PORT: '0',
      THEOCLAW_WORKSPACE: scratch('theoclaw-live-triggers-ws-'),
      THEOCLAW_TRIGGERS: 'ci',
      THEOCLAW_TRIGGER_CI_SECRET: SECRET,
      THEOCLAW_TRIGGER_CI_REPLY_TO: 'telegram:4242',
      THEOCLAW_TRIGGER_CI_INSTRUCTIONS: 'Say in one short sentence which branch the build ran on.',
      ...extra,
    },
    agentFactory: () => {
      throw new Error('no /control turn runs in this test')
    },
    builders,
    signals: new EventEmitter(),
    exit: vi.fn(),
    streams: [output],
  })
  cleanups.push(async () => {
    await app.loop.stopAll()
    await app.sessions.disposeAll()
    await app.close()
  })
  await app.loop.ready
  return { app, output, telegram: adapters.get('telegram')!, base: `http://127.0.0.1:${app.address().port}` }
}

function signedPost(base: string, body: string, secret: string): Promise<Response> {
  return fetch(`${base}/hooks/ci`, {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    body,
  })
}

/** A workspace whose project settings declare a `Stop` hook that touches a marker. */
function stopHookWorkspace(): { readonly cwd: string; readonly marker: string; readonly fingerprint: string } {
  const cwd = scratch('theoclaw-live-hooks-')
  const marker = join(cwd, 'stop.marker')
  const command = `touch ${marker}`
  mkdirSync(join(cwd, '.theokit'))
  writeFileSync(join(cwd, '.theokit', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }))
  return { cwd, marker, fingerprint: hookFingerprint({ sourceEvent: 'Stop', command, timeoutMs: 30_000 }) }
}

/**
 * One real-model turn of an agent built from the entry's own options (`agentOptionsFor`), in
 * `cwd`. The project setting source is turned on here, because TheoClaw's agents load none (plan
 * D3): without it no hook would load, and the refusal could not fail.
 */
async function oneHookedTurn(cwd: string, approved: string): Promise<void> {
  const options = agentOptionsFor({ ...modelEnv(), THEOCLAW_APPROVED_HOOKS: approved })
  const agent = await Agent.create({ ...options, local: { ...options.local, cwd, settingSources: ['project'] } })
  try {
    const run = await agent.send('Reply with the single word: ready.')
    const outcome = await run.wait()
    expect(outcome.status, JSON.stringify(outcome.error ?? {})).toBe('finished')
  } finally {
    await agent[Symbol.asyncDispose]()
  }
}

describe.skipIf(!LIVE)('event triggers, the hook gate and /goal against a real model (AC-007)', () => {
  it('a signed delivery gets one real-model reply on the trigger channel', { timeout: RUN_TIMEOUT_MS }, async () => {
    const { output, telegram, base } = await startOnFakeTelegram()
    const response = await signedPost(base, JSON.stringify({ ref: 'refs/heads/main', status: 'success' }), SECRET)
    expect(response.status).toBe(202)
    // The process output names a failed run or an undelivered reply: it is the failure's message.
    await waitFor(() => telegram.sent.length >= 1 || output.text().includes('trigger ci:'), 90_000, 'the trigger reply')
    expect(output.text(), output.text()).not.toContain('trigger ci:')
    // A late second reply would be a second run: give it the time one more turn would take.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(telegram.sent).toHaveLength(1)
    expect(telegram.sent[0]?.channel.id).toBe('4242')
    expect(telegram.sent[0]?.text.trim()).not.toBe('')
  })

  it('a delivery signed with another secret answers 401 and sends nothing', { timeout: RUN_TIMEOUT_MS }, async () => {
    const { telegram, base } = await startOnFakeTelegram()
    expect((await signedPost(base, '{}', `${SECRET}-wrong`)).status).toBe(401)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(telegram.sent).toHaveLength(0)
  })

  it('an unapproved Stop hook is not spawned, and an approved one is', { timeout: RUN_TIMEOUT_MS }, async () => {
    const refused = stopHookWorkspace()
    await oneHookedTurn(refused.cwd, '')
    expect(existsSync(refused.marker)).toBe(false)

    const approved = stopHookWorkspace()
    await oneHookedTurn(approved.cwd, approved.fingerprint)
    await waitFor(() => existsSync(approved.marker), 10_000, 'the approved Stop hook to touch its marker')
  })

  it('/goal with a 1-token budget replies budget_limited', { timeout: RUN_TIMEOUT_MS }, async () => {
    const { telegram } = await startOnFakeTelegram({ THEOCLAW_GOAL_TOKEN_BUDGET: '1' })
    // A goal one turn cannot finish: the SDK's judge answers `done` before the budget is read, so a
    // goal the first turn completes ends `completed` whatever the budget (measured on this run).
    const goal = '/goal write a twenty-chapter story, one short chapter per turn; write only chapter 1 now'
    await telegram.deliver(messageEvent('telegram', goal, 'live-goal-user'))
    await waitFor(() => telegram.sent.length === 1, 90_000, 'the goal reply')
    expect(telegram.sent[0]?.text).toMatch(/^budget_limited: /)
  })

  it.skipIf(!EMAIL)('an e-mail to the watched mailbox gets one real-model reply threaded to it', { timeout: 300_000 }, async () => {
    const env = process.env as Record<string, string>
    const app = await startTheoClaw({
      cwd: scratch('theoclaw-live-email-cwd-'),
      env: {
        ...modelEnv(),
        THEOCLAW_EMAIL_ADDRESS: env.THEOCLAW_EMAIL_ADDRESS!,
        THEOCLAW_EMAIL_PASSWORD: env.THEOCLAW_EMAIL_PASSWORD!,
        THEOCLAW_EMAIL_IMAP_HOST: env.THEOCLAW_EMAIL_IMAP_HOST!,
        THEOCLAW_EMAIL_SMTP_HOST: env.THEOCLAW_EMAIL_SMTP_HOST!,
        THEOCLAW_OWNERS: `email:${env.THEOCLAW_EMAIL_TEST_FROM_ADDRESS!.toLowerCase()}`,
        THEOCLAW_DM_POLICY: 'open',
        THEOCLAW_PORT: '0',
        THEOCLAW_WORKSPACE: scratch('theoclaw-live-email-ws-'),
      },
      agentFactory: () => {
        throw new Error('no /control turn runs in this test')
      },
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    cleanups.push(async () => {
      await app.loop.stopAll()
      await app.sessions.disposeAll()
      await app.close()
    })
    await app.loop.ready

    const sender = new EmailAdapter({
      address: env.THEOCLAW_EMAIL_TEST_FROM_ADDRESS!,
      password: env.THEOCLAW_EMAIL_TEST_FROM_PASSWORD!,
      imapHost: env.THEOCLAW_EMAIL_TEST_FROM_IMAP_HOST ?? env.THEOCLAW_EMAIL_IMAP_HOST!,
      smtpHost: env.THEOCLAW_EMAIL_TEST_FROM_SMTP_HOST ?? env.THEOCLAW_EMAIL_SMTP_HOST!,
    })
    const received: MessageEvent[] = []
    sender.onInbound(async (event) => {
      received.push(event)
    })
    expect(await sender.connect()).toBe(true)
    cleanups.push(() => sender.disconnect())

    const sent = await sender.sendMessage({ channel: { id: env.THEOCLAW_EMAIL_ADDRESS!, type: 'dm' }, text: 'Reply with one short sentence about the weather.' })
    if (!sent.ok) throw new Error(`the test e-mail was not sent (${sent.error?.code ?? 'no code'})`)
    const sentId = (sent.messageId ?? '').replace(/^<|>$/g, '')
    const isReply = (event: MessageEvent): boolean =>
      event.platform === 'email' && (event as EmailMessageEvent).email.inReplyTo === sentId && event.text.trim() !== ''
    await waitFor(() => received.some(isReply), 240_000, 'the threaded e-mail reply')
    expect(received.filter(isReply)).toHaveLength(1)
  })
})
