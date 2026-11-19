import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'

import { translateCronToDeno } from '../../packages/theo/src/server/cron/adapter-translators.js'

const CLI = resolve(__dirname, '../../packages/theo/src/cli/index.ts')
const TSX = resolve(__dirname, '../../node_modules/.bin/tsx')
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

/**
 * Build the project the way `theo build --target deno-deploy` does (emitted import map and
 * the cron entry), then load the entry resolving every bare import through the EMITTED map —
 * what Deno does. `npm:` targets resolve to stubs in node_modules; theokit to the workspace.
 */
async function loadBuiltEntry(handlerBody: string): Promise<void> {
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
  // The files `loadConfig` merges: the base config and the NODE_ENV override, when present.
  const configs = ['theo.config.ts', `theo.config.${process.env.NODE_ENV ?? ''}.ts`]
    .filter((n) => existsSync(join(root, n)))
    .map((n) => join(root, n))
  // The real CLI build writes the entry: scan, manifest, config paths and all.
  const DEFINE = resolve(__dirname, '../../packages/theo/src/server/cron/define-cron.ts')
  write('package.json', JSON.stringify({ name: 'deno-cron-fixture', private: true, type: 'module' }))
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
    /* asserted through the entry below */
  }
  const entry = join(root, '.theokit', 'crons-entry.ts')
  expect(existsSync(entry), 'CLI build emitted the cron entry').toBe(true)
  // Every bare specifier the config modules reach must be in the emitted map.
  for (const spec of bareSpecifiersOf(readProjectSourcesFromDisk(root, cfg))) {
    expect(map[spec], `${spec} is mapped`).toBeDefined()
  }
  const resolveSpec = (spec: string): string => {
    const target = map[spec]
    if (target === undefined) return spec
    if (target.startsWith('npm:')) return join(root, 'node_modules', spec, 'index.js')
    return resolve(root, target)
  }
  const rewrite = (text: string): string =>
    text.replace(/(from\s+['"])([^'".][^'"]*)(['"])/gu, (m, a, spec, c) =>
      map[spec] === undefined ? m : `${a}${resolveSpec(spec)}${c}`,
    )
  for (const rel of [...configs.map((c) => relative(root, c)), 'lib/backend.ts']) {
    if (existsSync(join(root, rel))) write(rel, rewrite(readFileSync(join(root, rel), 'utf8')))
  }
  // The entry itself is resolved by the same map: its `npm:theokit…/server/jobs` import is the
  // one specifier mapped to the workspace source instead of a stub package.
  const text = rewrite(readFileSync(entry, 'utf8')).replace(
    /npm:theokit[^"'/]*\/server\/jobs/u,
    JOBS,
  )
  expect(text).not.toMatch(/from\s+['"]npm:/u)
  const loaded = join(root, '.theokit', `built-${seq++}.ts`)
  writeFileSync(loaded, text)
  await import(/* @vite-ignore */ loaded)
}

describe('generated entry loaded through the build wiring', () => {
  const stubPackage = (name: string): void =>
    write(`node_modules/${name}/index.js`, `export const Pool = class { name = 'pg' }\n`)

  it('resolves a deno.json alias and the override dependency, merging a partial backend override', async () => {
    write('deno.json', JSON.stringify({ imports: { '@app/backend': './lib/backend.ts' } }))
    stubPackage('pg')
    write(
      'lib/backend.ts',
      `import { Pool } from 'pg'\nexport const pool = new Pool()\n` +
        `export const backend = { name: 'aliased', async enqueue(input) { (globalThis.__calls ??= []).push({ backend: 'aliased', input }); return { jobId: 'j' } }, async enqueueInTransaction(client, input) { (globalThis.__calls ??= []).push({ backend: 'aliased-tx', client, input }); return { jobId: 'tx' } } }\n`,
    )
    write(
      'theo.config.ts',
      `import { backend } from '@app/backend'\nexport default { jobs: { backend } }\n`,
    )
    // The override supplies only `enqueue`; `enqueueInTransaction` and `name` come from the base.
    write(
      'theo.config.production.ts',
      `export default { jobs: { backend: { async enqueue(input) { (globalThis.__calls ??= []).push({ backend: 'partial', input }); return { jobId: 'p' } } } } }\n`,
    )
    vi.stubEnv('NODE_ENV', 'production')
    await loadBuiltEntry(
      `ctx.queue.enqueue('a', {}); await ctx.queue.enqueueInTransaction({ tx: 1 }, 't', {})`,
    )
    await callbacks.get('job')!()
    expect(calls().map((c) => c.backend)).toEqual(['aliased-tx', 'partial'])
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
    await loadBuiltEntry(`ctx.queue.enqueue('a', { n: 1 }); ctx.queue.enqueue('b', {})`)
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
    await loadBuiltEntry(`ctx.queue.enqueue('a', {})`)
    await callbacks.get('job')!()
    expect(calls().map((c) => c.backend)).toEqual(['env'])
  })

  it('discards buffered jobs when the handler throws', async () => {
    await loadBuiltEntry(`ctx.queue.enqueue('a', {}); throw new Error('boom')`)
    await expect(callbacks.get('job')!()).rejects.toThrow('boom')
    expect(calls()).toEqual([])
  })

  it('propagates the trace id as a traceparent on enqueued jobs', async () => {
    await loadBuiltEntry(`globalThis.__trace = ctx.traceId; ctx.queue.enqueue('a', {})`)
    await callbacks.get('job')!()
    const trace = (globalThis as { __trace?: string }).__trace
    expect(calls()[0]?.input.traceparent).toMatch(new RegExp(`^00-${trace}-[0-9a-f]{16}-01$`))
  })

  it('forwards enqueueInTransaction to the configured backend immediately', async () => {
    await loadBuiltEntry(
      `await ctx.queue.enqueueInTransaction({ tx: 1 }, 'a', {}); throw new Error('later')`,
    )
    await expect(callbacks.get('job')!()).rejects.toThrow('later')
    expect(calls()).toHaveLength(1)
    expect(calls()[0]?.client).toEqual({ tx: 1 })
  })

  it('runs without ctx.queue when no backend is configured', async () => {
    write('theo.config.ts', `export default {}\n`)
    await loadBuiltEntry(`globalThis.__q = ctx.queue`)
    await callbacks.get('job')!()
    expect((globalThis as { __q?: unknown }).__q).toBeUndefined()
  })
})
