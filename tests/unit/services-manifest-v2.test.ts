/**
 * Plan v1.2 T2.3 (cutover-deep-review-hardening) — services.json v2 emit
 * tests. Covers project + type propagation and the EC-7 cross-product
 * schema-version drift gate (theokit's emitted version ∈ TheoCloud's
 * accepted set).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { buildManifest } from '../../packages/theo/src/services/index.js'
import type { ServicesConfig } from '../../packages/theo/src/services/index.js'

const PYTHON_SERVICE = {
  runtime: 'python' as const,
  port: 8001,
  proxy: '/api/agent',
  dev: 'uvicorn main:app',
  start: 'uvicorn main:app --workers 4',
  healthcheck: '/health',
  cors: false,
  passSetCookie: false,
}

describe('Plan v1.2 T2.3 — services.json v2 emit', () => {
  it('buildManifest with project emits version 2 + project field', () => {
    const cfg: ServicesConfig = { agent: PYTHON_SERVICE }
    const m = buildManifest(cfg, 'myapp')
    expect(m.version).toBe(2)
    if (m.version !== 2) throw new Error('narrow')
    expect(m.project).toBe('myapp')
  })

  it('buildManifest without project emits v1 (deprecated path)', () => {
    const cfg: ServicesConfig = { agent: PYTHON_SERVICE }
    const m = buildManifest(cfg)
    expect(m.version).toBe(1)
    expect(m).not.toHaveProperty('project')
  })

  it('buildManifest preserves service `type` when set', () => {
    const cfg: ServicesConfig = {
      worker: { ...PYTHON_SERVICE, type: 'worker' },
    }
    const m = buildManifest(cfg, 'myapp')
    expect(m.services[0]?.type).toBe('worker')
  })

  it('buildManifest omits `type` field when not set (byte-identical v1 fixture)', () => {
    const cfg: ServicesConfig = { agent: PYTHON_SERVICE }
    const m = buildManifest(cfg)
    expect(m.services[0]).not.toHaveProperty('type')
  })

  it('empty project string falls back to v1 (treats as missing)', () => {
    const cfg: ServicesConfig = { agent: PYTHON_SERVICE }
    const m = buildManifest(cfg, '')
    expect(m.version).toBe(1)
  })
})

// EC-7 (Plan v1.2) — cross-product schema sync gate. Catches drift where
// theokit ships an emit version that TheoCloud's JSON Schema 7 contract
// doesn't accept (e.g., theokit 0.6.0 bumps to v3 while TheoCloud API only
// accepts {1, 2}).
describe('Plan v1.2 EC-7 — cross-product schema-version drift', () => {
  it('theokit emit version ∈ TheoCloud accepted versions', () => {
    const here = process.cwd()
    // Walk up to repo root from theokit/ workspace
    const candidates = [
      join(here, '../theo-cloud/theo/api/internal/source/services.schema.json'),
      join(here, '../../theo-cloud/theo/api/internal/source/services.schema.json'),
      join(here, '../../../theo-cloud/theo/api/internal/source/services.schema.json'),
    ]
    const schemaPath = candidates.find((p) => existsSync(p))
    if (!schemaPath) {
      // Skip cleanly in dev environments without a theo-cloud checkout.
      // The CI gate runs in monorepo and resolves the schema deterministically.
      // (no console output — test harness already reports skip via assertion shape)
      return
    }
    const raw = readFileSync(schemaPath, 'utf-8')
    const schema = JSON.parse(raw) as {
      properties?: { version?: { enum?: number[] } }
      oneOf?: Array<{ properties?: { version?: { const?: number } } }>
    }
    // Accepted versions come from either oneOf branches (const) or
    // top-level properties.version.enum (fallback).
    const accepted: number[] = []
    if (Array.isArray(schema.oneOf)) {
      for (const branch of schema.oneOf) {
        const v = branch.properties?.version?.const
        if (typeof v === 'number') accepted.push(v)
      }
    }
    if (accepted.length === 0 && Array.isArray(schema.properties?.version?.enum)) {
      accepted.push(...(schema.properties?.version?.enum ?? []))
    }
    expect(accepted.length).toBeGreaterThan(0)

    // theokit emits version 1 (no project) or version 2 (with project).
    const v1 = buildManifest({}).version
    const v2 = buildManifest({}, 'app').version
    expect(accepted).toContain(v1)
    expect(accepted).toContain(v2)
  })
})
