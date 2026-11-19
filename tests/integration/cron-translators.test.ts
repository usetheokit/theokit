import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { tmpdir } from 'node:os'
import { createHandlerQueue } from '../../packages/theo/src/server/jobs/queue-client.js'

import {
  translateCronToAws,
  translateCronToCloudflare,
  DENO_UNAVAILABLE_QUEUE,
  translateCronToDeno,
  translateCronToVercel,
  ExistingConfigUnparseableError,
} from '../../packages/theo/src/server/cron/adapter-translators.js'
import type { CronManifestEntry } from '../../packages/theo/src/server/cron/cron-manifest.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-cron-trans-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const cron = (name: string, schedule: string): CronManifestEntry => ({
  name,
  filePath: `server/crons/${name}.ts`,
  schedule,
  concurrency: 'forbid',
})

// ──────────────────────── Vercel ────────────────────────

describe('Vercel cron translator (T1.5 + EC-105)', () => {
  it('emits crons[] in vercel.json when file does not exist', () => {
    const vercelJson = join(root, 'vercel.json')
    translateCronToVercel(vercelJson, [cron('foo', '0 9 * * *')])
    const json = JSON.parse(readFileSync(vercelJson, 'utf8')) as Record<string, unknown>
    const crons = json.crons as Array<{ path: string; schedule: string }>
    expect(crons.length).toBe(1)
    expect(crons[0].path).toBe('/api/__crons/foo')
    expect(crons[0].schedule).toBe('0 9 * * *')
  })

  it('preserves existing fields (functions, headers, redirects) when merging', () => {
    const vercelJson = join(root, 'vercel.json')
    writeFileSync(
      vercelJson,
      JSON.stringify({
        functions: { 'api/x.ts': { maxDuration: 30 } },
        headers: [{ source: '/(.*)', headers: [{ key: 'X-Foo', value: 'bar' }] }],
        redirects: [{ source: '/old', destination: '/new', permanent: true }],
      }),
    )
    translateCronToVercel(vercelJson, [cron('a', '0 1 * * *')])
    const after = JSON.parse(readFileSync(vercelJson, 'utf8')) as Record<string, unknown>
    expect(after.functions).toEqual({ 'api/x.ts': { maxDuration: 30 } })
    expect(after.headers).toBeDefined()
    expect(after.redirects).toBeDefined()
    expect(after.crons).toBeDefined()
  })

  it('overwrites existing crons[] (managed slice)', () => {
    const vercelJson = join(root, 'vercel.json')
    writeFileSync(
      vercelJson,
      JSON.stringify({
        crons: [{ path: '/api/stale', schedule: '* * * * *' }],
      }),
    )
    translateCronToVercel(vercelJson, [cron('new', '0 0 * * *')])
    const after = JSON.parse(readFileSync(vercelJson, 'utf8')) as { crons: Array<{ path: string }> }
    expect(after.crons.length).toBe(1)
    expect(after.crons[0].path).toBe('/api/__crons/new')
  })

  it('throws ExistingConfigUnparseableError on garbage JSON', () => {
    const vercelJson = join(root, 'vercel.json')
    writeFileSync(vercelJson, '{ not valid json')
    expect(() => translateCronToVercel(vercelJson, [])).toThrow(ExistingConfigUnparseableError)
  })

  it('emits empty crons[] when input is empty', () => {
    const vercelJson = join(root, 'vercel.json')
    translateCronToVercel(vercelJson, [])
    const after = JSON.parse(readFileSync(vercelJson, 'utf8')) as { crons: unknown[] }
    expect(after.crons).toEqual([])
  })
})

// ──────────────────────── Cloudflare ────────────────────────

describe('Cloudflare cron translator (T1.5 + EC-105)', () => {
  it('emits [triggers] crons array when file does not exist', () => {
    const wrangler = join(root, 'wrangler.toml')
    translateCronToCloudflare(wrangler, [cron('foo', '0 9 * * *'), cron('bar', '*/15 * * * *')])
    const content = readFileSync(wrangler, 'utf8')
    expect(content).toMatch(/\[triggers\]/)
    expect(content).toMatch(/crons\s*=\s*\["0 9 \* \* \*", "\*\/15 \* \* \* \*"\]/)
  })

  it('preserves existing top-level config (name, main, compatibility_date)', () => {
    const wrangler = join(root, 'wrangler.toml')
    writeFileSync(
      wrangler,
      `name = "my-worker"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[vars]
FOO = "bar"
`,
    )
    translateCronToCloudflare(wrangler, [cron('a', '0 1 * * *')])
    const content = readFileSync(wrangler, 'utf8')
    expect(content).toContain('name = "my-worker"')
    expect(content).toContain('main = "src/index.ts"')
    expect(content).toContain('compatibility_date = "2026-01-01"')
    expect(content).toContain('[vars]')
    expect(content).toContain('FOO = "bar"')
    expect(content).toContain('[triggers]')
  })

  it('replaces existing [triggers] crons line in-place', () => {
    const wrangler = join(root, 'wrangler.toml')
    writeFileSync(
      wrangler,
      `name = "w"

[triggers]
crons = ["* * * * *"]
`,
    )
    translateCronToCloudflare(wrangler, [cron('new', '0 0 * * *')])
    const content = readFileSync(wrangler, 'utf8')
    expect(content).toContain('crons = ["0 0 * * *"]')
    // Old schedule replaced — should not appear as a managed cron value
    expect(content.match(/crons\s*=/g)?.length).toBe(1)
  })
})

// ──────────────────────── AWS Lambda ────────────────────────

describe('AWS Lambda cron translator (T1.5 + EC-105)', () => {
  it('inserts ? in DOW when DOM is *', () => {
    const yml = join(root, 'serverless.yml')
    translateCronToAws(yml, [cron('foo', '0 9 * * *')])
    const content = readFileSync(yml, 'utf8')
    expect(content).toContain('cron(0 9 * * ? *)')
  })

  it('inserts ? in DOM when DOW is specific', () => {
    const yml = join(root, 'serverless.yml')
    translateCronToAws(yml, [cron('foo', '0 9 * * MON')])
    const content = readFileSync(yml, 'utf8')
    expect(content).toContain('cron(0 9 ? * MON *)')
  })

  it('preserves existing service + provider config', () => {
    const yml = join(root, 'serverless.yml')
    writeFileSync(
      yml,
      `service: my-app
provider:
  name: aws
  runtime: nodejs22.x

functions:
  userAuth:
    handler: src/auth.handler
`,
    )
    translateCronToAws(yml, [cron('daily', '0 0 * * *')])
    const content = readFileSync(yml, 'utf8')
    expect(content).toContain('service: my-app')
    expect(content).toContain('userAuth:')
    expect(content).toContain('handler: src/auth.handler')
    expect(content).toContain('cron(0 0 * * ? *)')
  })
})

// ──────────────────────── Deno Deploy ────────────────────────

describe('Deno Deploy cron translator (T1.5)', () => {
  it('emits Deno.cron registrations', () => {
    const entry = join(root, 'crons-entry.ts')
    translateCronToDeno(entry, [cron('morning', '0 9 * * *'), cron('hourly', '0 * * * *')])
    const content = readFileSync(entry, 'utf8')
    expect(content).toMatch(/Deno\.cron\("morning",\s*"0 9 \* \* \*"/)
    expect(content).toMatch(/Deno\.cron\("hourly",\s*"0 \* \* \* \*"/)
  })

  it('overwrites existing entry file (managed file)', () => {
    const entry = join(root, 'crons-entry.ts')
    writeFileSync(entry, '// stale content')
    translateCronToDeno(entry, [cron('fresh', '* * * * *')])
    const content = readFileSync(entry, 'utf8')
    expect(content).not.toContain('stale')
    expect(content).toContain('fresh')
  })
})

describe('Deno cron context queue', () => {
  it('passes a queue that fails clearly, since no jobs.backend is loaded', () => {
    const entry = join(root, 'crons-queue-entry.ts')
    translateCronToDeno(entry, [cron('q', '* * * * *')])
    const content = readFileSync(entry, 'utf8')
    expect(content).toContain('queue: unavailableQueue')
    expect(content).toContain('no jobs.backend')
  })

  it('wires the configured jobs.backend and a per-run outbox when given the config import', () => {
    const entry = join(root, 'crons-wired-entry.ts')
    translateCronToDeno(entry, [cron('q', '* * * * *')], { configImport: '../theo.config.ts' })
    const content = readFileSync(entry, 'utf8')
    expect(content).toContain('from "npm:theokit/server/jobs"')
    expect(content).toContain('"../theo.config.ts"')
    expect(content).toContain('createHandlerQueue(backend')
    expect(content).toContain('run.discard()')
    expect(content).toContain('await run.flush()')
    expect(content).not.toContain('unavailableQueue')
  })

  it('generates a queue that type-checks as a QueueClient', () => {
    const file = join(root, 'queue-typecheck.ts')
    const queueTypes = resolve('packages/theo/src/server/jobs/queue-client.ts')
    writeFileSync(
      file,
      `import type { QueueClient } from ${JSON.stringify(queueTypes)}\n${DENO_UNAVAILABLE_QUEUE}\nexport const q: QueueClient = unavailableQueue\n`,
    )
    const options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      types: [],
    }
    const program = ts.createProgram([file], options)
    const errors = ts
      .getPreEmitDiagnostics(program, program.getSourceFile(file))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(errors).toEqual([])
  })

  it('imports theokit through an npm: specifier Deno can resolve', () => {
    const entry = join(root, 'crons-npm-entry.ts')
    translateCronToDeno(entry, [cron('q', '* * * * *')], { configImport: '../theo.config.ts' })
    expect(readFileSync(entry, 'utf8')).toContain('from "npm:theokit/server/jobs"')
  })
})

/**
 * Run the generated Deno entry under Node: Deno.cron is captured, imports come from `modules` (a
 * module id missing there fails, as an unresolvable import does in Deno). Compiled as a System
 * module, which keeps the entry's top-level await and its lazy `import()` calls. `loaded` collects
 * every module id the entry asked for.
 */
async function runDenoEntry(
  content: string,
  modules: Record<string, unknown>,
  env: string | undefined,
  loaded: string[] = [],
): Promise<Map<string, () => Promise<void>>> {
  const js = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.System, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const crons = new Map<string, () => Promise<void>>()
  const deno = {
    cron: (name: string, _schedule: string, fn: () => Promise<void>) => crons.set(name, fn),
    env: { get: (k: string) => (k === 'NODE_ENV' ? env : undefined) },
  }
  const load = (id: string): unknown => {
    loaded.push(id)
    if (!(id in modules)) throw new Error(`unexpected import ${id}`)
    return modules[id]
  }
  type Registered = {
    setters: Array<(m: unknown) => void>
    execute: () => Promise<void>
  }
  let register: (() => Registered) | undefined
  let deps: string[] = []
  const System = {
    register: (d: string[], fn: (e: unknown, ctx: unknown) => Registered) => {
      deps = d
      register = () => fn(() => undefined, { import: (id: string) => Promise.resolve(load(id)) })
    },
  }
  // eslint-disable-next-line sonarjs/code-eval -- executes generated cron entry in a sandboxed vm context under test
  runInNewContext(js, { System, Deno: deno, crypto, AbortSignal, Date, Object })
  const mod = register!()
  deps.forEach((d, i) => mod.setters[i]!(load(d)))
  await mod.execute()
  return crons
}

describe('generated Deno cron entry, executed', () => {
  const backendOf = (calls: unknown[], extra: Record<string, unknown> = {}) => ({
    name: 'fake',
    enqueue: (e: unknown) => {
      calls.push(e)
      return Promise.resolve({ jobId: 'j1' })
    },
    ...extra,
  })

  const generate = (envConfigImports?: Record<string, string>): string => {
    const entry = join(root, 'run-entry.ts')
    translateCronToDeno(entry, [cron('probe', '* * * * *')], {
      configImport: '../theo.config.ts',
      envConfigImports,
    })
    return readFileSync(entry, 'utf8')
  }
  const base = (modules: Record<string, unknown>) => ({
    'npm:theokit/server/jobs': { createHandlerQueue },
    ...modules,
  })

  it('flushes enqueued jobs to the configured backend with a trace id', async () => {
    const calls: Array<{ name: string; traceparent?: string }> = []
    const crons = await runDenoEntry(
      generate(),
      base({
        '../theo.config.ts': { default: { jobs: { backend: backendOf(calls) } } },
        '../server/crons/probe.ts': {
          default: { handler: (ctx: any) => ctx.queue.enqueue('next', { a: 1 }) },
        },
      }),
      undefined,
    )
    await crons.get('probe')!()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe('next')
    expect(calls[0]!.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('propagates the run trace id into the enqueued job traceparent', async () => {
    const calls: Array<{ traceparent?: string }> = []
    let traceId = ''
    const crons = await runDenoEntry(
      generate(),
      base({
        '../theo.config.ts': { default: { jobs: { backend: backendOf(calls) } } },
        '../server/crons/probe.ts': {
          default: {
            handler: (ctx: any) => {
              traceId = ctx.traceId
              ctx.queue.enqueue('next', {})
            },
          },
        },
      }),
      undefined,
    )
    await crons.get('probe')!()
    expect(calls[0]!.traceparent!.split('-')[1]).toBe(traceId)
  })

  it('discards buffered jobs when the handler throws', async () => {
    const calls: unknown[] = []
    const crons = await runDenoEntry(
      generate(),
      base({
        '../theo.config.ts': { default: { jobs: { backend: backendOf(calls) } } },
        '../server/crons/probe.ts': {
          default: {
            handler: (ctx: any) => {
              ctx.queue.enqueue('next', {})
              throw new Error('boom')
            },
          },
        },
      }),
      undefined,
    )
    await expect(crons.get('probe')!()).rejects.toThrow('boom')
    expect(calls).toEqual([])
  })

  it('forwards enqueueInTransaction to the backend with the caller client', async () => {
    const txCalls: Array<{ client: unknown; entry: { name: string; traceparent?: string } }> = []
    const backend = backendOf([], {
      enqueueInTransaction: (client: unknown, entry: { name: string }) => {
        txCalls.push({ client, entry })
        return Promise.resolve({ jobId: 'tx1' })
      },
    })
    const client = { tx: true }
    let result: unknown
    const crons = await runDenoEntry(
      generate(),
      base({
        '../theo.config.ts': { default: { jobs: { backend } } },
        '../server/crons/probe.ts': {
          default: {
            handler: async (ctx: any) => {
              result = await ctx.queue.enqueueInTransaction(client, 'resume', { id: 1 })
            },
          },
        },
      }),
      undefined,
    )
    await crons.get('probe')!()
    expect(result).toEqual({ jobId: 'tx1' })
    expect(txCalls[0]!.client).toBe(client)
    expect(txCalls[0]!.entry.name).toBe('resume')
    expect(txCalls[0]!.entry.traceparent).toBeDefined()
  })

  it('lets the NODE_ENV override config supply the backend', async () => {
    const baseCalls: unknown[] = []
    const prodCalls: unknown[] = []
    const modules = base({
      '../theo.config.ts': { default: { jobs: { backend: backendOf(baseCalls) } } },
      '../theo.config.production.ts': { default: { jobs: { backend: backendOf(prodCalls) } } },
      '../server/crons/probe.ts': {
        default: { handler: (ctx: any) => ctx.queue.enqueue('next', {}) },
      },
    })
    const content = generate({ production: '../theo.config.production.ts' })
    await (await runDenoEntry(content, modules, 'production')).get('probe')!()
    await (await runDenoEntry(content, modules, 'development')).get('probe')!()
    expect(prodCalls).toHaveLength(1)
    expect(baseCalls).toHaveLength(1)
  })

  it('does not load an override that NODE_ENV did not select', async () => {
    const calls: unknown[] = []
    const loaded: string[] = []
    const modules = base({
      '../theo.config.ts': { default: { jobs: { backend: backendOf(calls) } } },
      '../server/crons/probe.ts': {
        default: { handler: (ctx: any) => ctx.queue.enqueue('next', {}) },
      },
    })
    const content = generate({ development: '../theo.config.development.ts' })
    const crons = await runDenoEntry(content, modules, 'production', loaded)
    await crons.get('probe')!()
    expect(loaded).not.toContain('../theo.config.development.ts')
    expect(calls).toHaveLength(1)
  })

  it('migrates the backend before any cron runs', async () => {
    const order: string[] = []
    const backend = backendOf([], {
      migrate: () => {
        order.push('migrate')
        return Promise.resolve()
      },
    })
    const modules = base({
      '../theo.config.ts': { default: { jobs: { backend } } },
      '../server/crons/probe.ts': { default: { handler: () => order.push('handler') } },
    })
    const crons = await runDenoEntry(generate(), modules, undefined)
    expect(order).toEqual(['migrate'])
    await crons.get('probe')!()
    expect(order).toEqual(['migrate', 'handler'])
  })
})
