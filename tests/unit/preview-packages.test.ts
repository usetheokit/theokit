import { describe, expect, it } from 'vitest'

// @ts-expect-error — a plain `.mjs` script with JSDoc types, imported for its one pure function.
import { selectPreviewPackages } from '../../scripts/preview-packages.mjs'

/**
 * Which packages a preview publishes (usetheokit/theokit#632).
 *
 * pkg.pr.new rewrites internal dependencies to preview URLs across everything in ONE invocation, so
 * publishing all seven packages made every preview declare its siblings as URLs — and a default
 * pnpm 11 refuses an exotic SUBdependency outright, which is the consumer the preview exists for.
 * Scoping the invocation to what a commit touched is what keeps a sibling on its registry range.
 *
 * The rule is a pure function of (publishable packages, changed files), and these are its cases. The
 * git and filesystem readers around it are the script's boundary, exercised where the workflow runs
 * it — a temporary git repository per case here would buy a slower test of the same four lines.
 */
const ALL = ['./packages/alpha', './packages/beta', './packages/gamma'] as const

describe('a commit that touches packages (#632)', () => {
  it('publishes only the touched one, so its siblings stay on registry ranges', () => {
    const { packages, reason } = selectPreviewPackages(ALL, [
      'packages/alpha/src/index.ts',
      'README.md',
    ])

    expect(packages).toEqual(['./packages/alpha'])
    expect(reason).toBe('touched')
  })

  it('publishes both when a change spans two, because that cross-URL is the point', () => {
    const { packages } = selectPreviewPackages(ALL, [
      'packages/alpha/src/index.ts',
      'packages/beta/src/index.ts',
    ])

    // `gamma` stays out: a preview of alpha must not declare an untouched sibling as a URL.
    expect(packages).toEqual(['./packages/alpha', './packages/beta'])
  })

  it('does not match a package whose name is a prefix of another', () => {
    // `packages/alpha-extra/x.ts` must not select `./packages/alpha`. The separator is what makes
    // the boundary, and dropping it is the classic way a prefix match goes wrong.
    const { packages, reason } = selectPreviewPackages(ALL, ['packages/alpha-extra/src/index.ts'])

    expect(packages).toEqual([...ALL])
    expect(reason).toBe('no-package-touched')
  })
})

describe('failing wide rather than narrow (#632)', () => {
  it('publishes everything when the commit touched no package', () => {
    const { packages, reason } = selectPreviewPackages(ALL, ['README.md', 'docs/guide.md'])

    expect(packages).toEqual([...ALL])
    expect(reason).toBe('no-package-touched')
  })

  it('publishes everything when the diff could not be read', () => {
    // `null` is the shallow-checkout case, and it is deliberately NOT spelled as an empty list: a
    // preview that silently stops covering a package looks exactly like a broken one.
    const { packages, reason } = selectPreviewPackages(ALL, null)

    expect(packages).toEqual([...ALL])
    expect(reason).toBe('no-diff')
  })

  it('tells the two fallbacks apart, so the log says which happened', () => {
    expect(selectPreviewPackages(ALL, []).reason).toBe('no-package-touched')
    expect(selectPreviewPackages(ALL, null).reason).toBe('no-diff')
  })
})
