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
import { afterEach, describe, expect, it } from 'vitest'

import { generateClientDts } from '../../packages/theo/src/vite-plugin/app-typed-client.js'
import type { TheoManifest } from '../../packages/theo/src/server/scan/manifest.js'

const REPO_ROOT = resolve(__dirname, '../..')
const created: string[] = []

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

/**
 * Stage a project holding one route, the generated `client.d.ts` for it, and a probe that assigns
 * the response to `number`. Returns the diagnostics the compiler produced for the probe.
 */
function compileProbe(probeBody: string): readonly ts.Diagnostic[] {
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

  const probe = join(root, 'probe.ts')
  writeFileSync(probe, probeBody)

  const program = ts.createProgram({
    rootNames: [probe, join(root, '.theokit', 'client.d.ts')],
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

  return ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === probe)
}

describe('the generated @theo/client keeps its types', () => {
  it('reports the real response shape when it is assigned to the wrong type', () => {
    const diagnostics = compileProbe(
      [
        "import { client } from '@theo/client'",
        'export async function run() {',
        '  const res = await client.health.get()',
        '  const wrong: number = res',
        '  return wrong',
        '}',
        '',
      ].join('\n'),
    )

    // Silence here is the defect: `any` assigns to `number` without complaint.
    expect(diagnostics.length).toBeGreaterThan(0)
    const message = diagnostics
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
      .join('\n')
    expect(message).toContain('not assignable to type')
    // The shape has to be the ROUTE's, not some other error that happens to fire.
    expect(message).toContain('uptime')
  })

  it('accepts the response when it is assigned to the shape the route returns', () => {
    const diagnostics = compileProbe(
      [
        "import { client } from '@theo/client'",
        'export async function run() {',
        '  const res: { status: string; uptime: number } = await client.health.get()',
        '  return res',
        '}',
        '',
      ].join('\n'),
    )

    expect(
      diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('\n'),
    ).toBe('')
  })
})
