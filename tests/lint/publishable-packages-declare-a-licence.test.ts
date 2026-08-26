import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * usetheokit/theokit#213 — three of our published packages carried no `license`
 * field. An npm package without one is, by default, **all rights reserved**: the
 * repository is Apache-2.0, and the person installing the tarball receives no
 * grant at all. The REPOSITORY-ROOT LICENSE does not travel in a tarball, so it
 * cannot supply what a manifest omits.
 *
 * A per-package LICENSE does travel — npm includes one from the package directory
 * automatically — and every publishable package here has one. That is the fact the
 * first version of this comment had backwards, and getting it backwards is why the
 * third assertion below did not exist: measured on the registry, `@theokit/http@1.1.0`
 * ships `package.json` saying MIT beside a bundled LICENSE reading "Apache License"
 * (usetheokit/theokit#422). One artifact, two grants, and a reader resolves it
 * differently depending on which one they open.
 *
 * Three things are asserted; the second and third are what this repository needs
 * beyond the original report.
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
 * **Self-consistent in the tarball.** The LICENSE the package SHIPS grants the same
 * licence its manifest declares. This is the one that catches the state above, and
 * neither of the other two can: both read the manifest, and the contradiction lives
 * between the manifest and the file travelling beside it.
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

/**
 * The SPDX id of the LICENSE a package SHIPS, or `null` when it ships none.
 *
 * Read from the text rather than from a filename, because the filename says nothing: the two
 * mis-licensed versions on the registry both shipped a file called `LICENSE`, and it was the first
 * lines of it that disagreed with the manifest beside it.
 */
function shippedLicence(dir: string): string | null {
  const packageDir = resolve(REPO, 'packages', dir)
  const name = readdirSync(packageDir).find((f) => f.toUpperCase().startsWith('LICENSE'))
  if (name === undefined) return null
  const head = readFileSync(resolve(packageDir, name), 'utf-8').slice(0, 400)
  if (head.includes('Apache License')) return 'Apache-2.0'
  if (head.includes('MIT License')) return 'MIT'
  // Unrecognised is not "fine": it means this gate cannot judge the file, and saying so beats
  // returning something that compares equal by accident.
  return `unrecognised (${head.split('\n')[0].trim().slice(0, 40)})`
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

  it.each(packages.map((p) => [p.dir, p.manifest] as const))(
    'packages/%s ships a LICENSE that agrees with its own manifest',
    (dir, manifest) => {
      const shipped = shippedLicence(dir)
      expect(
        shipped,
        `packages/${dir} ships no LICENSE, so the tarball carries a manifest grant with no text — ` +
          `npm includes a LICENSE from the package directory, and the repository root's does not travel`,
      ).not.toBeNull()
      expect(
        shipped,
        `packages/${dir} ships a ${String(shipped)} LICENSE beside a manifest declaring ` +
          `${String(manifest.license)} — one tarball cannot carry two grants (#422)`,
      ).toBe(manifest.license)
    },
  )
})
