import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { untrustedContentSendOptions } from '../src/agent/untrusted-content.js'

const SRC = join(import.meta.dirname, '..', 'src')

interface SendCall {
  readonly at: string
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

/** Every `<receiver>.send(` call in one source text, with its arguments (multi-line and optional-chained included). */
function sendCalls(file: string, source: string): SendCall[] {
  const calls: SendCall[] = []
  for (const match of source.matchAll(/([\w$)\]]+)\s*\??\.\s*send\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1
    const line = source.slice(0, match.index).split('\n').length
    calls.push({ at: `${file}:${line}`, args: argumentsFrom(source, open) })
  }
  return calls
}

/** The sends that pass what `sendDefaults` carries: the options helper, `toolResultGuard` or `pruneToolResults`. */
function perSendOptions(file: string, source: string): string[] {
  return sendCalls(file, source)
    .filter((call) => /untrustedContentSendOptions|toolResultGuard|pruneToolResults/.test(call.args))
    .map((call) => call.at)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('the untrusted content options are the agent default, not a per-send option', () => {
  it('every agent carries them as sendDefaults', () => {
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'k' })

    expect(options.sendDefaults).toEqual(untrustedContentSendOptions())
    expect(options.sendDefaults.toolResultGuard).toEqual({ delimit: true })
  })

  it('no send in src passes them again', () => {
    const passing = sourceFiles(SRC).flatMap((path) => perSendOptions(relative(SRC, path), readFileSync(path, 'utf8')))

    expect(passing).toEqual([])
  })

  it('no file in src calls untrustedContentSendOptions() except create-agent', () => {
    const callers = sourceFiles(SRC)
      .filter((path) => /untrustedContentSendOptions\(\)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))
      .filter((file) => file !== 'agent/untrusted-content.ts')

    expect(callers).toEqual(['agent/create-agent.ts'])
  })

  it('the scan reports a multi-line send that spreads the options', () => {
    const source = ['const run = await agent', '  .send(', '    task,', '    { ...untrustedContentSendOptions(), signal },', '  )'].join('\n')

    expect(perSendOptions('tools/fixture.ts', source)).toEqual(['tools/fixture.ts:1'])
  })

  it('the scan reports an optional-chained send and a send on a call result', () => {
    const source = 'await agent?.send(task, { toolResultGuard: { delimit: true } })\nawait (await createWorker()).send(task, { pruneToolResults: { olderThanRounds: 1 } })'

    expect(perSendOptions('tools/fixture.ts', source)).toEqual(['tools/fixture.ts:1', 'tools/fixture.ts:2'])
  })

  it('the scan accepts a send with only its own options, and a WebSocket frame', () => {
    const source = 'ws.send(frame)\nconst run = await agent.send(task, { signal })'

    expect(perSendOptions('control-plane/control-socket.ts', source)).toEqual([])
  })
})
