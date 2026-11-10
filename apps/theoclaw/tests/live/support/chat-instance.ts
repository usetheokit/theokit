import { backupInstance, uploadBackup } from '../../../src/backup/backup.js'
import { EventEmitter } from 'node:events'

import { Agent } from '@theokit/sdk'

import { startTheoClaw } from '../../../src/composition.js'
import { FakeAdapter, messageEvent, waitFor } from '../../fakes.js'

/**
 * One TheoClaw instance in a process of its own (B-400 T4.1): it starts on the workspace and state
 * directory it is given, sends each `sender=text` pair as a Telegram DM to a real model, prints the
 * replies as one JSON line, and stops. Its own process because the SDK keeps live agents per id in
 * the process: a second instance in the same process is handed the first one's agents, history and
 * all, which is the thing a backup check must not lean on.
 *
 *   node --import tsx chat-instance.ts <workspace> <stateDir> <sender=text>...
 */
const TURN_TIMEOUT_MS = 110_000
/** The presenter's fixed sentence for a failed turn (`@theokit/presenter`). */
const ERROR_SENTENCE = 'Something went wrong on my side and I could not finish that.'
/** A provider's rate limit fails a turn now and then; it says nothing of a backup, so it is asked again. */
const ATTEMPTS = 3
const RETRY_AFTER_MS = 5_000
const [workspace, stateDir, ...pairs] = process.argv.slice(2)
const turns = pairs.map((pair) => {
  const at = pair.indexOf('=')
  return { sender: pair.slice(0, at), text: pair.slice(at + 1) }
})
const signals = new EventEmitter()
let exited = false
// The one platform is a stand-in (decision B-369); `composition-fixtures.ts` is not used here
// because it registers a vitest hook, and this file runs outside vitest.
const telegram = new FakeAdapter('telegram')
const app = await startTheoClaw({
  env: {
    THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
    THEOKIT_API_KEY: process.env.THEOKIT_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    THEOCLAW_PORT: '0',
    THEOCLAW_WORKSPACE: workspace,
    THEOCLAW_STATE_DIR: stateDir,
    THEOCLAW_TELEGRAM_TOKEN: 'live-stand-in-telegram-token',
    THEOCLAW_OWNERS: [...new Set(turns.map((turn) => `telegram:${turn.sender}`))].join(','),
    THEOCLAW_DM_POLICY: 'allowlist',
  },
  agentFactory: () => {
    throw new Error('the /control factory must not build a chat agent')
  },
  getOrCreate: (id, options) => Agent.getOrCreate(id, options),
  builders: (configured) => configured.map(({ platform }) => ({ platform, build: () => telegram })),
  signals,
  exit: () => {
    exited = true
  },
  streams: [process.stderr],
})
await app.loop.ready
const replies: string[] = []
async function ask(sender: string, text: string): Promise<string> {
  const before = telegram.sent.length
  await telegram.deliver(messageEvent('telegram', text, sender))
  await waitFor(() => telegram.sent.length > before, TURN_TIMEOUT_MS, `the reply to "${text}"`)
  return telegram.sent[before]!.text
}

for (const turn of turns) {
  let reply = await ask(turn.sender, turn.text)
  for (let attempt = 1; attempt < ATTEMPTS && reply === ERROR_SENTENCE; attempt += 1) {
    // Timed on purpose: a rate limit clears with time, and no condition here says when.
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS))
    reply = await ask(turn.sender, turn.text)
  }
  replies.push(reply)
}
if (process.env.THEOCLAW_LIVE_BACKUP_DIR) {
  backupInstance({ THEOCLAW_STATE_DIR: stateDir, THEOCLAW_WORKSPACE: workspace }, process.env.THEOCLAW_LIVE_BACKUP_DIR, { homeDir: process.env.HOME!, live: true })
  await uploadBackup(process.env.THEOCLAW_LIVE_BACKUP_DIR, process.env.THEOCLAW_BACKUP_TARGET!, process.env.THEOCLAW_BACKUP_TOKEN)
}
signals.emit('SIGTERM')
await waitFor(() => exited, 40_000, 'TheoClaw to stop')
process.stdout.write(`${JSON.stringify(replies)}\n`)
process.exit(0)
