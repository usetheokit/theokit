import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')

/**
 * The `.send(` calls in `src` whose receiver is not an agent (brief FR-004): a WebSocket frame,
 * the ACP transport's line and a scheduled answer's `DeliveryRouter` send, each keyed by file and receiver so a new agent send in the same file
 * is still checked. A bare `send(` with no receiver is a local function and is out of reach of the
 * match below, which requires a `.` before `send(`.
 */
const NOT_AGENTS: ReadonlySet<string> = new Set([
  'control-plane/control-socket.ts:ws',
  'control-client/control-client.ts:socket',
  'tools/acp-transport.ts:inner',
  'scheduler/scheduler-wiring.ts:router',
])

interface SendCall {
  readonly at: string
  readonly receiver: string
  readonly args: string
}

/** The text between the `(` at `open` and its matching `)`, across lines. */
function argumentsFrom(source: string, open: number): string {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }
  return source.slice(open + 1)
}

/** Every `<receiver>.send(` call in one source text, with its arguments. */
function sendCalls(file: string, source: string): SendCall[] {
  const calls: SendCall[] = []
  for (const match of source.matchAll(/([\w$)\]]+)\s*\??\.\s*send\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1
    const line = source.slice(0, match.index).split('\n').length
    calls.push({ at: `${file}:${line}`, receiver: `${file}:${match[1] ?? ''}`, args: argumentsFrom(source, open) })
  }
  return calls
}

/** The agent sends whose arguments do not spread the untrusted content options. */
function unguardedSends(file: string, source: string): string[] {
  return sendCalls(file, source)
    .filter((call) => !NOT_AGENTS.has(call.receiver))
    .filter((call) => !call.args.includes('untrustedContentSendOptions()'))
    .map((call) => call.at)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('every send in src passes the untrusted content options', () => {
  it('every send in src passes the untrusted content options', () => {
    const unguarded = sourceFiles(SRC).flatMap((path) => unguardedSends(relative(SRC, path), readFileSync(path, 'utf8')))

    expect(unguarded).toEqual([])
  })

  it('every send in src passes the untrusted content options also reports a multi-line agent.send( call (EC-4)', () => {
    const source = ['const run = await agent', '  .send(', '    task,', '    { signal },', '  )'].join('\n')

    expect(unguardedSends('tools/fixture.ts', source)).toEqual(['tools/fixture.ts:1'])
  })

  it('also reports an optional-chained send and a send on a call result', () => {
    const source = 'await agent?.send(task)\nawait (await createWorker()).send(task)'

    expect(unguardedSends('tools/fixture.ts', source)).toEqual(['tools/fixture.ts:1', 'tools/fixture.ts:2'])
  })

  it('accepts a multi-line send that spreads the options', () => {
    const source = ['const run = await agent.send(', '  task,', '  { ...untrustedContentSendOptions(), signal },', ')'].join('\n')

    expect(unguardedSends('tools/fixture.ts', source)).toEqual([])
  })

  it('still checks an agent send in a file that also sends a WebSocket frame', () => {
    const source = 'ws.send(frame)\nconst run = await agent.send(message)'

    expect(unguardedSends('control-plane/control-socket.ts', source)).toEqual(['control-plane/control-socket.ts:2'])
  })
})
