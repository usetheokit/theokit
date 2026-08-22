import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * usetheokit/theokit#213 — three of our published packages carried no `license`
 * field. An npm package without one is, by default, **all rights reserved**: the
 * repository is Apache-2.0, and the person installing the tarball receives no
 * grant at all. The repository's LICENSE file does not travel in the tarball, so
 * it cannot supply what the manifest omits.
 *
 * Two things are asserted, and the second is the one the original report did not
 * need but this repository does.
 *
 * **Present.** A publishable package declares `license`.
 *
 * **Consistent with the repository.** The declared licence matches the LICENSE at
 * the root. A manifest saying MIT inside an Apache-2.0 repository is worse than
 * an absent field: absence reads as "ask us", a wrong value is a grant somebody
 * may rely on, and it is not revocable once published. That is not theoretical
 * here — `@theokit/http@1.1.0` and `@theokit/presenter@0.7.0` are on npm under
 * MIT while these manifests, at the same version numbers, say Apache-2.0.
 *
 * Private packages are exempt: nothing is published, so nobody receives a grant.
 */

const REPO = resolve(import.meta.dirname, '../..')

/** The SPDX id the repository's own LICENSE grants. */
function repositoryLicence(): string {
  const text = readFileSync(resolve(REPO, 'LICENSE'), 'utf-8')
  if (text.includes('Apache License') && text.includes('Version 2.0')) return 'Apache-2.0'
  if (text.includes('MIT License')) return 'MIT'
  throw new Error(
    'LICENSE at the repository root is neither Apache-2.0 nor MIT — teach this test the new one',
  )
}

interface Manifest {
  name?: string
  license?: string
  private?: boolean
}

function publishablePackages(): Array<{ dir: string; manifest: Manifest }> {
  return readdirSync(resolve(REPO, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      dir: e.name,
      manifest: JSON.parse(
        readFileSync(resolve(REPO, 'packages', e.name, 'package.json'), 'utf-8'),
      ) as Manifest,
    }))
    .filter(({ manifest }) => manifest.private !== true)
}

describe('every publishable package grants a licence to whoever installs it (#213)', () => {
  const expected = repositoryLicence()
  const packages = publishablePackages()

  it('test_there_is_something_to_check', () => {
    // A glob that matches nothing passes every assertion below it.
    expect(packages.length).toBeGreaterThan(0)
  })

  it.each(packages.map((p) => [p.dir, p.manifest] as const))(
    'packages/%s declares a licence',
    (dir, manifest) => {
      expect(
        manifest.license,
        `packages/${dir} publishes as ${manifest.name ?? '(unnamed)'} with no \`license\` field — ` +
          `npm treats that as all rights reserved, and the repository's LICENSE does not travel in the tarball`,
      ).toBeDefined()
    },
  )

  it.each(packages.map((p) => [p.dir, p.manifest] as const))(
    'packages/%s declares the licence this repository grants',
    (dir, manifest) => {
      expect(
        manifest.license,
        `packages/${dir} declares ${String(manifest.license)} inside a ${expected} repository — ` +
          `a published grant cannot be taken back, so the two must not disagree`,
      ).toBe(expected)
    },
  )
})
