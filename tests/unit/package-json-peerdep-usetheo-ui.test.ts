/**
 * T1.1 — Assert that theokit/packages/theo/package.json declares
 * @theokit/ui as an optional peerDependency.
 *
 * This pins ADR 0018 (theokit/docs/adr/0018-usetheo-ui-vite-plugin-contract-versionado.md):
 * the contract between theokit and @theokit/ui is VERSIONED and declared,
 * not implicit. The range here is the install-time gate; the runtime gate
 * is the contract test at tests/integration/contract-usetheo-ui-vite-plugin.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const PKG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'theo',
  'package.json',
)

interface TheokitPackageJson {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

describe('theokit/packages/theo/package.json — @theokit/ui peerDep contract (ADR 0018)', () => {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as TheokitPackageJson

  it('should declare @theokit/ui in peerDependencies', () => {
    // Given the contract VERSIONADO decision in ADR 0018,
    // When we read the package.json,
    // Then @theokit/ui must appear as a declared peer.
    expect(pkg.peerDependencies).toBeDefined()
    expect(pkg.peerDependencies?.['@theokit/ui']).toBeDefined()
  })

  it('should declare a caret OR-range for @theokit/ui that includes the current 1.x line', () => {
    // Given that @theokit/ui shipped its first stable major (1.0.0) in the
    // AI-exclusive pivot (2026-07-03), and the default `create-theokit` template
    // pins `@theokit/ui@^1.0.0`,
    // When we declare the range,
    // Then it MUST be a `||`-joined series of caret pins (each `^X.Y.Z`, optional
    // pre-release suffix) that INCLUDES the published 1.x line — otherwise a fresh
    // `npx create-theokit` fails `npm install` with ERESOLVE (npm is strict on
    // optional-peer conflicts; pnpm is lenient). The historical 0.x lines stay in
    // the OR for existing consumers (ADR 0018: the gate is caret pins, explicitly
    // OR-joined per validated line — never an open range).
    const range = pkg.peerDependencies?.['@theokit/ui'] ?? ''
    const parts = range.split('||').map((p) => p.trim())
    expect(parts.length).toBeGreaterThan(0)
    for (const part of parts) {
      expect(part, `each OR clause must be a caret pin: ${part}`).toMatch(
        // eslint-disable-next-line security/detect-unsafe-regex -- single optional group, no nested quantifiers, false positive
        /^\^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/,
      )
    }
    expect(parts, 'range must cover the published @theokit/ui 1.x line').toContain('^1.0.0')
  })

  it('should mark @theokit/ui as optional in peerDependenciesMeta', () => {
    // Given that @theokit/ui is opt-in (templates api-only/postgres skip it),
    // When the consumer omits the dep,
    // Then no install-time error should fire — only mismatch warns.
    expect(pkg.peerDependenciesMeta?.['@theokit/ui']?.optional).toBe(true)
  })
})
