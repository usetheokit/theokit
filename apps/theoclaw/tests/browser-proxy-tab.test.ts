import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

const PROXY = join(import.meta.dirname, '..', 'tools', 'browser-proxy.mjs')

/** A stand-in for the MCP server: answers every request and records each tool call it gets, in order. */
const FAKE_SERVER = `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const log = process.argv[2]
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id === undefined) return
  if (m.method === 'tools/call') appendFileSync(log, m.params.name + ':' + (m.params.arguments?.action ?? m.params.arguments?.url ?? '') + '\\n')
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ok ' + m.id }] } }) + '\\n')
})
`

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Runs the wrapper over the fake server with `args`, sends `calls`, resolves with the replies and the server's log. */
async function run(
  args: string[],
  calls: object[],
): Promise<{ replies: { id: unknown; text: string }[]; seen: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-proxy-test-'))
  dirs.push(dir)
  const cli = join(dir, 'server.mjs')
  const log = join(dir, 'calls.log')
  writeFileSync(cli, FAKE_SERVER)
  writeFileSync(log, '')
  const child = spawn(process.execPath, [PROXY, cli, log, ...args], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const replies: { id: unknown; text: string }[] = []
  const done = new Promise<void>((resolve) => {
    createInterface({ input: child.stdout }).on('line', (line) => {
      const m = JSON.parse(line) as { id: unknown; result?: { content?: { text: string }[] } }
      replies.push({ id: m.id, text: m.result?.content?.[0]?.text ?? '' })
      if (replies.length === calls.length) resolve()
    })
  })
  for (const call of calls) child.stdin.write(`${JSON.stringify(call)}\n`)
  await done
  child.stdin.end()
  await new Promise((resolve) => child.once('close', resolve))
  const { readFileSync } = await import('node:fs')
  return { replies, seen: readFileSync(log, 'utf8').split('\n').filter(Boolean) }
}

const navigate = (id: number, url: string) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'browser_navigate', arguments: { url } },
})

describe('the browser wrapper on a shared browser', () => {
  it('opens a tab of its own before the first call, and answers only what the client asked', async () => {
    const { replies, seen } = await run(
      ['--cdp-endpoint', 'http://127.0.0.1:1'],
      [navigate(1, 'http://a/'), navigate(2, 'http://b/')],
    )
    expect(seen).toEqual([
      'browser_tabs:new',
      'browser_navigate:http://a/',
      'browser_navigate:http://b/',
    ])
    expect(replies.map((reply) => reply.id)).toEqual([1, 2])
  })

  it('leaves an isolated browser as it was', async () => {
    const { seen } = await run(['--isolated'], [navigate(1, 'http://a/')])
    expect(seen).toEqual(['browser_navigate:http://a/'])
  })
})
