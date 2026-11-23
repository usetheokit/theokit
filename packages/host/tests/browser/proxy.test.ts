import { mkdtempSync, rmSync } from 'node:fs'
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
