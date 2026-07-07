import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { mcpCommand } from '../../packages/theo/src/cli/commands/mcp.js'
import { defineAgent } from '../../packages/agents/src/index.js'
import type { StdioStreams } from '../../packages/theo/src/server/agent/mcp-stdio.js'

/**
 * `theokit mcp <agent>` — serves a scanned agent as a stdio MCP server. `loadModule` + `streams`
 * injected so the routing + stdio loop are tested without Vite or a real stdin pipe.
 */

async function scaffoldAgent(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mcp-cmd-'))
  await mkdir(join(root, 'agents'), { recursive: true })
  await writeFile(join(root, 'agents', `${name}.ts`), `export default {}\n`)
  return root
}

describe('mcpCommand', () => {
  it('serves the scanned agent as a stdio MCP server (initialize round-trips)', async () => {
    const projectRoot = await scaffoldAgent('support')
    const written: string[] = []
    async function* lines(): AsyncIterable<string> {
      yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    }
    const streams: StdioStreams = { lines: lines(), write: (l) => written.push(l) }

    await mcpCommand('support', {
      projectRoot,
      loadModule: async () => ({ default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }) }),
      streams,
    })

    expect(written).toHaveLength(1)
    const rpc = JSON.parse(written[0]!) as { result: { serverInfo: { name: string } } }
    expect(rpc.result.serverInfo.name).toBe('support')
  })

  it('fails fast when the named agent is not found', async () => {
    const projectRoot = await scaffoldAgent('support')
    async function* lines(): AsyncIterable<string> {
      // never reached
    }
    await expect(
      mcpCommand('ghost', {
        projectRoot,
        loadModule: async () => ({ default: {} }),
        streams: { lines: lines(), write: () => {} },
      }),
    ).rejects.toThrow(/not found/)
  })
})
