import { writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMcpRelayServer, startMcpRelayConnector } from '@theokit/agents/mcp-relay'
import { createGrantStore } from '@theokit/http/guards'

import { DEFAULT_GRANT_TOOLS, grantsPath, mcpRelayDispatch } from '../src/mcp-relay/command.js'
import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { cleanScratch, harness } from './support/cli-harness.js'

const INSTANCE_TOKEN = 'mcp-relay-token-0123456789abcdef'
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  cleanScratch()
})

/** A hosted client's view: the real relay, the real connector and the real tools, over loopback. */
async function setup() {
  const h = harness()
  const toolSettings = resolveToolSettings({}, h.io.cwd)
  writeFileSync(join(toolSettings.toolRoot, 'hello.txt'), 'hi')
  const path = grantsPath(h.io.env, h.io.homeDir)
  const store = createGrantStore(path)
  const chatgpt = (await store.create('chatgpt', DEFAULT_GRANT_TOOLS)).credential
  const relay: Server = createMcpRelayServer({ instanceToken: INSTANCE_TOKEN, grants: store, pollMs: 50, timeoutMs: 5000 })
  await new Promise<void>((r) => relay.listen(0, '127.0.0.1', r))
  closers.push(() => new Promise((r) => (relay.closeAllConnections(), relay.close(() => r()))))
  const url = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`
  const connector = startMcpRelayConnector({
    url,
    token: INSTANCE_TOKEN,
    tools: () => buildTools(toolSettings),
    dispatch: mcpRelayDispatch(toolSettings),
    backoffMs: { min: 5, max: 20 },
  })
  closers.push(() => connector.stop())
  const rpc = (token: string, body: unknown) =>
    fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { rpc, chatgpt, store, path }
}

describe('the MCP relay end to end', () => {
  it('runs list_dir for a granted remote client, refuses other tools, and stops at revoke', async () => {
    const { rpc, chatgpt, path } = await setup()

    const init = await rpc(chatgpt, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(init.status).toBe(200)

    const list = (await (await rpc(chatgpt, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as {
      result: { tools: Array<{ name: string }> }
    }
    expect(list.result.tools.map((t) => t.name).sort()).toEqual(['list_dir', 'read_file'])

    const call = (name: string) => ({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: { path: '.' } } })
    const ok = await rpc(chatgpt, call('list_dir'))
    expect(ok.status).toBe(200)
    expect(JSON.stringify(await ok.json())).toContain('hello.txt')

    const denied = (await (await rpc(chatgpt, call('write_file'))).json()) as { error?: unknown; result?: { isError?: boolean } }
    expect(denied.error ?? denied.result?.isError).toBeTruthy()

    expect((await rpc('wrong-token', call('list_dir'))).status).toBe(401)
    await createGrantStore(path).revoke('chatgpt')
    expect((await rpc(chatgpt, call('list_dir'))).status).toBe(401)
  })
})
