/**
 * Servers are read by `loadMcpServersFile` from `@theokit/agents/bridge` (#2599; its gaps, usetheokit/theokit#2657,
 * are closed). What it still does not cover stays here: the `acpAgents` key, refusing a TheoClaw server name,
 * an http(s)-only `url`, and the shape of an OAuth `auth` entry (`oauth` required, no `CLIENT_SECRET`).
 */
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import type { McpServerConfig } from '@theokit/sdk'
import { loadMcpServersFile, McpFileError, mcpSecretValues } from '@theokit/agents/bridge'
import { z } from 'zod'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { BUILT_SERVER_NAMES, BUILT_TOOL_NAMES, CONTROL_TOOL_NAMES } from './tool-names.js'
import type { ProtectedPath } from './tool-settings.js'

const VARIABLE = 'THEOCLAW_EXTERNAL_TOOLS'

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
// Node clamps a delay above 2^31 - 1 ms to 1 ms, so a longer timeout would fail every call at once.
const MAX_TIMER_MS = 2_147_483_647
const timeout = z.number().int().positive().max(MAX_TIMER_MS)

// The SDK sends a bearer only for `auth.oauth` (a stored token, refreshed, or the PKCE flow) and
// refuses an `auth` without it at `Agent.create`, so the file must carry it. `CLIENT_SECRET` is not
// accepted: SDK 5.17.0 sends only `client_id` to the token endpoint (code exchange and refresh), so a
// confidential client would pass validation and then fail to get a token.
const mcpAuth = z.strictObject({
  CLIENT_ID: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  oauth: z.strictObject({
    authorizationEndpoint: z.url({ protocol: /^https?$/ }),
    tokenEndpoint: z.url({ protocol: /^https?$/ }),
    redirectMode: z.enum(['manual', 'localhost']),
    localhostPort: z.number().int().min(0).max(65_535).optional(),
    timeoutMs: timeout.optional(),
  }),
})

// Only what the framework loader leaves open: it checks that `url` parses, not that it is http(s).
const remoteExtras = z.looseObject({ url: z.url({ protocol: /^https?$/ }), auth: mcpAuth.optional() })

const acpAgent = z.strictObject({
  name: z.string().regex(ACP_NAME, 'must match ^[a-z][a-z0-9_]{0,63}$'),
  description: z.string().min(1),
  // A command with `=` is refused (kept from when the agent started through `env -i`, which read it as a variable).
  command: command.refine((value) => !value.includes('='), { message: 'may not contain "="' }),
  args: z.array(z.string()).optional(),
  timeoutMs: timeout.optional(),
})

// The loader accepts a document with other keys; this file does not, so a typo such as `mcpServer` still fails.
const file = z.strictObject({ mcpServers: z.unknown().optional(), acpAgents: z.array(acpAgent).optional() })

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

/** The checks the framework loader leaves to the caller, for one server of the file. */
function checkServer(name: string, raw: unknown, path: string): void {
  if (BUILT_SERVER_NAMES.includes(name)) {
    refuse(path, `mcpServers.${name}: ${name} is the name of a TheoClaw server (THEOCLAW_BROWSER), which this one would replace`)
  }
  if (typeof raw === 'object' && raw !== null && 'url' in raw) parseWith(remoteExtras, raw, path, ['mcpServers', name])
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

/** The values the output mask hides for `servers`: every header and env value of at least 8 characters. */
export function secretsOf(servers: Readonly<Record<string, McpServerConfig>>): string[] {
  return mcpSecretValues(servers, MIN_MASKED_LENGTH)
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
 * or malformed file, an HTTP `auth` without `oauth` (the SDK refuses it), `envPolicy: "all"`, a relative command, a
 * server name the SDK would rewrite, and an ACP name that collides with another tool.
 */
export function resolveExternalTools(env: Env, readFile: ReadFile = readFileSync): ExternalTools {
  const path = env[VARIABLE]?.trim()
  if (path === undefined || path === '') return NONE
  // One read serves both the loader and the `acpAgents` parse.
  let text: string | undefined
  const cached: ReadFile = (target, encoding) => (text ??= readFile(target, encoding))
  const document = readJson(path, cached) as { mcpServers?: Record<string, unknown> }
  const parsed = parseWith(file, document, path, [])
  // The loader reports a server the operator policy does not admit, and an unset `${VAR}` it leaves as
  // written, only as warnings. Either would start without a tool or with a placeholder as credential: refuse.
  const warnings: string[] = []
  let mcpServers: Record<string, McpServerConfig>
  try {
    mcpServers = { ...loadMcpServersFile(path, { readFile: cached, env: env as Record<string, string | undefined>, onWarn: (warning) => warnings.push(warning) }) } as Record<string, McpServerConfig>
  } catch (error) {
    if (error instanceof McpFileError) return refuse(path, error.message)
    throw error
  }
  if (warnings[0] !== undefined) refuse(path, warnings[0])
  for (const name of Object.keys(mcpServers)) checkServer(name, document.mcpServers?.[name], path)
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
 * The paths the next start would execute from: the external tools file itself, which names the
 * processes it spawns outside the sandbox, and every absolute stdio command and working directory.
 * With host tools on, the start refuses any of them inside a root the sandboxed shell can write.
 */
export function externalToolPaths(env: Env, external: ExternalTools): ProtectedPath[] {
  const file = env[VARIABLE]?.trim()
  const executed = Object.values(external.mcpServers).flatMap((server) =>
    'url' in server ? [] : [server.command, ...(server.cwd === undefined ? [] : [server.cwd])],
  )
  const paths = [...(file === undefined || file === '' ? [] : [file]), ...executed.filter((path) => isAbsolute(path))]
  return paths.map((path) => ({ path, variable: VARIABLE }))
}
