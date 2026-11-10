import { type ChildProcess, spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { downloadBackup, restoreInstance } from '../../src/backup/backup.js'
import { backupSkipReason } from './support/backup-target.js'

/**
 * AC-009 (B-400, OC-99's built half): three DM sessions store a code word each against a real
 * model; the running instance snapshots and uploads before stopping. An empty profile recalls none of them (the control
 * that makes the check able to fail); the backup restored into another empty profile recalls each.
 * Each instance runs in a process of its own (`support/chat-instance.ts`), as a stop and a start
 * do. Runs only with THEOCLAW_LIVE=1, THEOCLAW_MODEL and a key.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
// Skipped, with the reason, when no offsite target is configured (#1416).
const SKIP_REASON = LIVE ? backupSkipReason(process.env) : undefined
if (SKIP_REASON) console.warn(`backup.live.test.ts skipped: ${SKIP_REASON}`)
const TURN_TIMEOUT_MS = 120_000
const TSX_LOADER = import.meta.resolve('tsx')
const INSTANCE = join(import.meta.dirname, 'support', 'chat-instance.ts')
const SENDERS = ['live-backup-a', 'live-backup-b', 'live-backup-c'] as const
const SAY = (word: string): string => `For this conversation my code word is ${word}. Reply with just: noted.`
const RECALL = 'What is my code word? Answer with the code word only, or "none" if I never told you one.'

/** The presenter's fixed sentence for a failed turn (`@theokit/presenter`). */
const ERROR_SENTENCE = 'something went wrong on my side and i could not finish that.'

const roots: string[] = []
const children: ChildProcess[] = []

afterAll(() => {
  // A test that timed out leaves its instance running and spending the key: end it.
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL')
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A random 8-letter word: what a reply can only hold if the model saw the earlier turn. */
function token(): string {
  return Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join('')
}

interface Profile {
  readonly env: NodeJS.ProcessEnv
  readonly state: string
  readonly workspace: string
}

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'theoclaw-live-backup-'))
  roots.push(root)
  return root
}

/** An instance's state directory and workspace, created empty or left absent. */
function profile(create: boolean): Profile {
  const root = scratch()
  const paths = { state: join(root, 'state'), workspace: join(root, 'workspace') }
  if (create) for (const path of Object.values(paths)) mkdirSync(path)
  return { ...paths, env: { THEOCLAW_STATE_DIR: paths.state, THEOCLAW_WORKSPACE: paths.workspace, XDG_CONFIG_HOME: join(root, 'config') } }
}

/** Run one instance in its own process over `target`, one DM per sender; its replies, lower-cased, and its stderr. */
function chat(target: Profile, texts: readonly string[], backupDir?: string): Promise<{ readonly replies: string[]; readonly log: string }> {
  const pairs = SENDERS.map((sender, index) => `${sender}=${texts[index]}`)
  const child = spawn(process.execPath, ['--import', TSX_LOADER, INSTANCE, target.workspace, target.state, ...pairs], {
    // A scratch HOME, so nothing the instance keys on the home directory lands in the developer's.
    env: { THEOCLAW_LIVE_BACKUP_DIR: backupDir, THEOCLAW_BACKUP_TARGET: process.env.THEOCLAW_BACKUP_TARGET, THEOCLAW_BACKUP_TOKEN: process.env.THEOCLAW_BACKUP_TOKEN, PATH: process.env.PATH, HOME: join(target.workspace, '..'), XDG_CONFIG_HOME: target.env.XDG_CONFIG_HOME, THEOCLAW_MODEL: process.env.THEOCLAW_MODEL, THEOKIT_API_KEY: process.env.THEOKIT_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
  return new Promise((resolve, reject) =>
    child.once('exit', (code) =>
      code === 0
        ? resolve({ replies: (JSON.parse(out.trim().split('\n').at(-1)!) as string[]).map((reply) => reply.toLowerCase()), log: err })
        : reject(new Error(`the instance exited ${code}: ${err}`)),
    ),
  )
}

describe.skipIf(!LIVE || SKIP_REASON !== undefined)('backup and restore against a real model (OC-99)', () => {
  it('a restored profile recalls each of 3 code words and an unrestored one recalls none', { timeout: TURN_TIMEOUT_MS * 6 }, async () => {
    if (!process.env.THEOCLAW_MODEL || !(process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY)) {
      throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
    }
    const words = SENDERS.map(() => token())
    const original = profile(true)
    const backupDir = join(scratch(), 'backup')
    await chat(original, words.map(SAY), backupDir)
    rmSync(backupDir, { recursive: true })
    await downloadBackup(backupDir, process.env.THEOCLAW_BACKUP_TARGET!, process.env.THEOCLAW_BACKUP_TOKEN)

    // The control: an empty profile has none of the three conversations.
    const control = await chat(profile(true), SENDERS.map(() => RECALL))
    for (const [index, reply] of control.replies.entries()) {
      // The control counts only if the model answered: a failed turn never holds the word either.
      expect(reply, control.log).not.toBe(ERROR_SENTENCE)
      expect(reply.trim(), control.log).not.toBe('')
      expect(reply, control.log).not.toContain(words[index])
    }

    const restored = profile(false)
    restoreInstance(restored.env, backupDir, { homeDir: tmpdir() })
    const recalled = await chat(restored, SENDERS.map(() => RECALL))
    for (const [index, reply] of recalled.replies.entries()) expect(reply, recalled.log).toContain(words[index])
  })
})
