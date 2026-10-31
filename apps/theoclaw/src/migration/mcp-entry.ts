/**
 * The MCP entry normalisation both readers share (FR-003): a foreign entry becomes exactly the
 * shape `loadMcpJson` carries, so a real setup never trips its uncarried-field warning, which the
 * import treats as a refusal. A reason is built from the shape, never from a value (NFR-003).
 */

/** A stdio server as `loadMcpJson` carries it. */
export interface StdioMcp {
  readonly command: string
  readonly args?: string[]
  readonly env?: Record<string, string>
  readonly cwd?: string
}

/** A URL server: `type` is `http` or `sse`, or an unknown transport staged as written for FR-004 to refuse (D5). */
export interface UrlMcp {
  readonly type: string
  readonly url: string
  readonly headers?: Record<string, string>
}

export type NormalisedMcp = StdioMcp | UrlMcp

export interface NormalisedEntry {
  readonly entry?: NormalisedMcp
  /** Why the entry is not carried; set exactly when `entry` is not. */
  readonly reason?: string
  /** Keys of the raw entry the carried shape has no place for, listed as `field not carried`. */
  readonly notCarried: string[]
}

// The brief narrows the URL keys to these three: `auth` and `requestTimeoutMs`, which the runtime
// also reads, are listed as not carried on purpose (FR-003).
const STDIO_KEYS = new Set(['command', 'args', 'env', 'cwd'])
const URL_KEYS = new Set(['type', 'url', 'headers'])

type Raw = Record<string, unknown>

function isPlainObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty string, which is what `loadMcpJson` accepts as a transport. */
function present(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** `env` or `headers` as strings, numbers and booleans converted; `undefined` when a value is anything else. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined
  const entries = Object.entries(value)
  if (!entries.every(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) return undefined
  // `fromEntries` defines each key as an own property, so a `__proto__` key from JSON is kept.
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]))
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function stdioEntry(raw: Raw): NormalisedEntry {
  const args = raw.args
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string'))) {
    return { reason: 'args is not an array of strings', notCarried: [] }
  }
  const env = raw.env === undefined ? undefined : stringRecord(raw.env)
  if (raw.env !== undefined && env === undefined) return { reason: 'env value is not a string, number or boolean', notCarried: [] }
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined
  const entry: StdioMcp = {
    command: raw.command as string,
    ...(args === undefined ? {} : { args: [...(args as string[])] }),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
  }
  // `type: stdio` is Claude Code's spelling of the default and is consumed; a non-string `cwd`
  // would make `loadMcpJson` ignore the whole entry, so it is the key that is left out.
  const notCarried = Object.keys(raw).filter(
    (key) => !(STDIO_KEYS.has(key) && (key !== 'cwd' || cwd !== undefined)) && !(key === 'type' && raw.type === 'stdio'),
  )
  return { entry, notCarried }
}

function urlType(type: unknown): string {
  if (type === undefined || type === 'http' || type === 'streamable-http') return 'http'
  return String(type)
}

function urlEntry(raw: Raw): NormalisedEntry {
  const url = raw.url as string
  if (!isHttpUrl(url)) return { reason: 'url is not http: or https:', notCarried: [] }
  const headers = raw.headers === undefined ? undefined : stringRecord(raw.headers)
  if (raw.headers !== undefined && headers === undefined) {
    return { reason: 'headers value is not a string, number or boolean', notCarried: [] }
  }
  const entry: UrlMcp = { type: urlType(raw.type), url, ...(headers === undefined ? {} : { headers }) }
  return { entry, notCarried: Object.keys(raw).filter((key) => !URL_KEYS.has(key)) }
}

/** The carried shape of one foreign MCP entry, or the reason it is not carried. */
export function normaliseMcpEntry(raw: unknown): NormalisedEntry {
  if (!isPlainObject(raw)) return { reason: 'not an object', notCarried: [] }
  const hasCommand = present(raw.command)
  const hasUrl = present(raw.url)
  if (hasCommand === hasUrl) return { reason: hasCommand ? 'both command and url' : 'neither command nor url', notCarried: [] }
  return hasCommand ? stdioEntry(raw) : urlEntry(raw)
}
