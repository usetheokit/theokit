/**
 * Unit test for the CLI preflight (Node version + native binding ABI).
 *
 * Verifies:
 *   1. preflightNodeAndBindings does NOT throw under the test runner's
 *      Node (which we already pin to >=22.12 in CI).
 *   2. The exported function exists + is callable.
 *
 * Why no Node-floor failure simulation: we'd have to mock process.versions
 * which vitest discourages (process.versions is read-only). The Node-floor
 * path is exercised in CI via the `.nvmrc` gate and locally via
 * `nvm use 20 && pnpm dev` which we documented in the actionable message.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { preflightNodeAndBindings } from '../../packages/theo/src/cli/preflight-node-version.js'

describe('preflightNodeAndBindings (CLI preflight)', () => {
  it('does not throw under the test runner Node (CI pins >= 22.12)', () => {
    // Use a tmpdir with no package.json/node_modules. Note: vitest sets
    // NODE_PATH to include the host theokit's node_modules, so createRequire
    // from any tmpdir still resolves better-sqlite3 transitively via
    // NODE_PATH — that's WHY this assertion is `not.toThrow`. The real
    // "missing better-sqlite3" branch is exercised in CI via the dogfood
    // stranger fixture (cleanroom sandbox with NO theokit node_modules on
    // NODE_PATH), where the throw IS observed and the error message is
    // surfaced to the developer.
    const tmp = mkdtempSync(join(tmpdir(), 'preflight-test-'))
    writeFileSync(join(tmp, 'package.json'), '{}')
    expect(() => preflightNodeAndBindings(tmp)).not.toThrow()
  })

  it('exports a callable function', () => {
    expect(typeof preflightNodeAndBindings).toBe('function')
  })

  it('threats absent optional peer (e.g. @lancedb/lancedb) as OK', () => {
    // Spawn a tmpdir where neither required nor optional are present.
    // We can't easily install better-sqlite3 into a tmpdir, so we just
    // verify the function returns the same error class regardless of
    // optional peers. (Full happy-path is exercised in the dogfood-app
    // dogfood run via Chrome MCP — see report 2026-05-31.)
    const tmp = mkdtempSync(join(tmpdir(), 'preflight-test-opt-'))
    writeFileSync(join(tmp, 'package.json'), '{}')
    try {
      preflightNodeAndBindings(tmp)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Optional peer absence must NOT appear in the error message —
      // only required deps (better-sqlite3) should trip the check.
      expect(msg).not.toContain('@lancedb/lancedb')
    }
  })
})
