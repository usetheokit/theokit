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

  it('should declare a caret 0.x range for @theokit/ui (pre-release or stable)', () => {
    // Given that UI is in 0.x (pre-1.0 — breaking changes allowed within 0.x),
    // When we declare the range,
    // Then it must use caret semantics with optional pre-release suffix.
    // Examples: ^0.12.0-next.0 (during -next ramp) OR ^0.13.0 (post-stable publish).
    // Both are valid under ADR 0018: the gate is caret + 0.x, not the suffix.
    const range = pkg.peerDependencies?.['@theokit/ui'] ?? ''
    // eslint-disable-next-line security/detect-unsafe-regex -- single optional group, no nested quantifiers, false positive
    expect(range).toMatch(/^\^0\.\d+\.\d+(-[a-z]+\.\d+)?$/)
  })

  it('should mark @theokit/ui as optional in peerDependenciesMeta', () => {
    // Given that @theokit/ui is opt-in (templates api-only/postgres skip it),
    // When the consumer omits the dep,
    // Then no install-time error should fire — only mismatch warns.
    expect(pkg.peerDependenciesMeta?.['@theokit/ui']?.optional).toBe(true)
  })
})
