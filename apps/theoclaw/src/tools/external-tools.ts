import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from '@theokit/sdk'
import { z } from 'zod'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { BUILT_SERVER_NAMES, BUILT_TOOL_NAMES, CONTROL_TOOL_NAMES } from './tool-names.js'
import type { ProtectedPath } from './tool-settings.js'

const VARIABLE = 'THEOCLAW_EXTERNAL_TOOLS'

/** The item that makes the SDK honour an HTTP server's `auth` (OAuth included). */
const MCP_AUTH_GAP_ITEM = 'B-680'

/** One ACP coding agent the `/control` agent may delegate a message to, as one tool. */
export interface AcpAgentConfig {
  /** The tool name the model calls. */
  readonly name: string
  readonly description: string
  /** An absolute path, or a bare name looked up on `PATH`. */
  readonly command: string
  readonly args?: readonly string[]
  /** How long one ACP request may wait for the agent, in milliseconds. */
  readonly timeoutMs?: number
}

/** What the external tools file names, validated, plus what the output mask and the start need. */
export interface ExternalTools {
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>
  readonly acpAgents: readonly AcpAgentConfig[]
  /** Every header and env value of the file of at least 8 characters: the output mask hides them. */
  readonly secrets: readonly string[]
  /** One line naming the servers and agents, or none when the file names neither. */
  readonly startLine: string | undefined
}

type Env = Readonly<Record<string, string | undefined>>
type ReadFile = (path: string, encoding: 'utf8') => string

const NONE: ExternalTools = { mcpServers: {}, acpAgents: [], secrets: [], startLine: undefined }

// A name the SDK's `sanitize` (`[^a-zA-Z0-9-]+` to `_`, edge hyphens stripped) leaves unchanged,
// so two distinct servers can never share one tool prefix.
const SERVER_NAME = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const ACP_NAME = /^[a-z][a-z0-9_]{0,63}$/
const MCP_TOOL_PREFIX = 'mcp_'
// The SDK's builtin names (`shell` is withheld, the memory tools are reserved even with memory off):
// an ACP tool under one would fail `Agent.create` on every `/control` turn instead of at start.
const SDK_RESERVED_TOOL_NAMES: readonly string[] = ['shell', 'memory_search', 'memory_get']
// The output mask has no minimum length: a short value ("1", "/bin") would blank every match in
// unrelated output, and a value that short protects nothing.
const MIN_MASKED_LENGTH = 8

// A command with a slash must be absolute: a relative one resolves inside a directory the model
// may write (the ACP agent runs in the tool root).
const command = z
  .string()
  .min(1)
  .refine((value) => !value.includes('/') || isAbsolute(value), {
    message: 'must be an absolute path or a bare name looked up on PATH',
  })
const stringMap = z.record(z.string(), z.string())
const timeout = z.number().int().positive()

const stdioServer = z.strictObject({
  type: z.literal('stdio').optional(),
  command,
  args: z.array(z.string()).optional(),
  env: stringMap.optional(),
  cwd: z.string().min(1).optional(),
  requestTimeoutMs: timeout.optional(),
  // `all` would hand a third-party binary every host secret, the model key included.
  envPolicy: z.enum(['inherit-scrubbed', 'core']).optional(),
})

const httpServer = z.strictObject({
  type: z.enum(['http', 'sse']).optional(),
  url: z.url({ protocol: /^https?$/ }),
  headers: stringMap.optional(),
  requestTimeoutMs: timeout.optional(),
})

const acpAgent = z.strictObject({
  name: z.string().regex(ACP_NAME, 'must match ^[a-z][a-z0-9_]{0,63}$'),
  description: z.string().min(1),
  command,
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().positive().optional(),
})

const file = z.strictObject({
  mcpServers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  acpAgents: z.array(acpAgent).optional(),
})

function refuse(path: string, detail: string): never {
  throw new TheoClawConfigError(`${VARIABLE} ${path}: ${detail}`, { variable: VARIABLE })
}

function parseWith<Schema extends z.ZodType>(schema: Schema, value: unknown, path: string, prefix: string[]): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const at = [...prefix, ...(issue?.path ?? []).map(String)].join('.')
  return refuse(path, `${at === '' ? '(root)' : at}: ${issue?.message ?? 'invalid'}`)
}

function readJson(path: string, readFile: ReadFile): unknown {
  let text: string
  try {
    text = readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message
    return refuse(path, `cannot read the file: ${code}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Not V8's message: it quotes the text around the error, which may be a header value, and the
    // output mask is built from the parsed file, so nothing would hide it.
    return refuse(path, 'is not JSON')
  }
}

/** One server: HTTP when it names a `url`, stdio otherwise; an HTTP `auth` is refused by name. */
function parseServer(name: string, raw: Readonly<Record<string, unknown>>, path: string): McpServerConfig {
  if (!SERVER_NAME.test(name)) {
    refuse(path, `mcpServers.${name}: a server name must match ${SERVER_NAME.source}, so the SDK names its tools mcp_${name}_<tool> unchanged`)
  }
  if (BUILT_SERVER_NAMES.includes(name)) {
    refuse(path, `mcpServers.${name}: ${name} is the name of a TheoClaw server (THEOCLAW_BROWSER), which this one would replace`)
  }
  if ('url' in raw) {
    if ('auth' in raw) {
      refuse(
        path,
        `mcpServers.${name}.auth is not honoured by @theokit/sdk 5.11.0 (${MCP_AUTH_GAP_ITEM}): the request would go out without credentials; pass the token in headers`,
      )
    }
    return parseWith(httpServer, raw, path, ['mcpServers', name]) as McpHttpServerConfig
  }
  return parseWith(stdioServer, raw, path, ['mcpServers', name]) as McpStdioServerConfig
}

function checkAcpNames(agents: readonly AcpAgentConfig[], path: string): void {
  const seen = new Set<string>()
  for (const { name } of agents) {
    if (name.startsWith(MCP_TOOL_PREFIX)) refuse(path, `acpAgents: ${name} starts with ${MCP_TOOL_PREFIX}, the prefix the SDK gives MCP tools`)
    if (BUILT_TOOL_NAMES.includes(name) || CONTROL_TOOL_NAMES.includes(name)) refuse(path, `acpAgents: ${name} is the name of a TheoClaw tool`)
    if (SDK_RESERVED_TOOL_NAMES.includes(name)) refuse(path, `acpAgents: ${name} is a name the SDK reserves`)
    if (seen.has(name)) refuse(path, `acpAgents: ${name} is named twice`)
    seen.add(name)
  }
}

function secretsOf(servers: Readonly<Record<string, McpServerConfig>>): string[] {
  return Object.values(servers).flatMap((server) => {
    const values = 'url' in server ? server.headers : server.env
    return Object.values(values ?? {}).filter((value) => value.length >= MIN_MASKED_LENGTH)
  })
}

function counted(count: number, noun: string, names: readonly string[]): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'} (${names.join(', ')})`
}

function startLineOf(servers: readonly string[], agents: readonly AcpAgentConfig[]): string | undefined {
  const parts = [
    ...(servers.length === 0 ? [] : [counted(servers.length, 'MCP server', servers)]),
    ...(agents.length === 0 ? [] : [counted(agents.length, 'ACP agent', agents.map((agent) => agent.name))]),
  ]
  return parts.length === 0 ? undefined : `tools: external: ${parts.join(', ')}`
}

/**
 * Read and validate the file `THEOCLAW_EXTERNAL_TOOLS` names, at start (plan D1). Unset or blank:
 * no server and no agent. Throws `TheoClawConfigError` naming the file and the key for an unreadable
 * or malformed file, an HTTP `auth` the SDK would ignore, `envPolicy: "all"`, a relative command, a
 * server name the SDK would rewrite, and an ACP name that collides with another tool.
 */
export function resolveExternalTools(env: Env, readFile: ReadFile = readFileSync): ExternalTools {
  const path = env[VARIABLE]?.trim()
  if (path === undefined || path === '') return NONE
  const parsed = parseWith(file, readJson(path, readFile), path, [])
  const mcpServers: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(parsed.mcpServers ?? {})) mcpServers[name] = parseServer(name, raw, path)
  const acpAgents: AcpAgentConfig[] = parsed.acpAgents ?? []
  checkAcpNames(acpAgents, path)
  return {
    mcpServers,
    acpAgents,
    secrets: secretsOf(mcpServers),
    startLine: startLineOf(Object.keys(mcpServers), acpAgents),
  }
}

/**
 * The paths the next start would execute from: every absolute stdio command and working directory.
 * With host tools on, the start refuses any of them inside a root the sandboxed shell can write.
 */
export function externalToolPaths(external: ExternalTools): ProtectedPath[] {
  return Object.values(external.mcpServers).flatMap((server) =>
    'url' in server
      ? []
      : [server.command, ...(server.cwd === undefined ? [] : [server.cwd])]
          .filter((path) => isAbsolute(path))
          .map((path) => ({ path, variable: VARIABLE })),
  )
}
