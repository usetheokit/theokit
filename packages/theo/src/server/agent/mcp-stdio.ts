/**
 * MCP stdio transport (M16 follow-up) — expose a TheoKit agent as an MCP server over stdin/stdout,
 * the sibling of the M16 HTTP route (`POST /api/agents/<name>/mcp`). A desktop MCP client (e.g.
 * Claude Desktop) spawns `theokit mcp <agent>` and speaks newline-delimited JSON-RPC over the pipe.
 *
 * This is a TRANSPORT over the framework's OWN {@link handleMcpJsonRpc} — it reuses the exact handler
 * the HTTP route uses; it calls no LLM, spawns no MCP client, and reimplements no runtime (G2 /
 * sdk-runtime.md). Distinct from the SDK's MCP CLIENT stdio (which spawns external MCP servers via
 * `mcpServers` command/args) — that stays SDK-side. Here TheoKit is the SERVER. The framework-side
 * placement of this server-exposure transport is recorded in ADR-0042 (refining ADR-0040's M16 note).
 */
import type { CustomTool } from '@theokit/sdk'

import type { AppResource } from './mcp-app-resources.js'
import { handleMcpJsonRpc, handleMcpToolsJsonRpc } from './mcp-handler.js'

/** Parse one line and answer it via `respond`; `null` for a blank line, `-32700` for bad JSON. */
async function answerLine(
  line: string,
  respond: (body: unknown) => Promise<Response>,
): Promise<string | null> {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  let body: unknown
  try {
    body = JSON.parse(trimmed)
  } catch {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
  }
  const response = await respond(body)
  const payload: unknown = await response.json()
  return JSON.stringify(payload)
}

/**
 * Handle one newline-delimited JSON-RPC line. Returns the response line to write to stdout, or
 * `null` for a blank line (nothing to emit). A malformed JSON line yields a `-32700` (Parse error)
 * envelope — never throws, so the stdio loop never dies on bad input.
 */
export function handleMcpStdioLine(
  line: string,
  mod: unknown,
  name: string,
  appResources: readonly AppResource[] = [],
): Promise<string | null> {
  return answerLine(line, (body) => handleMcpJsonRpc(mod, name, body, appResources))
}

/** A minimal readable line source (an async iterable of lines) + a writable sink. */
export interface StdioStreams {
  /** Async iterable of newline-delimited input lines (e.g. `readline.createInterface({ input })`). */
  lines: AsyncIterable<string>
  /** Write a response line (the caller appends no newline). */
  write: (line: string) => void
}

/**
 * Drive the MCP stdio server loop: for each input line, dispatch via {@link handleMcpStdioLine} and
 * write the response line (with a trailing `\n`). Returns when the input stream ends (EOF).
 */
export async function serveMcpStdio(
  mod: unknown,
  name: string,
  appResources: readonly AppResource[],
  streams: StdioStreams,
): Promise<void> {
  for await (const line of streams.lines) {
    const out = await handleMcpStdioLine(line, mod, name, appResources)
    if (out !== null) streams.write(`${out}\n`)
  }
}

/**
 * Stdio loop for a plain list of tools (no agent module), the sibling of {@link serveMcpStdio}.
 * No approval gate: whoever passes a tool in decides it may run unattended. Duplicate tool names
 * are refused (rejects) before any line is read.
 */
export async function serveMcpToolsStdio(
  tools: readonly CustomTool[],
  name: string,
  streams: StdioStreams,
): Promise<void> {
  const respond = (body: unknown): Promise<Response> => handleMcpToolsJsonRpc(tools, name, body)
  // Validate eagerly so a duplicate fails the call, not the first request.
  await respond(null)
  for await (const line of streams.lines) {
    const out = await answerLine(line, respond)
    if (out !== null) streams.write(`${out}\n`)
  }
}
