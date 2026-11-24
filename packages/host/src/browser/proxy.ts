import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'

/** A JSON-RPC message, as far as the proxy looks into it. */
interface Message {
  id?: string | number | null
  method?: string
  params?: { name?: unknown; capabilities?: Record<string, unknown>; requestId?: unknown }
  result?: { content?: unknown; tools?: unknown }
  error?: unknown
}

const NOT_OFFERED = -32602
const INVALID_REQUEST = -32600
const UNSAFE_TOOL = 'browser_run_code_unsafe'
const OPEN_PAGE_ID = 'theokit-browser-open-page'
const SNAPSHOT_LINK = /^[ \t]*- \[Snapshot\]\(([^)\n]+)\)[ \t]*$/gm

interface ProxyArgs {
  readonly outputDir: string | undefined
  readonly deny: ReadonlySet<string>
  readonly playwrightConfig: string | undefined
  readonly command: readonly string[]
}

function parseArgs(argv: readonly string[]): ProxyArgs | undefined {
  let outputDir: string | undefined
  let playwrightConfig: string | undefined
  const deny = new Set([UNSAFE_TOOL])
  let i = 0
  for (; i < argv.length && argv[i] !== '--'; i += 2) {
    const value = argv.at(i + 1)
    if (value === undefined) return undefined
    if (argv[i] === '--output-dir') outputDir = value
    else if (argv[i] === '--deny') deny.add(value)
    else if (argv[i] === '--playwright-config') playwrightConfig = value
    else return undefined
  }
  const command = argv.slice(i + 1)
  return command.length === 0 ? undefined : { outputDir, deny, playwrightConfig, command }
}

// eslint-disable-next-line sonarjs/function-return-type
function parse(line: string): Message | Message[] | undefined {
  try {
    const message = JSON.parse(line) as Message | Message[] | null
    return typeof message === 'object' && message !== null ? message : undefined
  } catch {
    return undefined
  }
}

/**
 * The stdio wrapper in front of `@playwright/mcp`: `proxy-entry [--output-dir d] [--deny tool]...
 * [--playwright-config json] -- <cli> [server args...]`. It keeps denied tools (always including
 * `browser_run_code_unsafe`) out of `tools/list` and refuses calls to them; runs the server with
 * `--output-dir` and its working directory both set to the output directory (a fresh temporary one
 * removed on exit when none is given); strips the `roots` capability and `PLAYWRIGHT_MCP_*`
 * variables so neither widens the server's file root or config; rejects batches; replaces the
 * `- [Snapshot](file)` links with the file's content (a file that cannot be read, is empty or leaves
 * the output directory becomes a line saying so, and stderr names it); hands the server one
 * `tools/call` at a time, so a snapshot sent beside a navigation sees the loaded page (a call the
 * client cancelled does not hold the ones behind it); and, when attached to a shared browser
 * (`--cdp-endpoint`), opens a tab of its own before the first tool call.
 *
 * Exits with the server's status, 1 when it ended on a signal, 2 on bad usage or spawn failure.
 */
export function runBrowserProxy(argv: readonly string[]): void {
  const args = parseArgs(argv)
  if (args === undefined) {
    process.stderr.write(
      'browser-proxy: usage: proxy-entry [--output-dir d] [--deny tool]... [--playwright-config json] -- <cli> [args...]\n',
    )
    process.exit(2)
  }
  const ownsDir = args.outputDir === undefined
  const workDir = args.outputDir ?? mkdtempSync(join(tmpdir(), 'theokit-browser-'))
  mkdirSync(workDir, { recursive: true })
  const privateDir = mkdtempSync(join(tmpdir(), 'theokit-browser-cfg-'))
  const [cliPath, ...serverArgs] = args.command
  const extra = ['--output-dir', workDir]
  if (args.playwrightConfig !== undefined) {
    const configPath = join(privateDir, 'config.json')
    writeFileSync(configPath, args.playwrightConfig)
    extra.push('--config', configPath)
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('PLAYWRIGHT_MCP_')),
  )
  const server = spawn(process.execPath, [cliPath, ...serverArgs, ...extra], {
    cwd: workDir,
    env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  const attached = serverArgs.includes('--cdp-endpoint')
  let pageState: 'idle' | 'opening' | 'ready' = attached ? 'idle' : 'ready'
  /** The `tools/call` requests not yet sent to the server, in the order they came. */
  const queue: Message[] = []
  /** The call the server is answering now, or `undefined`: the server gets one call at a time. */
  let inFlight: { id: string | number } | undefined
  const listRequests = new Set<unknown>()
  const send = (stream: NodeJS.WritableStream, message: unknown): void => {
    stream.write(`${JSON.stringify(message)}\n`)
  }

  /**
   * What replaces the snapshot link `link`: the file's content, or a line that says why there is
   * none. A link left as it was is a path no tool of the agent can open, and an empty replacement
   * reads as an empty page, so the model would report a page it never saw.
   */
  const snapshotContent = (link: string): string => {
    const unavailable = (reason: string): string => {
      process.stderr.write(`browser-proxy: snapshot ${link} ${reason}\n`)
      return `[The page snapshot could not be read (${reason}). Call browser_snapshot again.]`
    }
    try {
      const root = realpathSync(workDir)
      const path = realpathSync(resolve(root, link))
      const rel = relative(root, path)
      if (rel === '' || rel.startsWith('..') || resolve(rel) === rel)
        return unavailable('is outside the output directory')
      const content = readFileSync(path, 'utf8').trimEnd()
      return content === '' ? unavailable('is empty') : content
    } catch (error) {
      return unavailable(`could not be read: ${(error as Error).message}`)
    }
  }

  const inlineSnapshots = (message: Message): Message => {
    const content = message.result?.content
    if (!Array.isArray(content)) return message
    const inlined = (content as Record<string, unknown>[]).map((part) =>
      part.type === 'text' && typeof part.text === 'string'
        ? {
            ...part,
            text: part.text.replace(SNAPSHOT_LINK, (_line, link: string) => snapshotContent(link)),
          }
        : part,
    )
    return { ...message, result: { ...message.result, content: inlined } }
  }

  const fromClient = (message: Message): Message => {
    if (message.method === 'initialize' && message.params?.capabilities?.roots !== undefined) {
      const capabilities = { ...message.params.capabilities }
      delete capabilities.roots
      return { ...message, params: { ...message.params, capabilities } }
    }
    if (message.method === 'tools/list' && message.id !== undefined) listRequests.add(message.id)
    return message
  }

  const fromServer = (message: Message): Message => {
    if (message.result?.content !== undefined) return inlineSnapshots(message)
    if (!listRequests.delete(message.id) || !Array.isArray(message.result?.tools)) return message
    const tools = (message.result.tools as { name?: string }[]).filter(
      (tool) => !args.deny.has(String(tool.name)),
    )
    return { ...message, result: { ...message.result, tools } }
  }

  createInterface({ input: process.stdin })
    .on('line', (line) => {
      const message = parse(line)
      if (message === undefined) {
        server.stdin.write(`${line}\n`)
        return
      }
      if (Array.isArray(message)) {
        // A batch would carry `tools/call` entries past the checks below; none is forwarded.
        send(process.stdout, {
          jsonrpc: '2.0',
          id: null,
          error: { code: INVALID_REQUEST, message: 'batch requests are not supported' },
        })
        return
      }
      const name = message.params?.name
      if (message.method === 'tools/call' && args.deny.has(String(name))) {
        send(process.stdout, {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: NOT_OFFERED, message: `the browser tool ${String(name)} is not offered` },
        })
        return
      }
      if (message.method === 'tools/call') {
        queue.push(message)
        pump()
        return
      }
      send(server.stdin, fromClient(message))
      // A cancelled call may never be answered; the calls behind it must not wait for that.
      if (
        message.method === 'notifications/cancelled' &&
        inFlight !== undefined &&
        message.params?.requestId === inFlight.id
      ) {
        inFlight = undefined
        pump()
      }
    })
    .on('close', () => server.stdin.end())

  /** Sends the next queued call when none is in flight; an attached server's first call waits for its own page. */
  function pump(): void {
    if (inFlight !== undefined || pageState === 'opening' || queue.length === 0) return
    if (pageState === 'idle') {
      pageState = 'opening'
      send(server.stdin, {
        jsonrpc: '2.0',
        id: OPEN_PAGE_ID,
        method: 'tools/call',
        params: { name: 'browser_tabs', arguments: { action: 'new' } },
      })
      return
    }
    const next = queue.shift()!
    if (next.id !== undefined && next.id !== null) inFlight = { id: next.id }
    send(server.stdin, fromClient(next))
    pump()
  }

  createInterface({ input: server.stdout }).on('line', (line) => {
    const message = parse(line)
    if (message === undefined || Array.isArray(message)) process.stdout.write(`${line}\n`)
    else if (message.id === OPEN_PAGE_ID) {
      pageState = 'ready'
      pump()
    } else {
      send(process.stdout, fromServer(message))
      if (
        inFlight !== undefined &&
        message.id === inFlight.id &&
        (message.result !== undefined || message.error !== undefined)
      ) {
        inFlight = undefined
        pump()
      }
    }
  })

  server.stdin.on('error', () => undefined)
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
    process.on(signal, () => server.kill(signal))

  const cleanup = (): void => {
    rmSync(privateDir, { recursive: true, force: true })
    if (ownsDir) rmSync(workDir, { recursive: true, force: true })
  }
  server.on('error', (error) => {
    process.stderr.write(`browser-proxy: could not start ${cliPath}: ${error.message}\n`)
    cleanup()
    process.exit(2)
  })
  server.on('close', (code) => {
    cleanup()
    process.exit(code ?? 1)
  })
}
