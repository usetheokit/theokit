import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildStatic } from '../../packages/theo/src/adapters/static.js'

/**
 * usetheokit/theokit#362 - `build --target static` emitted a meta refresh for
 * EVERY page of an SSR project, and `/index.html` refreshed to itself.
 *
 * The default renderer typed the SSR entry's `render` as returning
 * `string | { redirect }`. The generator has returned `{ html, hydrationData }`
 * for some time; the other two callers were updated and this one was not. So the
 * `typeof result === 'string'` branch was dead and control fell through to the
 * redirect fallback.
 *
 * It was invisible because every existing test injects `renderHtml`, replacing
 * the code that carries the bug. This one writes a real `entry-server.js` to disk
 * and lets the adapter load it - the only way to exercise the default at all.
 */

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theo-static-ssr-'))
  mkdirSync(join(cwd, '.theokit/client'), { recursive: true })
  mkdirSync(join(cwd, '.theokit/server'), { recursive: true })
  mkdirSync(join(cwd, 'app'), { recursive: true })
  writeFileSync(join(cwd, 'app/page.tsx'), 'export default function Page() { return null }')
  writeFileSync(
    join(cwd, '.theokit/client/index.html'),
    '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>',
  )
  // The shape the generator actually returns.
  writeFileSync(
    join(cwd, '.theokit/server/entry-server.js'),
    'export async function render() {\n' +
      "  return { html: '<main>rendered by ssr</main>', hydrationData: { loaderData: { a: 1 } } }\n" +
      '}\n',
  )
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe('static export renders the SSR result (#362)', () => {
  it('test_a_page_is_not_a_meta_refresh', async () => {
    // `renderHtml` is deliberately NOT injected: it is the code under test, and
    // injecting it is precisely what made this defect invisible for so long.
    await buildStatic(
      { appDir: 'app' } as never,
      cwd,
      {
        detectApiRoutes: () => [],
        runNodeBuild: async () => {},
      } as never,
      undefined as never,
    )

    const out = readFileSync(join(cwd, '.theokit/static/index.html'), 'utf-8')

    // The failure mode: every page became this, and index refreshed to itself.
    expect(out).not.toContain('http-equiv="refresh"')
    expect(out).toContain('rendered by ssr')
  })

  it('test_the_hydration_data_reaches_the_document', async () => {
    // `renderHtml` is deliberately NOT injected: it is the code under test, and
    // injecting it is precisely what made this defect invisible for so long.
    await buildStatic(
      { appDir: 'app' } as never,
      cwd,
      {
        detectApiRoutes: () => [],
        runNodeBuild: async () => {},
      } as never,
      undefined as never,
    )

    const out = readFileSync(join(cwd, '.theokit/static/index.html'), 'utf-8')

    // Without it the client router re-fetches everything the export already has.
    expect(out).toContain('__staticRouterHydrationData')
  })
})
