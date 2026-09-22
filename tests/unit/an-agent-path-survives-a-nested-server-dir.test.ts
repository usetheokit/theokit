import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  generateManifest,
  loadManifest,
  writeManifest,
} from '../../packages/theo/src/server/scan/manifest.js'

/**
 * usetheokit/theokit#871 — every agent route of a freshly scaffolded, production-built app
 * answered 500.
 *
 * Measured 2026-09-22 against the PUBLISHED theokit@0.70.0, from nothing:
 *
 *     npm create theokit@latest clean-app -- --yes
 *     npx theokit build          # exit 0
 *     PORT=3998 npx theokit start
 *     GET /api/agents/chat/approvals
 *       -> 500 Cannot find module '<root>/src/src/server/agents/chat.ts'
 *
 * `src` is DOUBLED. The asymmetry that produces it is visible in one file: `generateManifest` is
 * TOLD the project root and writes `relative(projectRoot, …)`; `loadManifest` was not told, and
 * GUESSED it as `dirname(serverDir)`. The guess is right for `<root>/server` and wrong by exactly
 * one level for `<root>/src/server` — which is what the default scaffold's `theo.config.ts`
 * declares, so the wrong case is the DEFAULT case.
 *
 * The round trip is what this test asserts, because that is the invariant: whatever the writer
 * encodes, the reader must decode back to the same absolute path. A test that only checked the
 * reader would let the two drift apart again.
 */
describe('an agent path survives a nested serverDir (#871)', () => {
  /** The layout `create-theokit` scaffolds: serverDir is `src/server`, NOT `server`. */
  function scaffoldNested(): { root: string; serverDir: string; agentFile: string } {
    const root = mkdtempSync(join(tmpdir(), 'theo-nested-server-'))
    const agentsDir = join(root, 'src', 'server', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    const agentFile = join(agentsDir, 'chat.ts')
    writeFileSync(agentFile, "export const policy = 'public'\nexport default {}\n")
    return { root, serverDir: join(root, 'src', 'server'), agentFile }
  }

  it('test_a_nested_server_dir_round_trips_to_the_file_on_disk', () => {
    const { root, serverDir, agentFile } = scaffoldNested()

    const manifest = generateManifest(serverDir, root, 'src/server/agents')
    expect(manifest.agents, 'the scan found no agent — the fixture, not the defect').toHaveLength(1)

    const dist = join(root, '.theokit')
    mkdirSync(dist, { recursive: true })
    writeManifest(manifest, dist)

    const loaded = loadManifest(dist, serverDir, root)

    expect(
      loaded.agents[0]?.filePath,
      'the reader did not decode back to the file the writer encoded',
    ).toBe(agentFile)
    expect(loaded.agents[0]?.filePath, 'the path is doubled — this is #871 exactly').not.toContain(
      join('src', 'src'),
    )
  })

  it('test_the_flat_layout_still_works', () => {
    // Must SURVIVE. `<root>/server` is the layout the guess was right for, and a fix that only
    // repaired the nested case while breaking this one would trade one default for another.
    const root = mkdtempSync(join(tmpdir(), 'theo-flat-server-'))
    const agentsDir = join(root, 'agents')
    mkdirSync(agentsDir, { recursive: true })
    mkdirSync(join(root, 'server'), { recursive: true })
    const agentFile = join(agentsDir, 'chat.ts')
    writeFileSync(agentFile, "export const policy = 'public'\nexport default {}\n")

    const serverDir = join(root, 'server')
    const manifest = generateManifest(serverDir, root, 'agents')
    const dist = join(root, '.theokit')
    mkdirSync(dist, { recursive: true })
    writeManifest(manifest, dist)

    expect(loadManifest(dist, serverDir, root).agents[0]?.filePath).toBe(agentFile)
  })
})
