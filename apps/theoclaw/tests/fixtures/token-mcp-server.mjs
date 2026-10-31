#!/usr/bin/env node
/**
 * A stdio MCP server with one tool, `vault_lookup`, that returns the token passed in its env.
 *
 * It speaks newline-delimited JSON-RPC (the MCP stdio transport): `initialize`, `tools/list` and
 * `tools/call`, and ignores notifications. Every `tools/call` appends one line to the file
 * `FIXTURE_LOG` names, so a test can count the calls the model made; the call returns
 * `FIXTURE_TOKEN`. Its argument is `name`, not a path, so TheoClaw's path veto never judges it.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const TOOL = {
  name: 'vault_lookup',
  description: 'Look up the value stored in the vault under a name. Returns the stored value.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

const HANDLERS = {
  initialize: (params) => ({
    protocolVersion: params?.protocolVersion ?? '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'token-mcp-server', version: '1.0.0' },
  }),
  'tools/list': () => ({ tools: [TOOL] }),
  'tools/call': (params) => {
    if (process.env.FIXTURE_LOG) appendFileSync(process.env.FIXTURE_LOG, `tools/call ${JSON.stringify(params?.arguments ?? {})}\n`)
    return { content: [{ type: 'text', text: process.env.FIXTURE_TOKEN ?? '' }] }
  },
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const handler = HANDLERS[message.method]
  if (handler === undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })}\n`)
    return
  }
  reply(message.id, handler(message.params))
})
