import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  appTypedClientPlugin,
  emitClientDts,
  RESOLVED_APP_CLIENT_ID,
  VIRTUAL_APP_CLIENT_ID,
} from '../../packages/theo/src/vite-plugin/app-typed-client.js'

let sandbox: string
let serverDir: string
let distDir: string

beforeEach(() => {
  sandbox = join(
    tmpdir(),
    `theo-app-typed-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  serverDir = join(sandbox, 'server')
  distDir = join(sandbox, '.theokit')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

afterEach(() => {
  // best-effort cleanup; vitest worker will GC
})

function writeRoute(rel: string, content: string): void {
  const full = join(serverDir, 'routes', rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('appTypedClientPlugin (Vite plugin)', () => {
  it('emits .theokit/client.d.ts on initial configResolved', () => {
    writeRoute('users.ts', 'export const GET = () => ({})\n')
    const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir, distDir })
    ;(plugin.configResolved as any)({} as any)
    const dts = join(distDir, 'client.d.ts')
    expect(existsSync(dts)).toBe(true)
    const content = readFileSync(dts, 'utf-8')
    expect(content).toContain("declare module '@theo/client'")
    expect(content).toContain('users:')
  })

  it('virtual module resolves and load returns runtime that imports createAppClient', () => {
    const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir, distDir })
    const resolved = (plugin.resolveId as any)(VIRTUAL_APP_CLIENT_ID, undefined, {} as any)
    expect(resolved).toBe(RESOLVED_APP_CLIENT_ID)
    const loaded = (plugin.load as any)(RESOLVED_APP_CLIENT_ID)
    expect(loaded).toContain('createAppClient')
    expect(loaded).toContain("import { createAppClient } from 'theokit/client'")
  })

  it('resolveId returns null for unrelated ids (no over-capture)', () => {
    const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir, distDir })
    expect((plugin.resolveId as any)('/some/random/id', undefined, {} as any)).toBeNull()
  })

  it('load returns null for unrelated ids', () => {
    const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir, distDir })
    expect((plugin.load as any)('/some/random/id')).toBeNull()
  })

  it('emitClientDts is idempotent — repeat write reports changed=false when content unchanged', async () => {
    writeRoute('a.ts', 'export const GET = () => ({})\n')
    const opts = { cwd: sandbox, serverDir, distDir }
    const r1 = await emitClientDts(opts)
    expect(r1.changed).toBe(true)
    const r2 = await emitClientDts(opts)
    expect(r2.changed).toBe(false)
  })

  it('emitClientDts detects route file additions on subsequent calls', async () => {
    writeRoute('a.ts', 'export const GET = () => ({})\n')
    const opts = { cwd: sandbox, serverDir, distDir }
    await emitClientDts(opts)
    writeRoute('b.ts', 'export const POST = () => ({})\n')
    const r2 = await emitClientDts(opts)
    expect(r2.changed).toBe(true)
    const dts = readFileSync(join(distDir, 'client.d.ts'), 'utf-8')
    expect(dts).toContain('a:')
    expect(dts).toContain('b:')
  })

  it('EC-6: write is atomic via tmp + rename (no half-written file under rapid succession)', async () => {
    writeRoute('a.ts', 'export const GET = () => ({})\n')
    const opts = { cwd: sandbox, serverDir, distDir }
    // Trigger 5 rapid emits — each must leave a parseable file behind.
    for (let i = 0; i < 5; i++) {
      writeRoute('a.ts', `export const GET = () => ({ tick: ${i} })\n`)
      await emitClientDts(opts)
      const content = readFileSync(join(distDir, 'client.d.ts'), 'utf-8')
      // Final file must always end with the closing `}` of the declared module.
      expect(content.trimEnd().endsWith('}')).toBe(true)
      expect(content).toContain("declare module '@theo/client'")
    }
  })

  it('no .tmp files remain after writes (rename succeeded)', async () => {
    writeRoute('a.ts', 'export const GET = () => ({})\n')
    await emitClientDts({ cwd: sandbox, serverDir, distDir })
    const dts = join(distDir, 'client.d.ts')
    // Check no sibling .tmp file lingers.
    const tmp = `${dts}.${process.pid}.tmp`
    expect(existsSync(tmp)).toBe(false)
    expect(statSync(dts).isFile()).toBe(true)
  })

  it('plugin handles missing serverDir gracefully (emits stub, no crash)', async () => {
    const noServer = join(sandbox, 'no-server')
    const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir: noServer, distDir })
    await (plugin.configResolved as any)({} as any)
    const dts = join(distDir, 'client.d.ts')
    expect(existsSync(dts)).toBe(true)
    expect(readFileSync(dts, 'utf-8')).toContain('No routes detected')
  })

  it('plugin.enforce is set to `post`', () => {
    const plugin = appTypedClientPlugin({ cwd: sandbox, serverDir, distDir })
    expect(plugin.enforce).toBe('post')
  })
})
