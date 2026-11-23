import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'

/** A JSON-RPC message, as far as the proxy looks into it. */
interface Message {
  id?: string | number | null
  method?: string
  params?: { name?: unknown; capabilities?: Record<string, unknown> }
  result?: { content?: unknown; tools?: unknown }
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
 * `- [Snapshot](file)` links with the file's content; and, when attached to a shared browser
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
  const held: Message[] = []
  const listRequests = new Set<unknown>()
  const send = (stream: NodeJS.WritableStream, message: unknown): void => {
    stream.write(`${JSON.stringify(message)}\n`)
  }

  const snapshotContent = (link: string): string | undefined => {
    try {
      const root = realpathSync(workDir)
      const path = realpathSync(resolve(root, link))
      const rel = relative(root, path)
      if (rel === '' || rel.startsWith('..') || resolve(rel) === rel) return undefined
      return readFileSync(path, 'utf8').trimEnd()
    } catch {
      return undefined
    }
  }

  const inlineSnapshots = (message: Message): Message => {
    const content = message.result?.content
    if (!Array.isArray(content)) return message
    const inlined = (content as Record<string, unknown>[]).map((part) =>
      part.type === 'text' && typeof part.text === 'string'
        ? {
            ...part,
            text: part.text.replace(
              SNAPSHOT_LINK,
              (line, link: string) => snapshotContent(link) ?? line,
            ),
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
      if (message.method === 'tools/call' && pageState !== 'ready') {
        held.push(message)
        if (pageState === 'idle') {
          pageState = 'opening'
          send(server.stdin, {
            jsonrpc: '2.0',
            id: OPEN_PAGE_ID,
            method: 'tools/call',
            params: { name: 'browser_tabs', arguments: { action: 'new' } },
          })
        }
        return
      }
      send(server.stdin, fromClient(message))
    })
    .on('close', () => server.stdin.end())

  createInterface({ input: server.stdout }).on('line', (line) => {
    const message = parse(line)
    if (message === undefined) process.stdout.write(`${line}\n`)
    else if (Array.isArray(message)) process.stdout.write(`${line}\n`)
    else if (message.id === OPEN_PAGE_ID) {
      pageState = 'ready'
      for (const next of held.splice(0)) send(server.stdin, fromClient(next))
    } else send(process.stdout, fromServer(message))
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
