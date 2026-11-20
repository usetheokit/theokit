import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)
const RUNNER = `
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const [root, mapJson, jobs, entry, distJobs] = process.argv.slice(2)
const map = JSON.parse(mapJson)
const cbs = new Map()
globalThis.Deno = { cron: (n, _s, cb) => cbs.set(n, cb), env: { get: (k) => process.env[k] } }
const mapped = (spec) => {
  if (map[spec] !== undefined) return map[spec]
  const prefix = Object.keys(map).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return prefix === undefined ? undefined : map[prefix] + spec.slice(prefix.length)
}
registerHooks({
  resolve(spec, ctx, next) {
    // Only the project's own modules are resolved by the map; the workspace source behind them is Node's.
    if (!ctx.parentURL?.startsWith(pathToFileURL(root).href)) return next(spec, ctx)
    if (/^npm:theokit(@[^/]*)?\\/server\\/jobs$/.test(spec)) {
      // The published package's own entry when it is built; its source module otherwise.
      return next(distJobs ? pathToFileURL(distJobs).href : pathToFileURL(jobs).href, ctx)
    }
    if (spec.startsWith('npm:')) throw new Error('unmapped ' + spec)
    if (/^(\\.|\\/|node:|file:)/.test(spec)) return next(spec, ctx)
    const target = mapped(spec)
    if (target === undefined) throw new Error('not in import map: ' + spec)
    if (target.startsWith('npm:')) return next(target.slice(4), ctx)
    return next(pathToFileURL(resolve(root, target)).href, ctx)
  },
})
let error
try {
  await import(pathToFileURL(entry).href)
  await cbs.get('job')()
} catch (e) {
  error = e.message
}
console.log(JSON.stringify({ error, calls: globalThis.__calls ?? [], trace: globalThis.__trace }))
`
const CLI = resolve(__dirname, '../../packages/theo/src/cli/index.ts')
const TSX = resolve(__dirname, '../../node_modules/.bin/tsx')
const JOBS = resolve(__dirname, '../../packages/theo/src/server/jobs/index.ts')

let root: string

/** An in-memory backend that records what reaches it. */
const backendSource = (label: string): string => `
export const calls = (globalThis.__calls ??= [])
export const backend = {
  name: '${label}',
  async dequeue() { return undefined },
  async ack() {},
  async nack() {},
  async enqueue(input) { calls.push({ backend: '${label}', input }); return { jobId: 'j' } },
  async enqueueInTransaction(client, input) { calls.push({ backend: '${label}', client, input }); return { jobId: 'tx' } },
}
`

const write = (rel: string, content: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

const calls = (): { backend: string; input: Record<string, unknown>; client?: unknown }[] =>
  (globalThis as { __calls?: never[] }).__calls ?? []

beforeEach(() => {
  root = mkdtempSync(join(__dirname, '.deno-cron-'))
  ;(globalThis as { __calls?: unknown[] }).__calls = []
  write('backend-base.ts', backendSource('base'))
  write('backend-env.ts', backendSource('env'))
  write(
    'theo.config.ts',
    `import { backend } from './backend-base.ts'\nexport default { jobs: { backend } }\n`,
  )
})

afterEach(() => {
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

/**
 * Build the project the way `theo build --target deno-deploy` does (emitted import map and
 * the cron entry), then load the entry resolving every bare import through the EMITTED map —
 * what Deno does. `npm:` targets resolve to stubs in node_modules; theokit to the workspace.
 */
async function loadBuiltEntry(handlerBody: string): Promise<() => Promise<void>> {
  const { buildDeno, readProjectSourcesFromDisk, bareSpecifiersOf } =
    await import('../../packages/theo/src/adapters/deno-deploy.js')
  const written = new Map<string, string>()
  const cfg = { port: 3000, serverDir: 'server', agentsDir: 'agents' } as never
  await buildDeno(cfg, root, {
    runNodeBuild: async () => {},
    writeEntry: (path, content) => written.set(path, content),
    ensureDir: () => {},
    copyClient: () => {},
  })
  const map = (
    JSON.parse(written.get(join(root, 'deno.json')) ?? '{}') as {
      imports: Record<string, string>
    }
  ).imports
  // The real CLI build writes the entry: scan, manifest, config paths and all.
  const DEFINE = resolve(__dirname, '../../packages/theo/src/server/cron/define-cron.ts')
  write(
    'package.json',
    JSON.stringify({ name: 'deno-cron-fixture', private: true, type: 'module' }),
  )
  write('app/page.tsx', 'export default function Page() { return null }\n')
  write('index.html', '<!doctype html><html><body></body></html>\n')
  write(
    'server/crons/job.ts',
    `import { defineCron } from '${DEFINE}'\nexport default defineCron('job', { schedule: '* * * * *', handler: async (ctx) => { ${handlerBody} } })\n`,
  )
  // The build may fail later (no Vite deps in the fixture); the cron entry is emitted before.
  try {
    execFileSync(TSX, [CLI, 'build', '--target=deno-deploy'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, THEOKIT_SKIP_NATIVE_PREFLIGHT: '1' },
    })
  } catch {
    // asserted through the entry below
  }
  const entry = join(root, '.theokit', 'crons-entry.ts')
  expect(existsSync(entry), 'CLI build emitted the cron entry').toBe(true)
  // Every bare specifier the config modules reach must be in the emitted map.
  for (const spec of bareSpecifiersOf(readProjectSourcesFromDisk(root, cfg))) {
    expect(map[spec], `${spec} is mapped`).toBeDefined()
  }
  // The entry and the configs load UNMODIFIED in a child process; a resolve hook applies the
  // emitted map the way Deno does (`npm:` targets resolve from node_modules, local targets
  // against the project root, the `theokit/server/jobs` specifier to the workspace source).
  const entryText = readFileSync(entry, 'utf8')
  expect(entryText).toMatch(/from\s+['"]npm:theokit/u)
  const runner = join(mkdtempSync(join(tmpdir(), 'deno-cron-runner-')), 'run.mjs')
  writeFileSync(runner, RUNNER)
  return async () => {
    const out = await execFileAsync(TSX, [runner, root, JSON.stringify(map), JOBS, entry, ''], {
      cwd: root,
      env: { ...process.env },
    })
    const res = JSON.parse(out.stdout.trim().split('\n').pop() ?? '{}') as {
      error?: string
      calls: never[]
      trace?: string
    }
    const g = globalThis as Record<string, unknown>
    g.__calls = res.calls
    g.__trace = res.trace
    if (res.error !== undefined) throw new Error(res.error)
  }
}

describe('generated entry loaded through the build wiring', () => {
  const stubPackage = (name: string): void => {
    write(
      `node_modules/${name}/package.json`,
      `{"name":"${name}","type":"module","main":"index.js"}`,
    )
    write(`node_modules/${name}/index.js`, `export const Pool = class { name = 'pg' }\n`)
  }

  it('resolves a deno.json alias and the override dependency, the override backend winning', async () => {
    write('deno.json', JSON.stringify({ imports: { '@app/backend': './lib/backend.ts' } }))
    stubPackage('pg')
    // Node (which loads the config during the CLI build) has no import map: give it the alias too.
    write(
      'node_modules/@app/backend/package.json',
      '{"name":"@app/backend","type":"module","main":"index.js"}',
    )
    write('node_modules/@app/backend/index.js', `export * from '../../../lib/backend.ts'\n`)
    write(
      'lib/backend.ts',
      `export const backend = { name: 'aliased', async dequeue() {}, async ack() {}, async nack() {}, async enqueue(input) { (globalThis.__calls ??= []).push({ backend: 'aliased', input }); return { jobId: 'j' } }, async enqueueInTransaction(client, input) { (globalThis.__calls ??= []).push({ backend: 'aliased-tx', client, input }); return { jobId: 'tx' } } }\n`,
    )
    write(
      'theo.config.ts',
      `import { backend } from '@app/backend'\nexport default { jobs: { backend } }\n`,
    )
    write(
      'theo.config.production.ts',
      `const { Pool } = await import('pg')\nexport default { jobs: { backend: { async enqueue(input) { (globalThis.__calls ??= []).push({ backend: new Pool().name, input }); return { jobId: 'p' } } } } }\n`,
    )
    vi.stubEnv('NODE_ENV', 'production')
    const run = await loadBuiltEntry(`ctx.queue.enqueue('a', {})`)
    await run()
    expect(calls().map((c) => c.backend)).toEqual(['pg'])
  })
})

describe('local alias precedence while reading config dependencies', () => {
  it('uses the exact alias over an earlier prefix, and the longest of overlapping prefixes', async () => {
    write(
      'deno.json',
      JSON.stringify({
        imports: {
          '@app/': './lib/',
          '@app/deep/': './lib/deep/',
          '@app/backend': './lib/real.ts',
        },
      }),
    )
    write('lib/backend.ts', `import { wrong } from 'wrong-pkg'\n`)
    write('lib/real.ts', `import { Pool } from 'pg'\nexport const x = Pool\n`)
    write('lib/deep/x.ts', `import { d } from 'deep-pkg'\n`)
    write('lib/x.ts', `import { w } from 'shallow-pkg'\n`)
    write('theo.config.ts', `import '@app/backend'\nimport '@app/deep/x'\nexport default {}\n`)
    const { readProjectSourcesFromDisk, bareSpecifiersOf } =
      await import('../../packages/theo/src/adapters/deno-deploy.js')
    const found = bareSpecifiersOf(
      readProjectSourcesFromDisk(root, { serverDir: 'server', agentsDir: 'agents' } as never),
    )
    expect(found).toContain('pg')
    expect(found).toContain('deep-pkg')
    expect(found).not.toContain('wrong-pkg')
    expect(found).not.toContain('shallow-pkg')
  })
})

describe('bareSpecifiersOf', () => {
  it('finds literal dynamic imports', async () => {
    const { bareSpecifiersOf } = await import('../../packages/theo/src/adapters/deno-deploy.js')
    expect(bareSpecifiersOf([`const { Pool } = await import('pg')`, `import("zod")`])).toEqual([
      'pg',
      'zod',
    ])
  })
})

describe('environment override without a base config', () => {
  it('is not read: loadConfig returns the defaults, so the map does not use it', async () => {
    rmSync(join(root, 'theo.config.ts'))
    write('theo.config.test.ts', `import 'only-in-override'\nexport default {}\n`)
    vi.stubEnv('NODE_ENV', 'test')
    const { readProjectSourcesFromDisk } =
      await import('../../packages/theo/src/adapters/deno-deploy.js')
    expect(
      readProjectSourcesFromDisk(root, { serverDir: 'server', agentsDir: 'agents' } as never),
    ).toEqual([])
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
  it('enqueues buffered jobs on the configured backend after the handler succeeds', async () => {
    const run = await loadBuiltEntry(`ctx.queue.enqueue('a', { n: 1 }); ctx.queue.enqueue('b', {})`)
    await run()
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
    const run = await loadBuiltEntry(`ctx.queue.enqueue('a', {})`)
    await run()
    expect(calls().map((c) => c.backend)).toEqual(['env'])
  })

  it('discards buffered jobs when the handler throws', async () => {
    const run = await loadBuiltEntry(`ctx.queue.enqueue('a', {}); throw new Error('boom')`)
    await expect(run()).rejects.toThrow('boom')
    expect(calls()).toEqual([])
  })

  it('propagates the trace id as a traceparent on enqueued jobs', async () => {
    const run = await loadBuiltEntry(`globalThis.__trace = ctx.traceId; ctx.queue.enqueue('a', {})`)
    await run()
    const trace = (globalThis as { __trace?: string }).__trace
    expect(calls()[0]?.input.traceparent).toMatch(new RegExp(`^00-${trace}-[0-9a-f]{16}-01$`))
  })

  it('forwards enqueueInTransaction to the configured backend immediately', async () => {
    const run = await loadBuiltEntry(
      `await ctx.queue.enqueueInTransaction({ tx: 1 }, 'a', {}); throw new Error('later')`,
    )
    await expect(run()).rejects.toThrow('later')
    expect(calls()).toHaveLength(1)
    expect(calls()[0]?.client).toEqual({ tx: 1 })
  })

  it('fails ctx.queue use when no backend is configured', async () => {
    write('theo.config.ts', `export default {}\n`)
    const run = await loadBuiltEntry(`ctx.queue.enqueue('a', {})`)
    await expect(run()).rejects.toThrow('ctx.queue is unavailable')
  })
})
