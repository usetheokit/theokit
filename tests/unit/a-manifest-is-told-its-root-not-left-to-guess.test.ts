/**
 * `generateManifest` must be TOLD the project root and the agents dir, not default them.
 *
 * It declared `projectRoot: string = dirname(serverDir)` and `agentsDir = 'agents'`. The pair is correct
 * exactly when the layout is flat, and the layout `create-theokit` scaffolds is not: `serverDir` is
 * `<root>/src/server`, so the guess is `<root>/src` and it is wrong by one level. Three read-only callers
 * took the defaults and two passed both explicitly, so the correct shape was known and never reached them.
 *
 * ## The consequence this file asserts is NOT the one the item was filed with
 *
 * It was filed as "`useAgent('chat')` untyped and agents missing from the generated docs". Measured before
 * writing any code: neither follows. `generateClientDts` never reads `manifest.agents` — zero occurrences
 * of `.agents` in its body — and `openapi-emit`'s two modules have zero occurrences of `agents` between
 * them. All three callers consume `manifest.routes`.
 *
 * What the defaults actually produce is a WARNING for a project that configured nothing:
 *
 *     [theokit] agentsDir "agents" resolves to "<root>/src/agents", which is not a directory, so NO
 *     agents were found and every /api/agents/* route will 404.
 *
 * Two defects in one line. It names the wrong root, and it fires at all — `scanAgents` reports only when
 * its parameter is DEFINED, and its docblock says why in its own words: "Silent when NOTHING was
 * configured: a project with no agents is the ordinary case, and a gate that fires on ordinary work is a
 * gate somebody disables. The parameter is OPTIONAL rather than defaulted for exactly that reason — a
 * default erases the difference between 'nobody configured this' and 'somebody configured agents'."
 *
 * `generateManifest` defaulted it, and erased exactly that difference. So the fix is not only to pass the
 * root: `agentsDir` must pass THROUGH as `undefined` when the project declared nothing, or the layer that
 * decided to stay quiet cannot.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { generateManifest } from '../../packages/theo/src/server/scan/manifest.js'

const SRC_ROOT = new URL('../../packages/theo/src', import.meta.url).pathname

/**
 * The manifest module's CODE, comments stripped.
 *
 * Stripped because the docblock that explains the removed defaults necessarily quotes them — the first
 * version of the case below read the whole file and was failed by the note describing the fix.
 */
function readSource(): string {
  return readFileSync(join(SRC_ROOT, 'server', 'scan', 'manifest.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every `.ts` under `packages/theo/src`, so a call site added later is swept without editing a list. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(full)
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [full] : []
  })
}

/** Each place that CALLS `generateManifest`, with the call text, comments stripped. */
function callSites(): { file: string; text: string }[] {
  return sourceFiles(SRC_ROOT)
    .map((file) => ({
      file: file.slice(SRC_ROOT.length + 1),
      text: readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1'),
    }))
    .filter(
      ({ text }) =>
        text.includes('generateManifest(') && !text.includes('function generateManifest'),
    )
}

/** The layout `create-theokit` scaffolds: `serverDir` is `src/server`, not `server`. */
function nested(): { root: string; serverDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'theo-manifest-root-'))
  mkdirSync(join(root, 'src', 'server', 'routes'), { recursive: true })
  return { root, serverDir: join(root, 'src', 'server') }
}

function warningsFrom(run: () => void): string[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    run()
    return warn.mock.calls.map((c) => String(c[0]))
  } finally {
    warn.mockRestore()
  }
}

describe('a manifest is told its root rather than left to guess', () => {
  it('test_a_project_that_configured_nothing_is_not_warned', () => {
    // THE case, and the whole observable damage. An ordinary project with no agents got a warning
    // announcing that "every /api/agents/* route will 404" — about routes it does not have, naming a
    // directory it never configured.
    const { root, serverDir } = nested()

    const warnings = warningsFrom(() => {
      // OMITTED, which is the case: the project configured nothing.
      generateManifest(serverDir, root)
    })

    expect(
      warnings.filter((w) => w.includes('agentsDir')),
      'a project that declares no agents was told every /api/agents/* route will 404',
    ).toEqual([])
  })

  it('test_a_configured_dir_that_resolves_to_nothing_is_still_reported', () => {
    // COUNTERPROOF: silencing the ordinary case must not silence the one B-249 exists for. A value the
    // project DID configure and which resolves nowhere is the case worth a warning.
    const { root, serverDir } = nested()

    const warnings = warningsFrom(() => {
      generateManifest(serverDir, root, 'nowhere/at/all')
    })

    expect(warnings.some((w) => w.includes('nowhere/at/all'))).toBe(true)
  })

  it('test_a_nested_layout_finds_its_agents', () => {
    // The root half. With the guess, `<root>/src` + `agents` looks in `<root>/src/agents`; the scaffold
    // puts them at `<root>/src/server/agents`.
    const { root, serverDir } = nested()
    mkdirSync(join(serverDir, 'agents'), { recursive: true })
    writeFileSync(
      join(serverDir, 'agents', 'chat.ts'),
      "export const policy = 'public'\nexport default {}\n",
    )

    const manifest = generateManifest(serverDir, root, 'src/server/agents')

    expect(manifest.agents, 'the scan found no agent — the fixture, not the defect').toHaveLength(1)
  })

  it('test_the_root_is_required_rather_than_guessed', () => {
    // A declaration-level assertion, because the behaviour of a guess is only observable through the
    // caller that takes it — and the point is that no caller can take it any more. Asserted on the
    // signature, where a default would reappear.
    const source = readSource()

    expect(
      source,
      '`projectRoot` has a default again, so the guess is back for any caller that omits it',
    ).not.toMatch(/projectRoot:\s*string\s*=/)
    expect(source, '`agentsDir` has a default again').not.toMatch(/agentsDir\s*=\s*'/)
  })

  it('test_every_caller_passes_both', () => {
    // The other half of the same decision. Three callers took the defaults; if one starts omitting the
    // arguments again the signature will not stop it, because a missing optional is legal.
    const callers = callSites()

    expect(callers.length, 'no call site was found, so this asserts nothing').toBeGreaterThan(3)
    for (const { file, text } of callers) {
      expect(text, `${file} calls generateManifest with fewer than three arguments`).toMatch(
        /generateManifest\([^)]*,[^)]*,[^)]*\)/,
      )
    }
  })
})
