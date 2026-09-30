/**
 * Four defects, each measured against the real Deno Deploy platform on 2026-09-30 with a
 * control, and none of them reachable by a build that only checks its own output.
 *
 * 1. A dot-directory is never uploaded. Deploying `./.theokit/deno/probe.ts` failed the
 *    revision while the identical file at `./visible/probe.ts` served HTTP 200 — so the
 *    entry the adapter wrote lived where the platform could not see it.
 * 2. No import map was emitted. The entry imports `npm:theokit/...`, the project's own
 *    modules import the bare `theokit/server/define`, and a prefix mapping cannot bridge
 *    them: Deno refuses `"theokit/": "npm:theokit/"` because the portion after the prefix
 *    is not URL-joinable onto an `npm:` URL. Only an exact per-specifier entry resolves.
 * 3. `unstable: ["sloppy-imports"]` was absent. The scaffold's own agent modules carry six
 *    relative imports written with a `.js` extension against files on disk ending `.ts`.
 * 4. The config is discovered at the upload root and nowhere else. Moving it into a
 *    subdirectory failed the revision.
 */
import { describe, expect, it } from 'vitest'

import {
  bareSpecifiersOf,
  DENO_DEPLOY_ENTRY_PATH,
  renderDenoConfig,
} from '../../packages/theo/src/adapters/deno-deploy.js'

describe('the path the entry is written to', () => {
  it('is not inside a dot directory', () => {
    const segments = DENO_DEPLOY_ENTRY_PATH.split('/')
    expect(segments.every((s) => !s.startsWith('.'))).toBe(true)
  })

  it('keeps the entry one directory deep, so the upload root stays the project root', () => {
    expect(DENO_DEPLOY_ENTRY_PATH.split('/')).toHaveLength(2)
  })
})

describe('bareSpecifiersOf', () => {
  it('collects a bare package name', () => {
    expect(bareSpecifiersOf(["import { z } from 'zod'"])).toEqual(['zod'])
  })

  it('collects a subpath as the whole specifier, because a prefix mapping cannot resolve it', () => {
    expect(bareSpecifiersOf(["import { defineRoute } from 'theokit/server/define'"])).toEqual([
      'theokit/server/define',
    ])
  })

  it('ignores a relative import', () => {
    expect(bareSpecifiersOf(["import { x } from './prompts/instructions.js'"])).toEqual([])
  })

  it('ignores a specifier that already names its registry', () => {
    expect(bareSpecifiersOf(["import { s } from 'npm:theokit/server/scan'"])).toEqual([])
    expect(bareSpecifiersOf(["import { j } from 'jsr:@std/fs'"])).toEqual([])
    expect(bareSpecifiersOf(["import { p } from 'node:path'"])).toEqual([])
  })

  it('reads a scoped name whole', () => {
    expect(bareSpecifiersOf(["import { AgentBuilder } from '@theokit/agents'"])).toEqual([
      '@theokit/agents',
    ])
  })

  it('deduplicates across sources and sorts, so the emitted map is stable', () => {
    const found = bareSpecifiersOf([
      "import { z } from 'zod'\nimport { a } from '@theokit/agents'",
      "import { z2 } from 'zod'",
    ])
    expect(found).toEqual(['@theokit/agents', 'zod'])
  })

  it('reads a side-effect import, which carries no binding', () => {
    expect(bareSpecifiersOf(["import 'theokit/client'"])).toEqual(['theokit/client'])
  })
})

describe('renderDenoConfig', () => {
  it('maps each specifier exactly onto npm:, never as a prefix', () => {
    const cfg = renderDenoConfig({ specifiers: ['theokit/server/define', 'zod'] })
    expect(cfg.imports).toEqual({
      'theokit/server/define': 'npm:theokit/server/define',
      zod: 'npm:zod',
    })
    expect(Object.keys(cfg.imports ?? {}).some((k) => k.endsWith('/'))).toBe(false)
  })

  it('declares sloppy-imports, which the scaffold needs for its own .js specifiers', () => {
    expect(renderDenoConfig({ specifiers: [] }).unstable).toContain('sloppy-imports')
  })

  it('preserves what a project already wrote in its config', () => {
    const cfg = renderDenoConfig({
      specifiers: ['zod'],
      existing: { tasks: { dev: 'deno run -A main.ts' }, unstable: ['kv'] },
    })
    expect(cfg.tasks).toEqual({ dev: 'deno run -A main.ts' })
    expect(cfg.unstable).toEqual(['kv', 'sloppy-imports'])
  })

  it('does not declare sloppy-imports twice when it is already there', () => {
    const cfg = renderDenoConfig({ specifiers: [], existing: { unstable: ['sloppy-imports'] } })
    expect(cfg.unstable).toEqual(['sloppy-imports'])
  })
})
