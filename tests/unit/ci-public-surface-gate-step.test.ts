import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ci = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
const job = ci.slice(ci.indexOf('  typecheck-build:'))
const build = job.indexOf('- run: pnpm build:packages')
const gate = job.indexOf('Public-surface gate')
const typecheck = job.indexOf('- run: pnpm typecheck:only')

describe('CI public-surface gate step', () => {
  it('runs after the package build and before typecheck', () => {
    expect(build).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(build)
    expect(typecheck).toBeGreaterThan(gate)
  })

  const step = job.slice(gate, typecheck)

  it('fetches the PR base with history and passes it as --base', () => {
    expect(step).toContain('github.base_ref')
    expect(step).toMatch(/git fetch .*--unshallow/)
    expect(step).toContain('--base "origin/${BASE_REF}"')
  })

  it('runs the gate for both gated packages and propagates failure', () => {
    expect(step).toContain('set -euo pipefail')
    expect(step).toContain('@theokit/agents theokit')
    expect(step).toContain('node scripts/check-public-surface.mjs')
    expect(step).not.toMatch(/\|\|\s*(true|exit 0)\s*$/m)
    expect(step).not.toContain('continue-on-error')
  })
})
