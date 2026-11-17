import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ci = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8')
const job = ci.slice(ci.indexOf('  typecheck-build:'), ci.indexOf('\n  test:'))

describe('ci typecheck-build runs the public surface gate', () => {
  it('runs it after build:packages and before the artifact upload', () => {
    const build = job.indexOf('run: pnpm build:packages')
    const gate = job.indexOf('scripts/check-public-surface.mjs @theokit/agents')
    expect(build).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(build)
    expect(gate).toBeLessThan(job.indexOf('upload-artifact'))
  })

  it('checks out full history and compares with the PR base (main for other events)', () => {
    expect(job).toContain('fetch-depth: 0')
    expect(job).toContain("BASE_REF: ${{ github.base_ref || 'main' }}")
    expect(job).toContain('--base "origin/${BASE_REF}"')
  })

  it('does not swallow the gate exit status', () => {
    const line = job.split('\n').find((l) => l.includes('check-public-surface.mjs')) ?? ''
    expect(line).not.toMatch(/\|\||;\s*true|continue-on-error/)
    expect(job).not.toMatch(/Public surface gate[\s\S]{0,200}continue-on-error/)
  })
})
