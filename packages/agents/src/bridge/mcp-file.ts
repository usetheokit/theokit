/**
 * M107 T2.1 — the `.mcp.json` project-file loader.
 *
 * The neighbour module `mcp-resolver.ts` decides WHICH servers a request gets; this one READS the
 * `<cwd>/.mcp.json` convention (Claude Code / Cursor) from disk. Splitting them keeps SRP: one
 * decides, the other reads. The layer already shipped the rare cases (per-request resolver, registry
 * builder) and not this, the common one — so every consumer wrote it by hand.
 *
 * Fail-fast (`error-handling.md` § 2): a present-but-malformed `.mcp.json` throws a TYPED, contextual
 * error naming the path rather than silently disabling MCP. An ABSENT file is not an error — it
 * yields an empty map, because MCP is opt-in.
 *
 * **stdio only.** The remote transports (HTTP/SSE) are deliberately out: this primitive exists to be
 * an exact substitute for the hand-written loaders it replaces, and widening the accepted shape
 * would destroy the only cheap equivalence proof that migration has. Widening later is additive.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

import type { McpServerConfig, McpServersMap } from '../types.js'

/**
 * Raised when `<cwd>/.mcp.json` exists but cannot be read, is not valid JSON, or does not match the
 * expected shape — never swallowed.
 *
 * It descends from {@link TheokitAgentError} rather than bare `Error` on purpose: `isTransientError`
 * requires that hierarchy, so a parallel one would make the predicate that separates recoverable
 * from unrecoverable useless for this error. `isRetryable` stays `false` — a malformed config file
 * does not get better by trying again.
 */
export class McpFileError extends TheokitAgentError {
  override readonly name = 'McpFileError'

  constructor(message: string) {
    super(`[@theokit/agents] ${message}`)
  }
}

/** The file read from the project directory — the Claude Code / Cursor convention. */
const MCP_FILENAME = '.mcp.json'

/**
 * Load the MCP servers declared in `<cwd>/.mcp.json`.
 *
 * Returns an empty map when the file is absent (MCP is opt-in) and when the document is a valid JSON
 * object without an `mcpServers` key (a project that declares no server). Throws {@link McpFileError}
 * on a read failure, invalid JSON, or any shape violation.
 *
 * Reading is explicit — this module has no import-time side effect.
 */
export function loadMcpJson(cwd: string): McpServersMap {
  const path = join(cwd, MCP_FILENAME)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `cwd` is the caller's own project directory; the filename is the fixed convention above
  if (!existsSync(path)) return {}
  let text: string
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path, already existence-checked one line above
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new McpFileError(`failed to read ${path}: ${descrever(err)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new McpFileError(`${path} is not valid JSON: ${descrever(err)}`)
  }
  return parseMcpJson(parsed, path)
}

/** Validate a parsed `.mcp.json` document into an {@link McpServersMap}. Internal to the loader. */
function parseMcpJson(raw: unknown, source: string): McpServersMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new McpFileError(`${source}: root must be a JSON object with an "mcpServers" key.`)
  }
  const serversRaw = (raw as Record<string, unknown>).mcpServers
  if (serversRaw === undefined) return {}
  if (typeof serversRaw !== 'object' || serversRaw === null || Array.isArray(serversRaw)) {
    throw new McpFileError(`${source}: "mcpServers" must be an object keyed by server name.`)
  }
  const out: McpServersMap = {}
  for (const [name, entryRaw] of Object.entries(serversRaw as Record<string, unknown>)) {
    out[name] = parseServerEntry(name, entryRaw, source)
  }
  return out
}

/** Validate one stdio server entry. Every violation is a typed failure naming the server. */
function parseServerEntry(name: string, entryRaw: unknown, source: string): McpServerConfig {
  if (typeof entryRaw !== 'object' || entryRaw === null || Array.isArray(entryRaw)) {
    throw new McpFileError(`${source}: server "${name}" must be an object.`)
  }
  const entry = entryRaw as Record<string, unknown>
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    throw new McpFileError(`${source}: server "${name}" requires a non-empty "command" string.`)
  }
  if (entry.args !== undefined && !isStringArray(entry.args)) {
    throw new McpFileError(`${source}: server "${name}" field "args" must be a string array.`)
  }
  if (entry.env !== undefined && !isStringRecord(entry.env)) {
    throw new McpFileError(`${source}: server "${name}" field "env" must be a string map.`)
  }
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
    throw new McpFileError(`${source}: server "${name}" field "cwd" must be a string.`)
  }
  const built: McpServerConfig = { command: entry.command }
  if (entry.args !== undefined) built.args = entry.args
  if (entry.env !== undefined) built.env = entry.env
  if (entry.cwd !== undefined) built.cwd = entry.cwd
  return built
}

/** Render an unknown thrown value for a diagnostic message without losing it. */
function descrever(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  )
}
