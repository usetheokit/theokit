#!/usr/bin/env node
/**
 * The stdio wrapper TheoClaw starts the browser server through: `browser-proxy.mjs <playwright-mcp
 * cli> [server args...]`. `@playwright/mcp` offers no way to leave a tool out, and its default set
 * holds `browser_run_code_unsafe`, which runs model-written JavaScript in the server process
 * (RCE-equivalent, outside every sandbox). So the wrapper sits on the JSON-RPC lines:
 *
 * - `tools/list` answers keep only OFFERED; a `tools/call` for any other tool is refused here and
 *   never reaches the server;
 * - the server runs in a fresh directory under the system temp directory, which is also its
 *   `--output-dir`, so the files its tools write by name or by default land there, not in the
 *   workspace (its file root is its working directory once the client names no roots, and the
 *   `roots` capability is stripped from `initialize`); the directory is removed when it exits;
 * - the server answers every action with a `- [Snapshot](<file>)` link to a file in that directory,
 *   which no tool of the agent can open; a `tools/call` answer gets the file's content in its place
 *   (one that cannot be read, is empty or leaves the directory becomes a line saying so, and stderr names it);
 * - the server gets one `tools/call` at a time: a model may send `browser_navigate` and `browser_snapshot`
 *   in one turn, and a snapshot taken while the page loads is empty, so the model reports an empty page;
 * - `PLAYWRIGHT_MCP_*` variables are dropped, so the environment cannot widen the server's config.
 *
 * Exits with the server's status, 1 when it ended on a signal (SIGTERM, SIGINT and SIGHUP are
 * forwarded to it), 2 when started without a CLI or when the server cannot be spawned. A SIGKILL
 * cannot be forwarded: the server then exits on its stdin closing and the directory stays behind.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'

/** Every tool `@playwright/mcp@0.0.83` lists by default, less `browser_run_code_unsafe`. */
const OFFERED = new Set([
  'browser_click',
  'browser_close',
  'browser_console_messages',
  'browser_drag',
  'browser_drop',
  'browser_emulate_media',
  'browser_evaluate',
  'browser_file_upload',
  'browser_fill_form',
  'browser_find',
  'browser_handle_dialog',
  'browser_hover',
  'browser_navigate',
  'browser_navigate_back',
  'browser_network_request',
  'browser_network_requests',
  'browser_press_key',
  'browser_resize',
  'browser_select_option',
  'browser_snapshot',
  'browser_tabs',
  'browser_take_screenshot',
  'browser_type',
  'browser_wait_for',
])

/** JSON-RPC "invalid params": the tool named is not one this server offers. */
const NOT_OFFERED = -32602

/** JSON-RPC "invalid request". */
const INVALID_REQUEST = -32600

const [cliPath, ...serverArgs] = process.argv.slice(2)
if (cliPath === undefined) {
  process.stderr.write('browser-proxy: usage: browser-proxy.mjs <playwright-mcp cli> [server args...]\n')
  process.exit(2)
}

const workDir = mkdtempSync(join(tmpdir(), 'theoclaw-browser-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PLAYWRIGHT_MCP_')))
const server = spawn(process.execPath, [cliPath, ...serverArgs, '--output-dir', workDir], {
  cwd: workDir,
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
})

/**
 * A server attached to a shared browser (`--cdp-endpoint`) would adopt the browser's first page, which
 * another session drives. Before the first tool call it opens a page of its own (same profile, so the
 * same cookies) and the call waits for it.
 */
const attached = serverArgs.includes('--cdp-endpoint')
const OPEN_PAGE_ID = 'theoclaw-open-page'
/** `idle` until the first tool call, `opening` while the page is being made, then `ready`. */
let pageState = attached ? 'idle' : 'ready'
/** The `tools/call` requests not yet sent to the server, in the order they came. */
const queue = []
/** The call the server is answering now (`{ id }`), or `undefined`: the server gets one call at a time. */
let inFlight

/** The ids of the `tools/list` requests whose answers are still to be filtered. */
const listRequests = new Set()

function send(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`)
}

/** The parsed line, or `undefined` for a line that is not a JSON object; such a line passes as it is. */
function parse(line) {
  try {
    const message = JSON.parse(line)
    return typeof message === 'object' && message !== null ? message : undefined
  } catch {
    return undefined
  }
}

function fromClient(message) {
  if (message.method === 'initialize' && message.params?.capabilities?.roots !== undefined) {
    const capabilities = { ...message.params.capabilities }
    delete capabilities.roots
    return { ...message, params: { ...message.params, capabilities } }
  }
  if (message.method === 'tools/list' && message.id !== undefined) listRequests.add(message.id)
  return message
}

const SNAPSHOT_LINK = /^[ \t]*- \[Snapshot\]\(([^)\n]+)\)[ \t]*$/gm

/**
 * What replaces the snapshot link `link` in a tool answer: the file's content when it names a file
 * inside the output directory, else a line that says why there is none. A link left as it was is a
 * path no tool of the agent can open, and an empty replacement reads as an empty page, so the model
 * would report a page it never saw; the reason goes to stderr as well, for the run's log.
 */
function snapshotContent(link) {
  const unavailable = (reason) => {
    process.stderr.write(`browser-proxy: snapshot ${link} ${reason}\n`)
    return `[The page snapshot could not be read (${reason}). Call browser_snapshot again.]`
  }
  try {
    const root = realpathSync(workDir)
    const path = realpathSync(resolve(root, link))
    const rel = relative(root, path)
    if (rel === '' || rel.startsWith('..') || resolve(rel) === rel) return unavailable('is outside the output directory')
    const content = readFileSync(path, 'utf8').trimEnd()
    return content === '' ? unavailable('is empty') : content
  } catch (error) {
    return unavailable(`could not be read: ${error.message}`)
  }
}

function inlineSnapshots(message) {
  const content = message.result?.content
  if (!Array.isArray(content)) return message
  const inlined = content.map((part) =>
    part?.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: part.text.replace(SNAPSHOT_LINK, (_line, link) => snapshotContent(link)) }
      : part,
  )
  return { ...message, result: { ...message.result, content: inlined } }
}

function fromServer(message) {
  if (message.result?.content !== undefined) return inlineSnapshots(message)
  if (!listRequests.delete(message.id) || !Array.isArray(message.result?.tools)) return message
  return { ...message, result: { ...message.result, tools: message.result.tools.filter((tool) => OFFERED.has(tool?.name)) } }
}

createInterface({ input: process.stdin })
  .on('line', (line) => {
    const message = parse(line)
    if (message === undefined) {
      server.stdin.write(`${line}\n`)
      return
    }
    if (Array.isArray(message)) {
      // A JSON-RPC batch would carry `tools/call` entries past the checks below; no batch is forwarded.
      send(process.stdout, { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'theoclaw: batch requests are not supported' } })
      return
    }
    const name = message.params?.name
    if (message.method === 'tools/call' && !OFFERED.has(name)) {
      send(process.stdout, { jsonrpc: '2.0', id: message.id, error: { code: NOT_OFFERED, message: `theoclaw: the browser tool ${String(name)} is not offered` } })
      return
    }
    if (message.method === 'tools/call') {
      queue.push(message)
      pump()
      return
    }
    send(server.stdin, fromClient(message))
    // A cancelled call may never be answered; the calls behind it must not wait for that.
    if (message.method === 'notifications/cancelled' && inFlight !== undefined && message.params?.requestId === inFlight.id) {
      inFlight = undefined
      pump()
    }
  })
  .on('close', () => server.stdin.end())

/** Send the next queued call when none is in flight; the first call of an attached server waits for its own page. */
function pump() {
  if (inFlight !== undefined || pageState === 'opening' || queue.length === 0) return
  if (pageState === 'idle') {
    pageState = 'opening'
    send(server.stdin, {
      jsonrpc: '2.0',
      id: OPEN_PAGE_ID,
      method: 'tools/call',
      params: { name: 'browser_tabs', arguments: { action: 'new' } },
    })
    return
  }
  const next = queue.shift()
  if (next.id !== undefined && next.id !== null) inFlight = { id: next.id }
  send(server.stdin, fromClient(next))
  pump()
}

createInterface({ input: server.stdout }).on('line', (line) => {
  const message = parse(line)
  if (message?.id === OPEN_PAGE_ID) {
    pageState = 'ready'
    pump()
  } else if (message === undefined) process.stdout.write(`${line}\n`)
  else {
    send(process.stdout, fromServer(message))
    if (inFlight !== undefined && message.id === inFlight.id && (message.result !== undefined || message.error !== undefined)) {
      inFlight = undefined
      pump()
    }
  }
})

// The server ending its stdin read is how it learns the client left; a write after that is not an error here.
server.stdin.on('error', () => undefined)
// SIGHUP too: a closed terminal would otherwise kill the wrapper and leave the directory behind.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => server.kill(signal))

server.on('error', (error) => {
  process.stderr.write(`browser-proxy: could not start ${cliPath}: ${error.message}\n`)
  rmSync(workDir, { recursive: true, force: true })
  process.exit(2)
})
server.on('close', (code) => {
  rmSync(workDir, { recursive: true, force: true })
  process.exit(code ?? 1)
})
