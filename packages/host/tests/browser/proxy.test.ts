import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { browserMcpServer } from '../../src/browser/index.js'
import { buildProxy, type Reply, start } from './helpers.js'

const standIn = fileURLToPath(new URL('./stand-in-server.mjs', import.meta.url))
let scratch: string
let proxyPath: string

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'host-browser-test-'))
  proxyPath = await buildProxy(scratch)
})
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const serverFor = (opts: Parameters<typeof browserMcpServer>[0]) =>
  browserMcpServer(opts, { resolveCli: () => standIn, proxyPath })

describe('browserMcpServer config', () => {
  it('is a sequential stdio server and refuses a relative outputDir', () => {
    const config = serverFor({ mode: 'isolated' })
    expect(config).toMatchObject({ type: 'stdio', sequential: true })
    expect(() => serverFor({ mode: 'isolated', outputDir: 'rel' })).toThrow(/absolute/)
    expect(() => serverFor({ mode: 'shared', cdpEndpoint: '' })).toThrow(/cdpEndpoint/)
  })
})

describe('browser proxy', () => {
  it('drops browser_run_code_unsafe by default and the extra deny entries', async () => {
    const p = start(serverFor({ mode: 'isolated', deny: ['browser_secret'] }))
    try {
      const names = ((await p.call('tools/list')).result.tools as { name: string }[]).map(
        (t) => t.name,
      )
      expect(names).toEqual(['browser_navigate'])
      const unsafe = await p.call('tools/call', { name: 'browser_run_code_unsafe', arguments: {} })
      expect(unsafe.error).toMatchObject({ code: -32602 })
      expect((await p.call('tools/call', { name: 'browser_secret' })).error).toBeDefined()
    } finally {
      p.close()
    }
  })

  it('keeps unsafe tool denied when deny is empty, and rejects batches', async () => {
    const p = start(serverFor({ mode: 'isolated', deny: [] }))
    try {
      const names = ((await p.call('tools/list')).result.tools as { name: string }[]).map(
        (t) => t.name,
      )
      expect(names).not.toContain('browser_run_code_unsafe')
      const batch = new Promise<Reply>((resolve) => p.onNull(resolve))
      p.raw(
        JSON.stringify([
          {
            jsonrpc: '2.0',
            id: 9,
            method: 'tools/call',
            params: { name: 'browser_run_code_unsafe' },
          },
        ]),
      )
      expect((await batch).error).toMatchObject({ code: -32600 })
    } finally {
      p.close()
    }
  })

  it('runs the server inside outputDir, strips roots and PLAYWRIGHT_MCP_ env, and inlines snapshots', async () => {
    const outputDir = join(scratch, 'out')
    const p = start(serverFor({ mode: 'isolated', outputDir }), {
      PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS: '1',
    })
    try {
      const init = (await p.call('initialize', { capabilities: { roots: {}, sampling: {} } }))
        .result
      expect(init.capabilities).toEqual({ sampling: {} })
      expect(init.env).toEqual([])
      expect(await realpath(init.cwd)).toBe(await realpath(outputDir))
      expect(init.argv).toEqual(
        expect.arrayContaining(['--output-dir', outputDir, '--headless', '--isolated', '--config']),
      )
      const call = await p.call('tools/call', { name: 'browser_navigate', arguments: {} })
      expect(call.result.content[0].text).toBe('called browser_navigate\n- heading "Hi"')
    } finally {
      p.close()
    }
  })

  it('opens a tab of its own before the first call in shared mode', async () => {
    const p = start(serverFor({ mode: 'shared', cdpEndpoint: 'http://127.0.0.1:1' }))
    try {
      const call = await p.call('tools/call', { name: 'browser_navigate', arguments: {} })
      expect(call.result.content[0].text).toContain('called browser_navigate')
    } finally {
      p.close()
    }
  })
})

const text = (reply: Reply): string => reply.result.content[0].text as string
const unsafeCall = { name: 'browser_run_code_unsafe', arguments: {} }

describe('browser proxy call order', () => {
  it('starts a tool call only after the one before it answered', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      const first = p.call('tools/call', { name: 'browser_navigate', arguments: { delay: 200 } })
      const second = p.call('tools/call', { name: 'browser_snapshot', arguments: { delay: 0 } })
      await first
      expect((await second).result.startedAfter).toEqual(['browser_navigate'])
    } finally {
      p.close()
    }
  })

  it('stops waiting on a call the client cancelled', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      void p.call('tools/call', { name: 'browser_navigate', arguments: { delay: 600_000 } })
      const behind = p.call('tools/call', { name: 'browser_snapshot', arguments: { delay: 0 } })
      p.raw(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 1 },
        }),
      )
      expect((await behind).result.called).toBe('browser_snapshot')
    } finally {
      p.close()
    }
  })

  it('answers the calls after a refused one without waiting on it', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      expect((await p.call('tools/call', unsafeCall)).error).toMatchObject({ code: -32602 })
      await p.call('tools/call', { name: 'browser_navigate', arguments: { delay: 0 } })
      const last = await p.call('tools/call', { name: 'browser_snapshot', arguments: { delay: 0 } })
      expect(last.result.startedAfter).toEqual(['browser_navigate'])
    } finally {
      p.close()
    }
  })

  it('opens its page once, first, in shared mode, and holds the calls in the order they came', async () => {
    const p = start(serverFor({ mode: 'shared', cdpEndpoint: 'http://127.0.0.1:1' }))
    try {
      void p.call('tools/call', { name: 'browser_navigate', arguments: {} })
      const second = await p.call('tools/call', { name: 'browser_snapshot', arguments: {} })
      expect(second.result.seen).toEqual([
        'browser_tabs:new',
        'browser_navigate:',
        'browser_snapshot:',
      ])
    } finally {
      p.close()
    }
  })

  it('opens no page for a server with its own isolated browser', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      const call = await p.call('tools/call', { name: 'browser_navigate', arguments: {} })
      expect(call.result.seen).toEqual(['browser_navigate:'])
    } finally {
      p.close()
    }
  })
})

describe('browser proxy snapshots', () => {
  const link = (arguments_: object) => ({ name: 'browser_navigate', arguments: arguments_ })

  it('answers a link with the content of the file it names', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      const t = text(await p.call('tools/call', link({ link: './page.yml' })))
      expect(t).toContain('- generic [ref=e1]: hello page')
      expect(t).not.toContain('[Snapshot]')
    } finally {
      p.close()
    }
  })

  it('says so when the link leaves the output directory, and names it on stderr', async () => {
    const outside = join(tmpdir(), 'theokit-outside.yml')
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      const t = text(await p.call('tools/call', link({ link: '../theokit-outside.yml' })))
      expect(t).not.toContain('outside\n')
      expect(t).toContain('could not be read (is outside the output directory)')
      expect(p.stderr()).toContain(
        'snapshot ../theokit-outside.yml is outside the output directory',
      )
    } finally {
      p.close()
      rmSync(outside, { force: true })
    }
  })

  it('says why a snapshot it cannot read is missing, instead of leaving a dead link', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      const t = text(await p.call('tools/call', link({ link: './gone.yml', missing: true })))
      expect(t).not.toContain('- [Snapshot](./gone.yml)')
      expect(t).toContain('could not be read (could not be read: ENOENT')
      expect(p.stderr()).toMatch(/snapshot \.\/gone\.yml could not be read: .*ENOENT/)
    } finally {
      p.close()
    }
  })

  it('says that a snapshot file is empty', async () => {
    const p = start(serverFor({ mode: 'isolated' }))
    try {
      const t = text(await p.call('tools/call', link({ link: './empty.yml', content: '' })))
      expect(t).not.toContain('[Snapshot]')
      expect(t).toContain('could not be read (is empty)')
      expect(p.stderr()).toContain('snapshot ./empty.yml is empty')
    } finally {
      p.close()
    }
  })
})

describe('browser proxy lifecycle', () => {
  const run = (args: string[], tmp: string) =>
    new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [proxyPath, ...args], {
        env: { ...process.env, TMPDIR: tmp },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.stdin.end()
      child.once('close', (code) => resolve({ code, stderr }))
    })

  it('exits 2 naming its usage when started without a CLI', async () => {
    const tmp = mkdtempSync(join(scratch, 'tmp-'))
    const { code, stderr } = await run([], tmp)
    expect(code).toBe(2)
    expect(stderr).toContain('usage: proxy-entry')
    expect(readdirSync(tmp)).toEqual([])
  })

  it('exits with the server status and leaves no directory when the CLI does not exist', async () => {
    const tmp = mkdtempSync(join(scratch, 'tmp-'))
    const { code, stderr } = await run(['--', join(tmp, 'missing-cli.mjs')], tmp)
    expect(code).toBe(1)
    expect(stderr).toContain('Cannot find module')
    expect(readdirSync(tmp).filter((name) => name.startsWith('theokit-browser-'))).toEqual([])
  })

  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)(
    'forwards %s to the server and removes its directory',
    async (signal) => {
      const p = start(serverFor({ mode: 'isolated' }))
      const call = await p.call('tools/call', { name: 'browser_navigate', arguments: {} })
      const { cwd, pid } = call.result as { cwd: string; pid: number }
      expect(existsSync(cwd)).toBe(true)
      process.kill(p.pid!, signal)
      for (let waited = 0; (existsSync(cwd) || alive(pid)) && waited < 15_000; waited += 50)
        await new Promise((resolve) => setTimeout(resolve, 50))
      expect(existsSync(cwd)).toBe(false)
      expect(alive(pid)).toBe(false)
    },
  )
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
