/**
 * usetheokit/theokit#469 — the generated client must produce a TYPE, not `any`.
 *
 * `generate-client-dts.test.ts` asserts the emitted STRING, down to the exact alias
 * (`import type { GET as _r0_GET }`). That is the one thing it cannot check: whether the string it
 * pins actually type-checks. It pinned a pattern that silently collapses.
 *
 * Inside a `declare module` block, a relative `import type` aliased and then fed to an external
 * package's conditional type resolves to `any` — with no error, which is what makes it invisible.
 * Measured: the same alias fed to `Awaited<ReturnType<…>>` survives, and `InferResponse` applied in
 * an ordinary `.ts` file survives, so neither the alias alone nor the type alone is the fault. It is
 * the combination, and only compiling the generated output can see it.
 *
 * So this file compiles it. A probe assigns the client's response to `number`; if the type survived
 * the compiler says so, and if it collapsed to `any` the compiler says nothing — which is the
 * failure being guarded.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateClientDts } from '../../packages/theo/src/vite-plugin/app-typed-client.js'
import type { TheoManifest } from '../../packages/theo/src/server/scan/manifest.js'

const REPO_ROOT = resolve(__dirname, '../..')
const created: string[] = []

afterAll(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

/**
 * Both probes, compiled in ONE program (usetheokit/theokit#635).
 *
 * Each probe used to build its own `ts.Program`, and a program re-reads and re-parses the
 * TypeScript `lib.*.d.ts` files plus the whole `theokit/client` source tree behind the `paths`
 * mapping. Two probes, two copies of identical work; only the probe itself differs.
 *
 * On a workstation that duplication is invisible. Measured 2026-09-02 with the process constrained
 * to 4 CPUs — the shape of a CI runner — this file took 65s inside a full run and blew its per-test
 * timeout. Caching the parsed files across the two calls brought it to 50s, which still failed:
 * the second program is cheap once the files are cached, and the FIRST one is the cost. One program
 * is what removes it.
 *
 * The oracle is unchanged. Diagnostics were already filtered by probe file name — two probes in one
 * program are two independent modules, and each test still reads only its own.
 */
interface Probe {
  readonly name: string
  readonly body: string
}

/** Diagnostics per probe name, from a single compilation of all of them. */
function compileProbes(probes: readonly Probe[]): Map<string, readonly ts.Diagnostic[]> {
  const root = mkdtempSync(join(tmpdir(), 'client-dts-'))
  created.push(root)
  mkdirSync(join(root, 'server', 'routes'), { recursive: true })
  mkdirSync(join(root, '.theokit'), { recursive: true })

  writeFileSync(
    join(root, 'server', 'routes', 'health.ts'),
    "export const GET = { handler: () => ({ status: 'ok', uptime: 1 }) }\n",
  )

  const manifest: TheoManifest = {
    version: 1,
    generatedAt: '2026-06-01T00:00:00.000Z',
    routes: [
      { filePath: 'routes/health.ts', routePath: '/api/health', paramNames: [], methods: ['GET'] },
    ],
    actions: [],
    websockets: [],
  }

  writeFileSync(
    join(root, '.theokit', 'client.d.ts'),
    generateClientDts({
      manifest,
      dtsOutPath: join(root, '.theokit', 'client.d.ts'),
      serverDir: join(root, 'server'),
    }),
  )

  const paths = new Map<string, string>()
  for (const probe of probes) {
    const file = join(root, `${probe.name}.ts`)
    writeFileSync(file, probe.body)
    paths.set(probe.name, file)
  }

  const program = ts.createProgram({
    rootNames: [...paths.values(), join(root, '.theokit', 'client.d.ts')],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      // The scaffold resolves `theokit/client` from node_modules; here it is the source, so the
      // test needs no build step and cannot drift from a stale `dist`.
      baseUrl: root,
      paths: { 'theokit/client': [resolve(REPO_ROOT, 'packages/theo/src/client/index.ts')] },
    },
  })

  const all = ts.getPreEmitDiagnostics(program)
  const byProbe = new Map<string, readonly ts.Diagnostic[]>()
  for (const [name, file] of paths) {
    byProbe.set(
      name,
      all.filter((d) => d.file?.fileName === file),
    )
  }
  return byProbe
}

const PROBES: readonly Probe[] = [
  {
    name: 'assigns-to-number',
    body: [
      "import { client } from '@theo/client'",
      'export async function run() {',
      '  const res = await client.health.get()',
      '  const wrong: number = res',
      '  return wrong',
      '}',
      '',
    ].join('\n'),
  },
  {
    name: 'assigns-to-the-route-shape',
    body: [
      "import { client } from '@theo/client'",
      'export async function run() {',
      '  const res: { status: string; uptime: number } = await client.health.get()',
      '  return res',
      '}',
      '',
    ].join('\n'),
  },
]

let diagnostics: Map<string, readonly ts.Diagnostic[]>

beforeAll(() => {
  diagnostics = compileProbes(PROBES)
}, 120_000)

const messagesFor = (name: string): string =>
  (diagnostics.get(name) ?? [])
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
    .join('\n')

describe('the generated @theo/client keeps its types', () => {
  it('reports the real response shape when it is assigned to the wrong type', () => {
    // Silence here is the defect: `any` assigns to `number` without complaint.
    expect(diagnostics.get('assigns-to-number')?.length ?? 0).toBeGreaterThan(0)

    const message = messagesFor('assigns-to-number')
    expect(message).toContain('not assignable to type')
    // The shape has to be the ROUTE's, not some other error that happens to fire.
    expect(message).toContain('uptime')
  })

  it('accepts the response when it is assigned to the shape the route returns', () => {
    expect(messagesFor('assigns-to-the-route-shape')).toBe('')
  })
})
