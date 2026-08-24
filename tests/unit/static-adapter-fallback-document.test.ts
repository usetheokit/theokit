import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildStatic } from '../../packages/theo/src/adapters/static.js'

/**
 * B-033 — the fallback document the static adapter builds when the application
 * has no `index.html` was `<!doctype html><html><body><div id="root"></div></body></html>`:
 * no `<head>`, no `lang`, no charset, no viewport.
 *
 * The branch is reached when `.theokit/client/index.html` is absent, which is
 * the branch that runs after something else already went wrong — so it is the
 * one that should be least surprising, not the one held to a lower floor.
 *
 * This test writes NO `index.html` on purpose. Every other static test writes
 * one, which is why the fallback's shape went unasserted: the code exists and
 * nothing had ever read its output.
 */

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theo-static-fallback-'))
  mkdirSync(join(cwd, '.theokit/client'), { recursive: true })
  mkdirSync(join(cwd, '.theokit/server'), { recursive: true })
  mkdirSync(join(cwd, 'app'), { recursive: true })
  writeFileSync(join(cwd, 'app/page.tsx'), 'export default function Page() { return null }')
  // Deliberately no `.theokit/client/index.html` — that absence IS the branch.
  writeFileSync(
    join(cwd, '.theokit/server/entry-server.js'),
    'export async function render() {\n' +
      "  return { html: '<main>rendered</main>', hydrationData: { loaderData: {} } }\n" +
      '}\n',
  )
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

async function buildAndRead(): Promise<string> {
  await buildStatic(
    { appDir: 'app' } as never,
    cwd,
    { detectApiRoutes: () => [], runNodeBuild: async () => {} } as never,
    undefined as never,
  )
  return readFileSync(join(cwd, '.theokit/static/index.html'), 'utf-8')
}

describe('the static fallback document meets the floor the framework asks of applications (B-033)', () => {
  it('test_fallback_document_declares_a_language', async () => {
    // WCAG 3.1.1: a screen reader picks its voice from this attribute. An
    // `<html>` with no `lang` leaves that choice to the user agent's guess.
    expect(await buildAndRead()).toMatch(/<html[^>]*\slang="[a-z]{2}[a-zA-Z0-9-]*"/)
  })

  it('test_fallback_document_declares_a_charset', async () => {
    // Without it the bytes are decoded by sniffing, which differs per browser.
    expect(await buildAndRead()).toMatch(/<meta\s+charset="utf-8"\s*\/?>/i)
  })

  it('test_fallback_document_declares_a_viewport', async () => {
    // Its absence is what makes a page render at desktop width on a phone.
    expect(await buildAndRead()).toContain('name="viewport"')
  })

  it('test_fallback_document_has_a_head_element', async () => {
    // The three tags above have nowhere legal to live without it, and a parser
    // that has to synthesise one puts the boundary where the author did not.
    expect(await buildAndRead()).toMatch(/<head>[\s\S]*<\/head>/)
  })
})
