#!/usr/bin/env node
/**
 * The parity harness (#1591): measures one OC item with real channels, writes
 * `parity/results/<id>.json`, and gates `status: shipped` in the ledger on a passing real result
 * newer than the item's last change.
 *
 *   pnpm --filter theoclaw parity -- --id OC-2     run one scripted turn, write its result
 *   pnpm --filter theoclaw parity -- --gate        refuse `shipped` without a fresh passing result
 *   pnpm --filter theoclaw parity                  the ledger count (check-parity-ledger.mjs)
 *
 * Credentials come from the environment (CI secrets) only. Every string written to stdout, stderr
 * or a result file goes through `redact`, which removes each configured secret value.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const LEDGER = 'apps/theoclaw/parity/ledger.json'
export const RESULTS_DIR = 'apps/theoclaw/parity/results'
/** The same model for both products, through the subscription route. */
export const MODEL = 'openai-chatgpt/gpt-5'

/** Environment variables whose values are credentials. */
export const SECRET_ENV = [
  'PARITY_TELEGRAM_DRIVER_TOKEN',
  'PARITY_TELEGRAM_BOT_TOKEN',
  'PARITY_DISCORD_TOKEN',
  'PARITY_MATRIX_TOKEN',
  'PARITY_MATTERMOST_TOKEN',
]

export const secretValues = (env) =>
  SECRET_ENV.map((k) => env[k]).filter((v) => typeof v === 'string' && v.length > 0)

/** `text` with every secret value replaced. */
export function redact(text, secrets) {
  let out = String(text)
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  return out
}

/** Telegram transport: the driver bot sends to the test chat, then waits for the product bot's reply. */
export function telegramTransport({ env, fetchImpl = fetch, timeoutMs = 120_000, pollMs = 2000 }) {
  const token = env.PARITY_TELEGRAM_DRIVER_TOKEN
  const chat = env.PARITY_TELEGRAM_CHAT_ID
  const botId = Number(env.PARITY_TELEGRAM_BOT_ID)
  if (!token || !chat || !botId) {
    throw new Error(
      'PARITY_TELEGRAM_DRIVER_TOKEN, PARITY_TELEGRAM_CHAT_ID and PARITY_TELEGRAM_BOT_ID must be set',
    )
  }
  const call = async (method, body) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.ok) throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`)
    return json.result
  }
  return {
    async turn(text) {
      const sent = await call('sendMessage', { chat_id: chat, text })
      const deadline = Date.now() + timeoutMs
      let offset = 0
      while (Date.now() < deadline) {
        const updates = await call('getUpdates', {
          offset,
          timeout: 0,
          allowed_updates: ['message'],
        })
        for (const update of updates) {
          offset = update.update_id + 1
          const m = update.message
          if (
            m?.from?.id === botId &&
            String(m.chat.id) === String(chat) &&
            m.message_id > sent.message_id &&
            m.text
          ) {
            return m.text
          }
        }
        await new Promise((r) => setTimeout(r, pollMs))
      }
      throw new Error('no reply before the timeout')
    },
  }
}

/** One scripted turn per OC id, with the expected observable outcome declared beside it. */
export const SCENARIOS = {
  'OC-2': {
    channel: 'telegram',
    send: 'Reply with exactly the word PARITY-OK and nothing else.',
    expect: /PARITY-OK/,
    expectation: 'the reply text contains PARITY-OK',
  },
}

const TRANSPORTS = { telegram: telegramTransport }

const git = (args, cwd) => {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is the only way to read history
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function packageVersions(root) {
  const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
  const pkg = read('apps/theoclaw/package.json')
  return { theoclaw: pkg.version }
}

/** Runs one scenario and returns the result record (verdict `works` or `fails`). */
export async function runScenario(
  id,
  { env = process.env, root = REPO_ROOT, transports = TRANSPORTS, now = new Date() } = {},
) {
  const scenario = SCENARIOS[id]
  if (!scenario) throw new Error(`no scripted turn for ${id}`)
  const secrets = secretValues(env)
  let reply = null
  let verdict = 'fails'
  let error = null
  try {
    reply = await transports[scenario.channel]({ env }).turn(scenario.send)
    verdict = scenario.expect.test(reply) ? 'works' : 'fails'
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const record = {
    id,
    verdict,
    real: true,
    channel: scenario.channel,
    model: MODEL,
    expected: scenario.expectation,
    sent: scenario.send,
    received: reply,
    error,
    commit: git(['rev-parse', 'HEAD'], root),
    versions: packageVersions(root),
    date: now.toISOString(),
  }
  // Redact the serialized record so a credential echoed in a reply or an error never lands on disk.
  return JSON.parse(
    redact(
      JSON.stringify(record),
      secrets.map((s) => JSON.stringify(s).slice(1, -1)),
    ),
  )
}

export function writeResult(record, root = REPO_ROOT) {
  const dir = join(root, RESULTS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
}

/** ISO time of the item's last change: files it names, or its ledger entry. `null` when unknown. */
export function lastChange(entry, root = REPO_ROOT) {
  const times = []
  const files = entry.check?.path ? [entry.check.path] : []
  for (const file of files) {
    if (git(['status', '--porcelain', '--', file], root)) return new Date().toISOString()
    times.push(git(['log', '-1', '--format=%cI', '--', file], root))
  }
  const range = `/"id": "${entry.id}"/,/^  }/:${LEDGER}`
  times.push(git(['log', '-1', '--format=%cI', '-s', '-L', range], root).split('\n')[0])
  const known = times.filter(Boolean).map((t) => new Date(t).getTime())
  return known.length === 0 ? null : new Date(Math.max(...known)).toISOString()
}

/**
 * Violations: every `shipped` entry needs a passing real result dated after its last change.
 * `resultOf(id)` returns the parsed result or null; `changedAt(entry)` the ISO time or null.
 */
export function gate(ledger, resultOf, changedAt) {
  const violations = []
  for (const entry of ledger) {
    if (entry.status !== 'shipped') continue
    const result = resultOf(entry.id)
    if (!result) {
      violations.push({ id: entry.id, detail: 'no result file' })
    } else if (result.verdict !== 'works' || result.real !== true) {
      violations.push({ id: entry.id, detail: `result verdict is ${result.verdict}` })
    } else {
      const changed = changedAt(entry)
      const at = Date.parse(result.date)
      if (changed === null)
        violations.push({ id: entry.id, detail: 'last change unknown (shallow clone?)' })
      else if (!Number.isFinite(at) || at <= Date.parse(changed)) {
        violations.push({
          id: entry.id,
          detail: `result ${result.date} is not newer than the last change ${changed}`,
        })
      }
    }
  }
  return violations
}

export function runGate({ root = REPO_ROOT, write = console.log } = {}) {
  const ledger = JSON.parse(readFileSync(join(root, LEDGER), 'utf8'))
  const resultOf = (id) => {
    try {
      return JSON.parse(readFileSync(join(root, RESULTS_DIR, `${id}.json`), 'utf8'))
    } catch {
      return null
    }
  }
  const violations = gate(ledger, resultOf, (entry) => lastChange(entry, root))
  for (const v of violations) write(`${v.id} shipped-without-real-result: ${v.detail}`)
  return violations.length > 0 ? 1 : 0
}

export async function main(argv, { env = process.env, write = console.log } = {}) {
  const args = argv.filter((a) => a !== '--')
  if (args.includes('--gate')) return runGate({ write })
  const at = args.indexOf('--id')
  if (at < 0 || !args[at + 1]) {
    write('usage: parity --id OC-<n> | --gate')
    return 2
  }
  const secrets = secretValues(env)
  const record = await runScenario(args[at + 1], { env })
  writeResult(record)
  const tail = record.received ? ': ' + record.received : ''
  write(redact(`${record.id} ${record.verdict}${tail}`, secrets))
  return record.verdict === 'works' ? 0 : 1
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(
        redact(error instanceof Error ? error.message : String(error), secretValues(process.env)),
      )
      process.exitCode = 1
    },
  )
}
