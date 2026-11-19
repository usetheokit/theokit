import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { translateCronToDeno } from '../../packages/theo/src/server/cron/adapter-translators.js'

const JOBS = resolve(__dirname, '../../packages/theo/src/server/jobs/index.ts')

let root: string
type Callback = () => Promise<void>
let callbacks: Map<string, Callback>
let seq = 0

/** An in-memory backend that records what reaches it. */
const backendSource = (label: string): string => `
export const calls = (globalThis.__calls ??= [])
export const backend = {
  name: '${label}',
  async enqueue(input) { calls.push({ backend: '${label}', input }); return { jobId: 'j' } },
  async enqueueInTransaction(client, input) { calls.push({ backend: '${label}', client, input }); return { jobId: 'tx' } },
}
`

const write = (rel: string, content: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

/** Generate the entry, point its `npm:` specifier at the workspace source, load it. */
async function loadEntry(configs: string[], handlerBody: string): Promise<void> {
  write('server/crons/job.ts', `export default { handler: async (ctx) => { ${handlerBody} } }\n`)
  const entry = join(root, '.theokit', 'crons-entry.ts')
  translateCronToDeno(
    entry,
    [
      {
        name: 'job',
        filePath: 'server/crons/job.ts',
        schedule: '* * * * *',
        concurrency: 'forbid',
      },
    ],
    { projectRoot: root, configPaths: configs.map((c) => join(root, c)) },
  )
  const text = readFileSync(entry, 'utf8').replace('npm:theokit/server/jobs', JOBS)
  const loaded = join(root, '.theokit', `loaded-${seq++}.ts`)
  writeFileSync(loaded, text)
  await import(/* @vite-ignore */ loaded)
}

const calls = (): { backend: string; input: Record<string, unknown>; client?: unknown }[] =>
  (globalThis as { __calls?: never[] }).__calls ?? []

beforeEach(() => {
  root = mkdtempSync(join(__dirname, '.deno-cron-'))
  callbacks = new Map()
  ;(globalThis as { __calls?: unknown[] }).__calls = []
  vi.stubGlobal('Deno', {
    cron: (name: string, _schedule: string, cb: Callback) => callbacks.set(name, cb),
  })
  write('backend-base.ts', backendSource('base'))
  write('backend-env.ts', backendSource('env'))
  write(
    'theo.config.ts',
    `import { backend } from './backend-base.ts'\nexport default { jobs: { backend } }\n`,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('Deno import map for the cron entry configs', () => {
  it('maps bare packages imported by a module the env override config reaches', async () => {
    write(
      'theo.config.production.ts',
      `import { backend } from './lib/backend.js'\nexport default { jobs: { backend } }\n`,
    )
    write('lib/backend.ts', `import { Pool } from 'pg'\nexport const backend = new Pool()\n`)
    vi.stubEnv('NODE_ENV', 'production')
    const { readProjectSourcesFromDisk, bareSpecifiersOf } =
      await import('../../packages/theo/src/adapters/deno-deploy.js')
    const sources = readProjectSourcesFromDisk(root, {
      serverDir: 'server',
      agentsDir: 'agents',
    } as never)
    expect(bareSpecifiersOf(sources)).toContain('pg')
  })
})

describe('Deno import map built through the build wiring', () => {
  it('keeps deno.json aliases and maps the env override config dependencies', async () => {
    write('deno.json', JSON.stringify({ imports: { '@app/backend': './lib/backend.ts' } }))
    write(
      'theo.config.production.ts',
      `import { backend } from '@app/backend'\nimport { z } from 'zod'\nexport default { jobs: { backend }, z }\n`,
    )
    write('lib/backend.ts', `import { Pool } from 'pg'\nexport const backend = new Pool()\n`)
    vi.stubEnv('NODE_ENV', 'production')
    const { buildDeno } = await import('../../packages/theo/src/adapters/deno-deploy.js')
    const written = new Map<string, string>()
    await buildDeno({ port: 3000, serverDir: 'server', agentsDir: 'agents' } as never, root, {
      runNodeBuild: async () => {},
      writeEntry: (path, content) => written.set(path, content),
      ensureDir: () => {},
      copyClient: () => {},
    })
    const emitted = JSON.parse(written.get(join(root, 'deno.json')) ?? '{}') as {
      imports: Record<string, string>
    }
    expect(emitted.imports['@app/backend']).toBe('./lib/backend.ts')
    expect(emitted.imports.zod).toBe('npm:zod')
  })
})

describe('renderDenoConfig', () => {
  it('keeps a project alias instead of remapping it to npm:', async () => {
    const { renderDenoConfig } = await import('../../packages/theo/src/adapters/deno-deploy.js')
    const out = renderDenoConfig({
      specifiers: ['@app/backend', '@lib/x', 'pg'],
      existing: { imports: { '@app/backend': './lib/backend.ts', '@lib/': './lib/' } },
    })
    expect(out.imports).toEqual({
      '@app/backend': './lib/backend.ts',
      '@lib/': './lib/',
      pg: 'npm:pg',
    })
  })
})

describe('generated Deno cron entry', () => {
  it('pins the jobs import to the given theokit version', () => {
    const entry = join(root, '.theokit', 'crons-entry.ts')
    translateCronToDeno(entry, [], { theokitVersion: '1.2.3' })
    expect(readFileSync(entry, 'utf8')).toContain('"npm:theokit@1.2.3/server/jobs"')
  })

  it('enqueues buffered jobs on the configured backend after the handler succeeds', async () => {
    await loadEntry(
      ['theo.config.ts'],
      `ctx.queue.enqueue('a', { n: 1 }); ctx.queue.enqueue('b', {})`,
    )
    await callbacks.get('job')!()
    expect(calls().map((c) => [c.backend, c.input.name])).toEqual([
      ['base', 'a'],
      ['base', 'b'],
    ])
  })

  it('uses the environment override backend over the base config', async () => {
    write(
      'theo.config.test.ts',
      `import { backend } from './backend-env.ts'\nexport default { jobs: { backend } }\n`,
    )
    await loadEntry(['theo.config.ts', 'theo.config.test.ts'], `ctx.queue.enqueue('a', {})`)
    await callbacks.get('job')!()
    expect(calls().map((c) => c.backend)).toEqual(['env'])
  })

  it('discards buffered jobs when the handler throws', async () => {
    await loadEntry(['theo.config.ts'], `ctx.queue.enqueue('a', {}); throw new Error('boom')`)
    await expect(callbacks.get('job')!()).rejects.toThrow('boom')
    expect(calls()).toEqual([])
  })

  it('propagates the trace id as a traceparent on enqueued jobs', async () => {
    await loadEntry(
      ['theo.config.ts'],
      `globalThis.__trace = ctx.traceId; ctx.queue.enqueue('a', {})`,
    )
    await callbacks.get('job')!()
    const trace = (globalThis as { __trace?: string }).__trace
    expect(calls()[0]?.input.traceparent).toMatch(new RegExp(`^00-${trace}-[0-9a-f]{16}-01$`))
  })

  it('forwards enqueueInTransaction to the configured backend immediately', async () => {
    await loadEntry(
      ['theo.config.ts'],
      `await ctx.queue.enqueueInTransaction({ tx: 1 }, 'a', {}); throw new Error('later')`,
    )
    await expect(callbacks.get('job')!()).rejects.toThrow('later')
    expect(calls()).toHaveLength(1)
    expect(calls()[0]?.client).toEqual({ tx: 1 })
  })

  it('runs without ctx.queue when no backend is configured', async () => {
    write('theo.config.ts', `export default {}\n`)
    await loadEntry(['theo.config.ts'], `globalThis.__q = ctx.queue`)
    await callbacks.get('job')!()
    expect((globalThis as { __q?: unknown }).__q).toBeUndefined()
  })
})
