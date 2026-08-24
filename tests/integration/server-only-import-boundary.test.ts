/**
 * ROADMAP M1, third bullet — "importing a server-only module from client code fails the build with
 * an error naming both the module and the importing file" (usetheokit/theokit#373).
 *
 * ## Which production path this exercises
 *
 * The whole one. Each case spawns the real CLI — `packages/theo/src/cli/index.ts build` — against a
 * project on disk, so the chain under test is `theokit build` → `runAdapterBuild` →
 * `nodeAdapter.build` → `viteBuild({ plugins: await ctx.makeVitePlugins(...) })` → the plugin array
 * `theoPluginAsync` returns → Rollup's `resolveId` on every import in the client graph. Nothing here
 * calls the detector directly.
 *
 * That distinction is the point. A test that imports `serverOnlyImportBoundary` and calls its
 * hook proves the function works; it cannot prove a consumer ever reaches it, and #373 was filed
 * precisely because the guarantee the ROADMAP claims was measured against `theokit build` and was
 * not there. So this file pays the ~5 s per build to assert the message a consumer actually sees.
 *
 * ## Why a green build is one of the cases
 *
 * `server/actions/schemas/**` is deliberately isomorphic: the `@theo/actions` virtual module emits
 * `import { schema } from '<abs path>'` into the CLIENT facade for exactly those files
 * (`vite-plugin/actions-virtual-module.ts`). A boundary that refused everything under `server/`
 * would break a shipped feature while every "does it refuse?" assertion stayed green. The clean
 * build below is what makes that impossible to miss — it is a fixture the detector cannot satisfy
 * by agreeing with itself, because the schema import is written by the framework, not by the test.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../..')
const CLI = resolve(REPO, 'packages/theo/src/cli/index.ts')
const TSX = resolve(REPO, 'node_modules/.bin/tsx')

let projectDir: string

/** Write a file inside the fixture project, creating parent directories. */
function write(relPath: string, contents: string): void {
  const full = join(projectDir, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

/**
 * Run the real `theokit build` and return everything it printed plus whether it exited non-zero.
 *
 * stdout and stderr are merged because Vite writes the build failure to stderr while the CLI's own
 * progress goes to stdout, and a consumer reads one terminal.
 */
function runBuild(): { failed: boolean; output: string } {
  try {
    const output = execFileSync(TSX, [CLI, 'build'], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${resolve(REPO, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        // The fixture installs no native bindings; the Node-floor check stays on.
        THEOKIT_SKIP_NATIVE_PREFLIGHT: '1',
      },
    })
    return { failed: false, output }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string }
    return { failed: true, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` }
  }
}

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'theo-server-boundary-'))

  // Resolve `theokit` to the workspace source, and borrow the repository's installed dependencies
  // (react, vite, react-router, zod, …) so a build runs without a `pnpm install` in the tmpdir.
  const nodeModules = join(projectDir, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(nodeModules, 'theokit'), 'dir')
  for (const entry of readdirSync(resolve(REPO, 'node_modules'))) {
    if (entry === 'theokit') continue
    symlinkSync(resolve(REPO, 'node_modules', entry), join(nodeModules, entry), 'dir')
  }
  // `devalue` is a dependency of `theokit`, not of the app, and the `@theo/actions` facade
  // imports it from the app's root context. A hoisting installer puts it here; pnpm's strict
  // layout leaves it under `packages/theo/node_modules`, so the fixture places it by hand.
  symlinkSync(
    resolve(REPO, 'packages/theo/node_modules/devalue'),
    join(nodeModules, 'devalue'),
    'dir',
  )

  write(
    'package.json',
    `${JSON.stringify({ name: 'server-boundary-fixture', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
  )
  write('theo.config.ts', "import { config } from 'theokit'\n\nexport default config().build()\n")
  write(
    'index.html',
    '<!doctype html>\n<html lang="en">\n  <head><title>fixture</title></head>\n  <body><div id="root"></div></body>\n</html>\n',
  )
  write(
    'app/layout.tsx',
    "import type { ReactNode } from 'react'\n\n" +
      'export default function Layout({ children }: { children: ReactNode }) {\n' +
      '  return <div>{children}</div>\n}\n',
  )
  write('app/page.tsx', 'export default function Page() {\n  return <p>home</p>\n}\n')

  // Server surface. `health.ts` reaches `theokit/server/define`, which is what makes a client page
  // importing it a two-hop mistake rather than a one-hop one.
  write(
    'server/routes/health.ts',
    "import { route } from 'theokit/server/define'\n\n" +
      "export const GET = route()\n  .policy('public')\n  .handler(() => ({ status: 'ok' }))\n  .build()\n",
  )

  // The isomorphic exception, written the way the framework's own convention says to write it.
  write(
    'server/actions/schemas/greet.ts',
    "import { z } from 'zod'\n\nexport const schema = z.object({ name: z.string() })\n",
  )
  write(
    'server/actions/greet.ts',
    "import { schema } from './schemas/greet.js'\n\n" +
      'export default {\n  input: schema,\n' +
      '  handler: ({ input }: { input: { name: string } }) => ({ greeting: `hi ${input.name}` }),\n}\n',
  )
}, 60_000)

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('server-only import boundary — measured through `theokit build`', () => {
  it('builds green when the client graph stays on its side of the boundary', () => {
    // Arrange: an ordinary page, plus a page that pulls the ACTIONS facade — which makes Vite
    // resolve `server/actions/schemas/greet.ts` into the client bundle by the framework's own hand.
    write(
      'app/about/page.tsx',
      "import { actions } from '@theo/actions'\n\n" +
        'export default function AboutPage() {\n' +
        '  return <button onClick={() => void actions.greet({ name: 42 })}>greet</button>\n}\n',
    )

    // Act
    const { failed, output } = runBuild()

    // Assert: no false positive. If this fails, the boundary is refusing something the framework
    // itself puts in the client graph, and no amount of green refusal tests would have shown it.
    expect(failed, output).toBe(false)
  }, 120_000)

  it('refuses `theokit/server` from a client page, naming the module and the importing file', () => {
    // Arrange: repro A of usetheokit/theokit#373.
    write(
      'app/about/page.tsx',
      "import { defineRoute } from 'theokit/server'\n\n" +
        'export default function AboutPage() {\n' +
        '  return <p>{String(typeof defineRoute)}</p>\n}\n',
    )

    // Act
    const { failed, output } = runBuild()

    // Assert: the two names the ROADMAP criterion asks for, in the output a consumer reads.
    expect(failed, output).toBe(true)
    expect(output).toContain('theokit/server')
    expect(output).toContain('app/about/page.tsx')
    // …and NOT the bundler-internals message #373 was filed about.
    expect(output).not.toContain('__vite-browser-external')
  }, 120_000)

  it('refuses a `theokit/server/<subpath>` import, not ENOTDIR on a concatenated path', () => {
    // Arrange: the second half of #373 — the `theokit/server` string alias in `config-hook.ts`
    // matches by prefix, so `theokit/server/define` used to resolve to `…/server/index.js/define`.
    write(
      'app/about/page.tsx',
      "import { route } from 'theokit/server/define'\n\n" +
        'export default function AboutPage() {\n' +
        '  return <p>{String(typeof route)}</p>\n}\n',
    )

    // Act
    const { failed, output } = runBuild()

    // Assert
    expect(failed, output).toBe(true)
    expect(output).toContain('theokit/server/define')
    expect(output).toContain('app/about/page.tsx')
    expect(output).not.toContain('ENOTDIR')
  }, 120_000)

  it("refuses the project's own server module, naming the page rather than a transitive hop", () => {
    // Arrange: repro B of #373. The page reaches `server/routes/health.ts`, which itself imports
    // `theokit/server/define` — so a boundary that only knew the framework surface would name
    // `health.ts` as the importer and leave the developer's actual mistake unnamed.
    write(
      'app/about/page.tsx',
      "import { GET } from '../../server/routes/health.js'\n\n" +
        'export default function AboutPage() {\n' +
        '  return <p>{String(typeof GET)}</p>\n}\n',
    )

    // Act
    const { failed, output } = runBuild()

    // Assert
    expect(failed, output).toBe(true)
    expect(output).toContain('server/routes/health.ts')
    expect(output).toContain('app/about/page.tsx')
  }, 120_000)

  it('allows a type-only import of the server surface — the remedy the error names', () => {
    // Arrange: the error text tells the reader to make the import type-only. That advice is a lie
    // unless a type-only import actually survives the build, so the claim is measured here.
    write(
      'app/about/page.tsx',
      "import type { TheoPlugin } from 'theokit/server'\n\n" +
        'export default function AboutPage(props: { plugin?: TheoPlugin }) {\n' +
        '  return <p>{String(Boolean(props.plugin))}</p>\n}\n',
    )

    // Act
    const { failed, output } = runBuild()

    // Assert
    expect(failed, output).toBe(false)
  }, 120_000)
})
