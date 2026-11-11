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
import { createHash } from 'node:crypto'
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

const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i
/** Every credential value: the named variables plus any variable whose name looks like one. */
export const secretValues = (env) =>
  [
    ...new Set(
      [...SECRET_ENV, ...Object.keys(env).filter((k) => SECRET_NAME.test(k))].map((k) => env[k]),
    ),
  ].filter((v) => typeof v === 'string' && v.length >= 6)

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
      // Drain stale updates first so an old reply is never taken for this turn's.
      const stale = await call('getUpdates', { offset: -1, timeout: 0 })
      let offset = stale.length > 0 ? stale[stale.length - 1].update_id + 1 : 0
      const sent = await call('sendMessage', { chat_id: chat, text })
      const deadline = Date.now() + timeoutMs
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

const PROMPT = 'Reply with exactly the word PARITY-OK and nothing else.'
function channelTurn(channel) {
  return {
    channel,
    send: PROMPT,
    expect: /PARITY-OK/,
    expectation: 'the reply text contains PARITY-OK',
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Polls `fetchNew()` (messages newer than the sent one, from the product) until one arrives. */
async function awaitReply(fetchNew, { timeoutMs, pollMs }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await fetchNew()
    if (text) return text
    await sleep(pollMs)
  }
  throw new Error('no reply before the timeout')
}

async function json(res, what) {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`)
  return res.json()
}

/** Discord: the driver posts in the test channel; the product bot's next message is the reply. */
export function discordTransport({ env, fetchImpl = fetch, timeoutMs = 120_000, pollMs = 2000 }) {
  const token = env.PARITY_DISCORD_TOKEN
  const channel = env.PARITY_DISCORD_CHANNEL_ID
  const botId = env.PARITY_DISCORD_BOT_ID
  if (!token || !channel || !botId)
    throw new Error('PARITY_DISCORD_TOKEN, _CHANNEL_ID and _BOT_ID must be set')
  const base = `https://discord.com/api/v10/channels/${channel}/messages`
  const headers = { authorization: `Bot ${token}`, 'content-type': 'application/json' }
  return {
    async turn(text) {
      const sent = await json(
        await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify({ content: text }) }),
        'discord send',
      )
      return awaitReply(
        async () => {
          const list = await json(
            await fetchImpl(`${base}?after=${sent.id}&limit=20`, { headers }),
            'discord read',
          )
          return list.find((m) => m.author?.id === botId && m.content)?.content
        },
        { timeoutMs, pollMs },
      )
    },
  }
}

/** Mattermost: the driver posts in the test channel; the product bot's next post is the reply. */
export function mattermostTransport({
  env,
  fetchImpl = fetch,
  timeoutMs = 120_000,
  pollMs = 2000,
}) {
  const token = env.PARITY_MATTERMOST_TOKEN
  const url = env.PARITY_MATTERMOST_URL
  const channel = env.PARITY_MATTERMOST_CHANNEL_ID
  const botId = env.PARITY_MATTERMOST_BOT_ID
  if (!token || !url || !channel || !botId)
    throw new Error('PARITY_MATTERMOST_TOKEN, _URL, _CHANNEL_ID and _BOT_ID must be set')
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return {
    async turn(text) {
      const sent = await json(
        await fetchImpl(`${url}/api/v4/posts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel_id: channel, message: text }),
        }),
        'mattermost send',
      )
      return awaitReply(
        async () => {
          const list = await json(
            await fetchImpl(`${url}/api/v4/channels/${channel}/posts?since=${sent.create_at}`, {
              headers,
            }),
            'mattermost read',
          )
          return Object.values(list.posts ?? {}).find(
            (p) => p.user_id === botId && p.create_at > sent.create_at,
          )?.message
        },
        { timeoutMs, pollMs },
      )
    },
  }
}

/** Matrix: the driver sends to the test room; the product's next message is the reply. */
export function matrixTransport({ env, fetchImpl = fetch, timeoutMs = 120_000, pollMs = 2000 }) {
  const token = env.PARITY_MATRIX_TOKEN
  const home = env.PARITY_MATRIX_HOMESERVER
  const room = env.PARITY_MATRIX_ROOM_ID
  const botId = env.PARITY_MATRIX_BOT_ID
  if (!token || !home || !room || !botId)
    throw new Error('PARITY_MATRIX_TOKEN, _HOMESERVER, _ROOM_ID and _BOT_ID must be set')
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const rooms = `${home}/_matrix/client/v3/rooms/${encodeURIComponent(room)}`
  return {
    async turn(text) {
      const txn = `parity-${Date.now()}`
      const sent = await json(
        await fetchImpl(`${rooms}/send/m.room.message/${txn}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ msgtype: 'm.text', body: text }),
        }),
        'matrix send',
      )
      return awaitReply(
        async () => {
          const page = await json(
            await fetchImpl(`${rooms}/messages?dir=b&limit=10`, { headers }),
            'matrix read',
          )
          for (const ev of page.chunk ?? []) {
            if (ev.event_id === sent.event_id) return undefined
            if (ev.sender === botId && ev.content?.body) return ev.content.body
          }
          return undefined
        },
        { timeoutMs, pollMs },
      )
    },
  }
}

/** A command a user would run (WebChat/control/CLI items): argv and stdout, no shell. */
export function commandTransport({ command, run = defaultRun }) {
  return { turn: async (text) => run(command, text) }
}

function defaultRun([file, ...args], text) {
  return execFileSync(file, [...args, text], { encoding: 'utf8', timeout: 120_000 }).trim()
}

/**
 * One scripted turn per OC id, with the expected observable outcome declared beside it. Add an id
 * here to make it measurable; the gate refuses `shipped` for any id that has no passing result.
 * `cli` scenarios name the command in `command` (argv); the message is appended as the last arg.
 */
export const SCENARIOS = {
  'OC-2': channelTurn('telegram'),
  'OC-4': channelTurn('discord'),
  'OC-8': channelTurn('matrix'),
}

const TRANSPORTS = {
  telegram: telegramTransport,
  discord: discordTransport,
  matrix: matrixTransport,
  mattermost: mattermostTransport,
  cli: ({ scenario }) => commandTransport({ command: scenario.command }),
}

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

/**
 * OpenClaw's result for the same turn, for a parity row: `PARITY_OPENCLAW_CMD` is a JSON argv
 * array run with the message appended, on the same model (`PARITY_MODEL`, default `MODEL`).
 * `null` when no command is configured.
 */
async function runOpenClaw(scenario, env, transports) {
  if (!env.PARITY_OPENCLAW_CMD) return null
  try {
    const command = JSON.parse(env.PARITY_OPENCLAW_CMD)
    const run = transports.openclaw ?? ((c, t) => commandTransport({ command: c }).turn(t))
    const received = await run(command, scenario.send)
    return {
      verdict: scenario.expect.test(received) ? 'works' : 'fails',
      received,
      model: env.PARITY_MODEL ?? MODEL,
    }
  } catch (e) {
    return { verdict: 'fails', error: e instanceof Error ? e.message : String(e) }
  }
}

function entryOf(id, root) {
  const ledger = JSON.parse(readFileSync(join(root, LEDGER), 'utf8'))
  return ledger.find((e) => e.id === id) ?? { id }
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
    reply = await transports[scenario.channel]({ env, scenario }).turn(scenario.send)
    verdict = scenario.expect.test(reply) ? 'works' : 'fails'
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const openclaw = await runOpenClaw(scenario, env, transports)
  const record = {
    id,
    verdict,
    real: true,
    channel: scenario.channel,
    model: env.PARITY_MODEL ?? MODEL,
    expected: scenario.expectation,
    sent: scenario.send,
    received: reply,
    error,
    openclaw,
    commit: git(['rev-parse', 'HEAD'], root),
    versions: packageVersions(root),
    inputs_digest: inputsDigest(entryOf(id, root), root),
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

/** Repo paths an item names: its `files` list and its check's path. */
export const namedFiles = (entry) =>
  [...(Array.isArray(entry.files) ? entry.files : []), entry.check?.path].filter(
    (f) => typeof f === 'string',
  )

/**
 * A digest of what the item is made of: the contents of every file it names and its ledger entry
 * minus the fields a measurement is allowed to change (`status`, `verified_on`, `note`). A result
 * records the digest it measured; the gate recomputes it, so staleness never depends on commit
 * times, squash merges or history depth.
 */
export function inputsDigest(entry, root = REPO_ROOT) {
  const hash = createHash('sha256')
  const rest = Object.fromEntries(
    Object.entries(entry).filter(([k]) => !['status', 'verified_on', 'note'].includes(k)),
  )
  hash.update(JSON.stringify(rest))
  for (const file of namedFiles(entry).toSorted()) {
    let body = ''
    try {
      body = readFileSync(join(root, file), 'utf8')
    } catch {
      body = '<absent>'
    }
    hash.update(`\0${file}\0${body}`)
  }
  return hash.digest('hex')
}

/**
 * Violations: every `shipped` entry needs a passing real result that measured the item as it is now.
 * `resultOf(id)` returns the parsed result or null; `digestOf(entry)` the item's current digest.
 */
export function gate(ledger, resultOf, digestOf, knownCommit = () => true) {
  const violations = []
  for (const entry of ledger) {
    if (entry.status !== 'shipped') continue
    const result = resultOf(entry.id)
    let detail = null
    if (!result) detail = 'no result file'
    else if (result.verdict !== 'works' || result.real !== true)
      detail = `result verdict is ${result.verdict}`
    else if (!result.commit || !knownCommit(result.commit))
      detail = 'result names no commit of this repository'
    else if (result.inputs_digest !== digestOf(entry))
      detail = 'the item or a file it names changed since the result; rerun the harness'
    if (detail) violations.push({ id: entry.id, detail })
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
  const violations = gate(
    ledger,
    resultOf,
    (entry) => inputsDigest(entry, root),
    (commit) => git(['cat-file', '-t', commit], root) === 'commit',
  )
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
