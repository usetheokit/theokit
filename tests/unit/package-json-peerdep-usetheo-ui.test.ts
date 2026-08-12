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

/** O template canônico do `create-theokit` — a fonte contra a qual a coerência é medida. */
const TEMPLATE_TMPL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'create-theokit',
  'templates',
  'default',
  'package.json.tmpl',
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

  it('should declare a caret OR-range for @theokit/ui that covers the line the template pins', () => {
    // Given ADR 0018 (the gate is caret pins, explicitly OR-joined per VALIDATED line — never an
    // open range),
    // When we declare the range,
    // Then every OR clause must be a caret pin, and the range must cover the line the default
    // `create-theokit` template pins — otherwise a fresh `npx create-theokit` fails `npm install`
    // with ERESOLVE (npm is strict on optional-peer conflicts; pnpm is lenient).
    //
    // The clause asserted here used to be the literal `^1.0.0`. That rotted the day `f09fbbac`
    // narrowed the peer to `^1.1.0` and dropped the discontinued 0.x lines on purpose, leaving this
    // guard permanently red. The membership check lives in `ui-peer-range.test.ts`, which owns the
    // caret semantics; here we only assert the SHAPE plus the same-major coherence.
    const range = pkg.peerDependencies?.['@theokit/ui'] ?? ''
    const parts = range.split('||').map((p) => p.trim())
    expect(parts.length).toBeGreaterThan(0)
    for (const part of parts) {
      expect(part, `each OR clause must be a caret pin: ${part}`).toMatch(
        // eslint-disable-next-line security/detect-unsafe-regex -- single optional group, no nested quantifiers, false positive
        /^\^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/,
      )
    }

    const templatePin = /"@theokit\/ui":\s*"([^"]+)"/.exec(
      readFileSync(TEMPLATE_TMPL_PATH, 'utf-8'),
    )?.[1]
    expect(templatePin, 'the default template must declare @theokit/ui').toBeTruthy()
    const templateMajor = /^\^?(\d+)\./.exec(templatePin!)?.[1]
    expect(
      parts.map((p) => /^\^(\d+)\./.exec(p)?.[1]),
      `no OR clause covers the major the template pins (${templatePin})`,
    ).toContain(templateMajor)
  })

  it('should mark @theokit/ui as optional in peerDependenciesMeta', () => {
    // Given that @theokit/ui is opt-in (templates api-only/postgres skip it),
    // When the consumer omits the dep,
    // Then no install-time error should fire — only mismatch warns.
    expect(pkg.peerDependenciesMeta?.['@theokit/ui']?.optional).toBe(true)
  })
})
