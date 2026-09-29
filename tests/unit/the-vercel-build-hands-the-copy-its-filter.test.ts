/**
 * The Vercel build must WIRE the shell filter, not merely have one available.
 *
 * `shouldCopyIntoStatic` is tested in its own file and answers correctly. That proves nothing about
 * the build: delete the `filter:` line and every one of those cases stays green while the defect
 * B-346 records returns — a deployed SSR project answering `/` with an empty `<div id="root">`.
 *
 * That gap was not hypothetical. Measured while this was written: **no test ran `vercelAdapter.build`
 * to completion.** `vercel-adapter.test.ts` and `vercel-adapter-shim.test.ts` assert its TYPE,
 * `services-other-adapters-reject.test.ts` makes it throw before it does anything, and nothing else
 * touched it. So the whole build carried zero coverage while a defect shipped inside it and reached a
 * live deployment.
 *
 * The seam (`VercelBuildDeps`) exists for this, and it is the shape `buildNetlify` and
 * `buildAwsLambda` already had — vercel was the one adapter of the three with its build inline on the
 * object, reachable only by running a real client bundle.
 *
 * ## What is stubbed, and what is NOT
 *
 * The client bundle and the function bundle are stubbed, because neither decides what lands in
 * `static/`. The copy itself is REAL: this drives `cpSync` against files on disk and then reads the
 * directory, so a filter that is present but wrong fails here exactly as it would on a deploy.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildVercel } from '../../packages/theo/src/adapters/vercel.js'

const roots: string[] = []

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'theo-vercel-'))
  roots.push(root)
  mkdirSync(join(root, '.theokit/client/assets'), { recursive: true })
  writeFileSync(
    join(root, '.theokit/client/index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
  )
  writeFileSync(join(root, '.theokit/client/assets/app-abc.js'), 'export const a = 1\n')
  writeFileSync(join(root, '.theokit/client/robots.txt'), 'User-agent: *\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }))
  return root
}

const CONFIG = {
  serverDir: 'src/server',
  agentsDir: 'src/server/agents',
  appDir: 'src/app',
  distDir: '.theokit',
  ssrStreaming: false,
  security: {},
}

async function run(root: string, ssr: boolean): Promise<void> {
  await buildVercel({ ...CONFIG, ssr } as never, root, {
    // Neither decides what lands in `static/`, and running them would need a real app and a vite
    // pass. The copy under test is NOT stubbed.
    runNodeBuild: async () => {},
    bundleFunction: async () => {},
  })
}

afterEach(() => {
  for (const r of roots.splice(0)) if (existsSync(r)) rmSync(r, { recursive: true, force: true })
})

describe('the Vercel build hands the copy its filter', () => {
  it('withholds the shell when the project renders its own document', async () => {
    const root = project()

    await run(root, true)

    expect(
      existsSync(join(root, '.vercel/output/static/index.html')),
      'the shell reached the static host, so Vercel answers `/` with it and the SSR route below ' +
        '`handle: filesystem` never runs — the defect measured on a live deployment as 694 bytes ' +
        'with an empty #root',
    ).toBe(false)
  })

  it('still ships everything the rendered page needs', async () => {
    // COUNTERPROOF, and the one that matters most: a filter that pruned a DIRECTORY would take every
    // asset with it, and the page would render into a 404 for its own script.
    const root = project()

    await run(root, true)

    expect(existsSync(join(root, '.vercel/output/static/assets/app-abc.js'))).toBe(true)
    expect(existsSync(join(root, '.vercel/output/static/robots.txt'))).toBe(true)
  })

  it('ships the shell when the project does not render one', async () => {
    // The other direction. `renderVercelConfigJson` sends `/(.*)` to `/index.html` for exactly this
    // case, so withholding it here would break a client-rendered project instead.
    const root = project()

    await run(root, false)

    expect(existsSync(join(root, '.vercel/output/static/index.html'))).toBe(true)
    expect(existsSync(join(root, '.vercel/output/static/assets/app-abc.js'))).toBe(true)
  })

  it('emits the routing config that the filter depends on', async () => {
    // The two halves are one fix: withholding the shell only helps because the last route sends a
    // missing path to the function. Asserting one without the other would let a later edit break the
    // pair and still pass.
    const root = project()

    await run(root, true)

    const config: { routes?: { src?: string; dest?: string; handle?: string }[] } = JSON.parse(
      await import('node:fs/promises').then((fs) =>
        fs.readFile(join(root, '.vercel/output/config.json'), 'utf-8'),
      ),
    )
    const last = config.routes?.at(-1)

    expect(last?.dest, 'the SSR fallback no longer points at the function').toBe('/api')
    expect(
      config.routes?.some((r) => r.handle === 'filesystem'),
      'the filesystem handler is gone, so the assets this test just proved were copied are unreachable',
    ).toBe(true)
  })
})
