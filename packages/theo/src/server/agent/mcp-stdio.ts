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

/**
 * Shared line handling: parse one line and answer it with `respond`. Blank line → `null`; malformed
 * JSON → a `-32700` envelope. Never throws on bad input.
 */
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
  const payload: unknown = await (await respond(body)).json()
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
  await pump(streams, (line) => handleMcpStdioLine(line, mod, name, appResources))
}

/** Write one answered line (if any) to the sink. */
async function pump(
  streams: StdioStreams,
  answer: (line: string) => Promise<string | null>,
): Promise<void> {
  for await (const line of streams.lines) {
    const out = await answer(line)
    if (out !== null) streams.write(`${out}\n`)
  }
}

/**
 * The stdio loop for a plain list of tools (no agent module); see {@link handleMcpToolsJsonRpc}.
 * The tools have no approval gate: whoever passes a tool in decides it may run unattended.
 * Rejects before reading any input when two tools share a name.
 */
export async function serveMcpToolsStdio(
  tools: readonly CustomTool[],
  name: string,
  streams: StdioStreams,
): Promise<void> {
  // Validate eagerly (a duplicate must fail at call time, not on the first request).
  await handleMcpToolsJsonRpc(tools, name, null)
  await pump(streams, (line) =>
    answerLine(line, (body) => handleMcpToolsJsonRpc(tools, name, body)),
  )
}
