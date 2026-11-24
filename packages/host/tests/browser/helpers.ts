import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { build } from 'tsup'

import type { browserMcpServer } from '../../src/browser/index.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reply = Record<string, any>

/** Bundles the proxy entry into `dir` (Node cannot run the TypeScript source) and returns its path. */
export async function buildProxy(dir: string): Promise<string> {
  await build({
    entry: {
      'proxy-entry': fileURLToPath(new URL('../../src/browser/proxy-entry.ts', import.meta.url)),
    },
    outDir: dir,
    format: ['esm'],
    dts: false,
    clean: false,
    silent: true,
    config: false,
  })
  return join(dir, 'proxy-entry.js')
}

/** Starts the server a config describes and talks JSON-RPC lines to it. */
export function start(
  config: ReturnType<typeof browserMcpServer>,
  env: Record<string, string> = {},
) {
  if (config.type !== 'stdio') throw new Error('stdio expected')
  const child: ChildProcessWithoutNullStreams = spawn(config.command, [...(config.args ?? [])], {
    env: { ...process.env, ...env },
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const replies = new Map<unknown, (r: Reply) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const r = JSON.parse(line) as Reply
    replies.get(r.id)?.(r)
  })
  let next = 0
  return {
    call: (method: string, params?: unknown) =>
      new Promise<Reply>((resolve) => {
        const id = ++next
        replies.set(id, resolve)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      }),
    raw: (text: string) => child.stdin.write(`${text}\n`),
    onNull: (cb: (r: Reply) => void) => replies.set(null, cb),
    stderr: () => stderr,
    pid: child.pid,
    close: () => child.kill(),
  }
}
