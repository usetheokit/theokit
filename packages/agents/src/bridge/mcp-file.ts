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
 * **M112 — the `stdio only` scope is over, and degradation is now PER ENTRY.**
 *
 * The previous version of this docblock said: *"remote transports (HTTP/SSE) are deliberately out …
 * widening later is **additive**"*. The reason was good and the exit criterion was written down: be
 * an **exact** substitute for the hand-written loaders. That migration finished in M107; the deadline
 * has passed.
 *
 * **What this module does NOT do, and the finding that shrank M112:** it does not build transports. The SDK
 * already ships `McpServerConfig = McpStdioServerConfig | McpHttpServerConfig`, with `type`/`url`/
 * `headers` (*"Passed through. `Authorization` works here."*), `auth` (OAuth 2.1 PKCE) e
 * `requestTimeoutMs` (`AbortSignal.timeout`, typed error, 30 s default). This file declared a
 * **narrower** `McpServerConfig` and refused what the SDK accepts — two owners of the same fact.
 * M112 stops narrowing; no new dependency was added.
 *
 * **Degradation is per entry, not per file — and that is NOT swallowing an error.** Before, one entry
 * the parser did not understand took down the whole map: a `.mcp.json` with a perfect stdio server
 * and one `type: http` produced `McpFileError`, and the stdio server was lost with it. Fail-closed at
 * the **wrong radius** — refusing *one entry* is correct; refusing *the file* turns "that server is
 * not supported" into "you have no MCP at all". The error is still typed, still names the entry, and
 * is still visible through the `onWarn` channel. An **unparseable** file (broken JSON, an
 * `mcpServers` that is not an object) still throws, because there are no entries to separate there.
 *
 * Both TS peers decide it this way, through different idioms: `gemini-cli` runs `Promise.all` over
 * promises that **never reject** (the `catch` closes the client, emits a diagnostic naming the server
 * and marks `DISCONNECTED` without rethrowing); `opencode` returns `Effect.succeed({ status:
 * 'failed' })`. Neither lets one server take down the others.
 *
 * **Secrets:** the value of `headers` never enters a warning. The peers **diverge** here —
 * `gemini-cli` redacts in 18 places, `opencode` in zero — and a peer is not precedent for security.
 * The internal precedent decides: `AuthProvider` states that it never exposes token material, and
 * `.mcp.json` is a **project** file, which can be committed by accident.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

import type { McpServerConfig, McpServersMap } from '../types.js'

/**
 * The channel by which a skipped entry is NAMED. Without it, narrowing the blast radius would turn
 * into fail-open.
 *
 * **`onWarn` is optional; the WARNING is not.** Omitted, warnings go to `stderr` — never nowhere.
 * The M112 review measured why that matters: the only production caller (the agent-builder's
 * `agents/chat.ts:530`) did NOT pass `onWarn`, and the whole defence against `error-handling.md § 2`
 * — repeated across four artifacts — rested on the phrase *"the error stays visible on the channel"*.
 * With no subscriber it did not: the entry was dropped in total silence, and the user saw "the tool
 * disappeared" and nothing else.
 */
interface LoadMcpJsonOptions {
  onWarn?: (warning: string) => void
}

/** The effective channel: the caller's, or `stderr`. Never the empty one. */
function warningChannel(opts: LoadMcpJsonOptions): (warning: string) => void {
  return (
    opts.onWarn ??
    ((warning: string) => {
      process.stderr.write(`[@theokit/agents] ${warning}\n`)
    })
  )
}

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
export function loadMcpJson(cwd: string, opts: LoadMcpJsonOptions = {}): McpServersMap {
  const path = join(cwd, MCP_FILENAME)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `cwd` is the caller's own project directory; the filename is the fixed convention above
  if (!existsSync(path)) return {}
  let text: string
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path, already existence-checked one line above
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new McpFileError(`failed to read ${path}: ${describeIt(err)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new McpFileError(`${path} is not valid JSON: ${describeIt(err)}`)
  }
  return parseMcpJson(parsed, path, warningChannel(opts))
}

/** Validate a parsed `.mcp.json` document into an {@link McpServersMap}. Internal to the loader. */
function parseMcpJson(raw: unknown, source: string, onWarn: (a: string) => void): McpServersMap {
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
    // THE FAILURE RADIUS IS THE ENTRY. An entry that does not validate is omitted and NAMED; its
    // neighbours still come through.
    const reason = validateEntry(name, entryRaw)
    if (reason !== undefined) {
      // The message never carries a `headers` value — `validateEntry` returns only the reason, and it
      // is built from the SHAPE, never from the content.
      onWarn(`${source}: server "${name}" ignored — ${reason}`)
      continue
    }
    out[name] = buildEntry(entryRaw as Record<string, unknown>)
  }
  return out
}

/**
 * Validates ONE entry against the SDK union. Returns the **reason** for the refusal, or `undefined`
 * when the entry is valid.
 *
 * Does not throw: the caller decides the radius, and the radius is the entry. And it returns a
 * **reason**, not the entry — so no value from the file (`headers` in particular) can escape into the
 * message.
 */
function validateEntry(name: string, entryRaw: unknown): string | undefined {
  if (typeof entryRaw !== 'object' || entryRaw === null || Array.isArray(entryRaw)) {
    return 'the entry must be an object.'
  }
  const entry = entryRaw as Record<string, unknown>
  const hasUrl = entry.url !== undefined
  const hasCommand = entry.command !== undefined

  // The SDK union is DISCRIMINATED: an entry satisfying both branches is neither, and guessing which
  // one would be choosing for the user in silence.
  if (hasUrl && hasCommand) return 'declares both "command" and "url" — pick one transport.'
  if (!hasUrl && !hasCommand) return 'requires "command" (stdio) or "url" (http/sse).'

  return hasUrl ? validateRemote(entry) : validateStdio(entry)
}

/** The stdio branch — what this module already validated before M112, untouched. */
function validateStdio(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    return 'field "command" must be a non-empty string.'
  }
  if (entry.args !== undefined && !isStringArray(entry.args))
    return 'field "args" must be an array of strings.'
  if (entry.env !== undefined && !isStringRecord(entry.env))
    return 'field "env" must be a map of strings.'
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string')
    return 'field "cwd" must be a string.'
  return undefined
}

/**
 * The remote branch. The shape is the SDK's (`McpHttpServerConfig`); this module **validates and
 * forwards**, never normalizes — deciding the default for `type` here would be a second oracle over
 * the same fact.
 */
function validateRemote(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.url !== 'string' || entry.url.length === 0) {
    return 'field "url" must be a non-empty string.'
  }
  try {
    new URL(entry.url)
  } catch {
    return 'field "url" is not a valid URL.'
  }
  if (entry.type !== undefined && entry.type !== 'http' && entry.type !== 'sse') {
    return 'field "type" must be "http" or "sse".'
  }
  if (entry.headers !== undefined && !isStringRecord(entry.headers)) {
    // The message speaks of the SHAPE. Never of the content — this is the field that carries `Authorization`.
    return 'field "headers" must be a map of strings.'
  }
  if (entry.requestTimeoutMs !== undefined && typeof entry.requestTimeoutMs !== 'number') {
    return 'field "requestTimeoutMs" must be a number.'
  }
  return undefined
}

/**
 * Builds the entry from an ALLOWLIST of fields, never forwarding the raw object.
 *
 * ## Why this exists, and what happened when it did not
 *
 * The first version of M112 returned `entryRaw` directly — it looked harmless, since validation had
 * just passed. It was not. The review measured what crossed:
 *
 * ```
 * {"evil":{"command":"node","args":["evil.js"],"envPolicy":"all","inventedField":{"x":1}}}
 * ```
 *
 * `envPolicy` is NOT just another field. The SDK documents it as: *"drop secret-like host vars
 * (`*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`/`*_AUTH*`) **so a third-party MCP server binary cannot
 * exfiltrate host secrets via the environment**. Pass `"all"` to restore full inheritance."*
 *
 * `.mcp.json` is a PROJECT file, read from `process.cwd()`. Forwarded raw, a repository — including a
 * trusted one, which is the normal case — could hand `ANTHROPIC_API_KEY`, `NPM_TOKEN` and the rest of
 * the environment to a third-party binary with ONE line of JSON. And this layer was the last place
 * that could strip the field.
 *
 * The irony is pointed and worth recording: the same milestone wrote a whole ADR about not leaking
 * the value of a ~40-character header and, in the same diff, opened a channel to the entire
 * environment. Validating is not sanitizing — the allowlist is what separates the two.
 *
 * ## What does NOT get in, and why
 *
 * `envPolicy` is left out DELIBERATELY: it is a host posture decision, and the SDK accepts it from
 * the caller. A file committed to the repository is no place to loosen a process-level defence.
 * Whoever wants full inheritance declares it in the code that builds the agent, where a human
 * reviews it.
 */
function buildEntry(entry: Record<string, unknown>): McpServerConfig {
  if (entry.url !== undefined) {
    const remote: Record<string, unknown> = { url: entry.url }
    if (entry.type !== undefined) remote.type = entry.type
    if (entry.headers !== undefined) remote.headers = entry.headers
    if (entry.auth !== undefined) remote.auth = entry.auth
    if (entry.requestTimeoutMs !== undefined) remote.requestTimeoutMs = entry.requestTimeoutMs
    return remote as McpServerConfig
  }
  const stdio: Record<string, unknown> = { command: entry.command }
  if (entry.args !== undefined) stdio.args = entry.args
  if (entry.env !== undefined) stdio.env = entry.env
  if (entry.cwd !== undefined) stdio.cwd = entry.cwd
  return stdio as McpServerConfig
}

/** Render an unknown thrown value for a diagnostic message without losing it. */
function describeIt(err: unknown): string {
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
