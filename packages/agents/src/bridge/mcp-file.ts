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
 * **M112 — o escopo `stdio only` acabou, e a degradação passou a ser por ENTRADA.**
 *
 * A versão anterior deste docblock dizia: *"os transportes remotos (HTTP/SSE) estão deliberadamente
 * fora … alargar depois é **aditivo**"*. A razão era boa e o critério de saída estava escrito: ser
 * substituta **exata** dos carregadores escritos à mão. Essa migração terminou no M107; o prazo venceu.
 *
 * **O que este módulo NÃO faz, e é o achado que encolheu o M112:** ele não constrói transporte. O SDK
 * já entrega `McpServerConfig = McpStdioServerConfig | McpHttpServerConfig`, com `type`/`url`/
 * `headers` (*"Passed through. `Authorization` works here."*), `auth` (OAuth 2.1 PKCE) e
 * `requestTimeoutMs` (`AbortSignal.timeout`, erro tipado, default 30 s). Este arquivo declarava um
 * `McpServerConfig` mais **estreito** e recusava o que o SDK aceita — dois donos do mesmo fato. O
 * M112 para de estreitar; nenhuma dependência nova entrou.
 *
 * **A degradação é por entrada, não por arquivo — e isso NÃO é engolir erro.** Antes, uma entrada que
 * o parser não entendia derrubava o mapa inteiro: um `.mcp.json` com um stdio perfeito e um `type:
 * http` produzia `McpFileError`, e o stdio era perdido junto. Fail-closed no **raio errado** — recusar
 * *uma entrada* é correto; recusar *o arquivo* transforma "esse servidor não é suportado" em "você não
 * tem MCP nenhum". O erro segue tipado, segue nomeando a entrada, e segue visível pelo canal `onWarn`.
 * O arquivo **impartível** (JSON quebrado, `mcpServers` que não é objeto) continua lançando, porque
 * ali não há entradas para separar.
 *
 * Os dois peers TS decidem assim, por idiomas diferentes: o `gemini-cli` roda `Promise.all` sobre
 * promises que **nunca rejeitam** (o `catch` fecha o cliente, emite diagnóstico nomeando o servidor e
 * marca `DISCONNECTED` sem relançar); o `opencode` devolve `Effect.succeed({ status: 'failed' })`.
 * Nenhum deixa um servidor derrubar os outros.
 *
 * **Segredo:** o valor de `headers` nunca entra num aviso. Os peers **divergem** aqui — `gemini-cli`
 * redige em 18 sítios, `opencode` em zero —, e um peer não é precedente para segurança. Decide o
 * precedente interno: `AuthProvider` declara que nunca expõe material de token, e o `.mcp.json` é
 * arquivo de **projeto**, que pode ser commitado por engano.
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
export interface LoadMcpJsonOptions {
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
    throw new McpFileError(`failed to read ${path}: ${descrever(err)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new McpFileError(`${path} is not valid JSON: ${descrever(err)}`)
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
    // O RAIO DA FALHA É A ENTRADA. Uma entrada que não valida é omitida e NOMEADA; as vizinhas sobem.
    const motivo = validarEntrada(name, entryRaw)
    if (motivo !== undefined) {
      // A mensagem nunca carrega valor de `headers` — `validarEntrada` só devolve o motivo, e o motivo
      // é construído a partir da FORMA, nunca do conteúdo.
      onWarn(`${source}: server "${name}" ignorado — ${motivo}`)
      continue
    }
    out[name] = buildEntry(entryRaw as Record<string, unknown>)
  }
  return out
}

/**
 * Valida UMA entrada contra a união do SDK. Devolve o **motivo** da recusa, ou `undefined` quando a
 * entrada é válida.
 *
 * Não lança: quem decide o raio é o chamador, e o raio é a entrada. E devolve **motivo**, não a
 * entrada — assim nenhum valor do arquivo (em particular `headers`) pode escapar para a mensagem.
 */
function validarEntrada(name: string, entryRaw: unknown): string | undefined {
  if (typeof entryRaw !== 'object' || entryRaw === null || Array.isArray(entryRaw)) {
    return 'a entrada deve ser um objeto.'
  }
  const entry = entryRaw as Record<string, unknown>
  const temUrl = entry.url !== undefined
  const temCommand = entry.command !== undefined

  // A união do SDK é DISCRIMINADA: uma entrada que satisfaz os dois ramos não é nenhum dos dois, e
  // adivinhar qual seria escolher pelo usuário em silêncio.
  if (temUrl && temCommand)
    return 'declara "command" e "url" ao mesmo tempo — escolha um transporte.'
  if (!temUrl && !temCommand) return 'requer "command" (stdio) ou "url" (http/sse).'

  return temUrl ? validarRemoto(entry) : validarStdio(entry)
}

/** O ramo stdio — o que este módulo já validava antes do M112, intacto. */
function validarStdio(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    return 'campo "command" deve ser uma string não vazia.'
  }
  if (entry.args !== undefined && !isStringArray(entry.args))
    return 'campo "args" deve ser array de strings.'
  if (entry.env !== undefined && !isStringRecord(entry.env))
    return 'campo "env" deve ser um mapa de strings.'
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string')
    return 'campo "cwd" deve ser string.'
  return undefined
}

/**
 * O ramo remote. A forma é a do SDK (`McpHttpServerConfig`); este módulo **valida e repassa**, nunca
 * normaliza — decidir o default de `type` aqui seria um segundo oráculo sobre o mesmo fato.
 */
function validarRemoto(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.url !== 'string' || entry.url.length === 0) {
    return 'campo "url" deve ser uma string não vazia.'
  }
  try {
    new URL(entry.url)
  } catch {
    return 'campo "url" não é uma URL válida.'
  }
  if (entry.type !== undefined && entry.type !== 'http' && entry.type !== 'sse') {
    return 'campo "type" deve ser "http" ou "sse".'
  }
  if (entry.headers !== undefined && !isStringRecord(entry.headers)) {
    // A mensagem fala da FORMA. Nunca do conteúdo — este é o campo que carrega `Authorization`.
    return 'campo "headers" deve ser um mapa de strings.'
  }
  if (entry.requestTimeoutMs !== undefined && typeof entry.requestTimeoutMs !== 'number') {
    return 'campo "requestTimeoutMs" deve ser número.'
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
