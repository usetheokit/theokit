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
 * - `PLAYWRIGHT_MCP_*` variables are dropped, so the environment cannot widen the server's config.
 *
 * Exits with the server's status, 1 when it ended on a signal (SIGTERM, SIGINT and SIGHUP are
 * forwarded to it), 2 when started without a CLI or when the server cannot be spawned. A SIGKILL
 * cannot be forwarded: the server then exits on its stdin closing and the directory stays behind.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function fromServer(message) {
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
    const name = message.params?.name
    if (message.method === 'tools/call' && !OFFERED.has(name)) {
      send(process.stdout, { jsonrpc: '2.0', id: message.id, error: { code: NOT_OFFERED, message: `theoclaw: the browser tool ${String(name)} is not offered` } })
      return
    }
    send(server.stdin, fromClient(message))
  })
  .on('close', () => server.stdin.end())

createInterface({ input: server.stdout }).on('line', (line) => {
  const message = parse(line)
  if (message === undefined) process.stdout.write(`${line}\n`)
  else send(process.stdout, fromServer(message))
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
