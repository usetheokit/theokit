#!/usr/bin/env node
// A dependency-free stdio MCP server for the migration live test (B-375, T5.1): one tool,
// `reveal_token`, whose result is the token given as argv[2]. Newline-delimited JSON-RPC 2.0 on
// stdin/stdout; `initialize`, `tools/list` and `tools/call` are answered, notifications ignored.
import { createInterface } from 'node:readline'

const token = process.argv[2] ?? ''
const TOOL = {
  name: 'reveal_token',
  description: 'Returns the secret token of this server. Call it when asked for the MCP token.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function answer(request) {
  const { id, method, params } = request
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'token-mcp-server', version: '1.0.0' },
    })
  }
  if (method === 'tools/list') return reply(id, { tools: [TOOL] })
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) return fail(id, -32602, `unknown tool ${String(params?.name)}`)
    return reply(id, { content: [{ type: 'text', text: token }] })
  }
  if (method === 'ping') return reply(id, {})
  return fail(id, -32601, `method not found: ${String(method)}`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return fail(null, -32700, 'parse error')
  }
  // A notification (no id) needs no answer.
  if (request.id === undefined || request.id === null) return
  answer(request)
})
