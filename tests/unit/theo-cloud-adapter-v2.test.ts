/**
 * Plan A v2.2 — theo-cloud adapter (Wave 3 thin) invariant tests.
 *
 * Validates that the OSS adapter NEVER emits K8s shape:
 *  - NO `.theokit/theo-cloud/` dir creation
 *  - NO YAML file writes
 *  - Log emits the architectural mental model ("TheoCloud emits K8s manifests internally")
 *
 * EC-PA-V2-6: tests use REAL prepareTheoCloudArtifacts (NOT mocked) — module
 * boundary confidence over module-level mock convenience.
 * EC-PA-V2-7 DOC note: temp dirs left for OS GC. Add explicit rmSync afterEach
 * if CI runners flag accumulation.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { theoCloudAdapter } from '../../packages/theo/src/adapters/theo-cloud.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), 'theo-cloud-adapter-v2-'))
}

const cfg = { port: 3000, ssr: false } as unknown as TheoConfig

describe('Plan A v2.2 — theo-cloud adapter (thin Wave 3 v2.0)', () => {
  it('validates manifest via readManifest (handles null gracefully — no throw)', async () => {
    const cwd = tempCwd()
    // No .theokit/services.json present → readManifest returns null;
    // prepareTheoCloudArtifacts returns empty services. Adapter must not throw.
    await expect(theoCloudAdapter.build(cfg, cwd)).resolves.toBeUndefined()
  })

  it('null manifest logs "TS-only app" summary + architectural mental model', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const cwd = tempCwd()
    await theoCloudAdapter.build(cfg, cwd)
    const calls = consoleSpy.mock.calls.map((c) => String(c[0]))
    // EC-PA-V2-4: exact substring assertion per D1 spec
    expect(calls.some((l) => l.includes('TS-only app (no services)'))).toBe(true)
    // Architectural mental model invariant
    expect(calls.some((l) => l.includes('TheoCloud emits K8s manifests internally'))).toBe(true)
    // Wave 3 v2.0 version tag invariant
    expect(calls.some((l) => l.includes('Wave 3 v2.0'))).toBe(true)
    consoleSpy.mockRestore()
  })

  it('does NOT create .theokit/theo-cloud/ dir (invariant — K8s emission lives in TheoCloud)', async () => {
    const cwd = tempCwd()
    await theoCloudAdapter.build(cfg, cwd)
    expect(existsSync(join(cwd, '.theokit', 'theo-cloud'))).toBe(false)
  })

  it('does NOT write any YAML files (invariant — OSS adapter is upload-only)', async () => {
    const cwd = tempCwd()
    await theoCloudAdapter.build(cfg, cwd)
    // No K8s manifests at cwd root
    expect(existsSync(join(cwd, 'deployment.yaml'))).toBe(false)
    expect(existsSync(join(cwd, 'service.yaml'))).toBe(false)
    expect(existsSync(join(cwd, 'ingress.yaml'))).toBe(false)
    // No per-service manifests under .theokit/theo-cloud/
    expect(existsSync(join(cwd, '.theokit', 'theo-cloud', 'deployment-web.yaml'))).toBe(false)
    expect(existsSync(join(cwd, '.theokit', 'theo-cloud', 'service-web.yaml'))).toBe(false)
  })
})
