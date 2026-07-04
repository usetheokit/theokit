/**
 * M2 (theokit-ai-first) — scanAgents: the top-level `agents/*.ts` file convention.
 *
 * Per the LOCKED naming decision (agent-surface-naming-system-design.md) agents live in a
 * TOP-LEVEL `agents/` directory (sibling of `server/`), NOT `server/agents/`. `scanAgents`
 * mirrors `scanWebSocketRoutes` (one-file-one-endpoint) but roots at `<projectRoot>/agents`
 * and derives `/api/agents/<name>` route paths. Test files are skipped (convention § 5).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanAgents } from '../../packages/theo/src/server/scan/agent-scan.js'

const TMP_DIR = join(__dirname, '..', '__tmp_agent_scan_test__')

function setupFixture(structure: Record<string, string>): void {
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = join(TMP_DIR, filePath)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, content)
  }
}

describe('scanAgents (M2)', () => {
  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
  })
  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('test_scanAgents_maps_file_to_route_and_name', () => {
    setupFixture({
      'agents/support.ts': 'export default {}',
      'agents/echo.ts': 'export default {}',
    })
    const agents = scanAgents(TMP_DIR)
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]))
    expect(agents).toHaveLength(2)
    expect(byName.support.agentPath).toBe('/api/agents/support')
    expect(byName.echo.agentPath).toBe('/api/agents/echo')
    expect(byName.support.filePath).toContain('agents/support.ts')
  })

  it('test_scanAgents_skips_test_files', () => {
    setupFixture({
      'agents/echo.ts': 'export default {}',
      'agents/echo.test.ts': 'export default {}',
      'agents/echo.spec.ts': 'export default {}',
    })
    const agents = scanAgents(TMP_DIR)
    expect(agents.map((a) => a.name)).toEqual(['echo'])
  })

  it('test_scanAgents_returns_empty_when_no_agents_dir', () => {
    // TMP_DIR exists but has no agents/ subdir.
    expect(scanAgents(TMP_DIR)).toEqual([])
  })
})
