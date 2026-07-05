import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDir = resolve(__dirname, '../..')

describe('Changeset Configuration', () => {
  it('should have .changeset/config.json', () => {
    expect(existsSync(resolve(rootDir, '.changeset/config.json'))).toBe(true)
  })

  it('theokit + create-theokit are independently versioned (NOT changeset-linked)', () => {
    // theokit (framework) and create-theokit (scaffolder) diverged onto separate
    // version lines — theokit is 0.x, create-theokit reached 1.x on its own. The M6
    // release bumped theokit@0.15.2 without touching create-theokit@1.0.16, which
    // only works because they are NOT linked. `linked` must stay empty.
    const config = JSON.parse(readFileSync(resolve(rootDir, '.changeset/config.json'), 'utf-8'))
    expect(config.linked ?? []).toEqual([])
  })

  it('should have access set to public', () => {
    const config = JSON.parse(readFileSync(resolve(rootDir, '.changeset/config.json'), 'utf-8'))
    expect(config.access).toBe('public')
  })

  it('should have baseBranch set to main', () => {
    const config = JSON.parse(readFileSync(resolve(rootDir, '.changeset/config.json'), 'utf-8'))
    expect(config.baseBranch).toBe('main')
  })

  // 0.2.0 release (2026-05-28): exited alpha series. Gate now pins the
  // stable line — versions must be valid semver, no longer pre-release.
  it('theo version should be valid stable semver (post-alpha exit)', () => {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'packages/theo/package.json'), 'utf-8'))
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded semver assertion; no nested quantifiers
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/)
    expect(pkg.version).not.toMatch(/-alpha\./)
  })

  it('create-theo version should be valid stable semver (post-alpha exit)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(rootDir, 'packages/create-theokit/package.json'), 'utf-8'),
    )
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded semver assertion; no nested quantifiers
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/)
    expect(pkg.version).not.toMatch(/-alpha\./)
  })

  it('theokit + create-theokit versions may diverge (independent lines)', () => {
    // Regression guard against re-introducing a lockstep-version assumption: the two
    // packages are released independently, so their versions are NOT required to
    // match. (theokit 0.x framework vs create-theokit 1.x scaffolder.)
    const theo = JSON.parse(readFileSync(resolve(rootDir, 'packages/theo/package.json'), 'utf-8'))
    const create = JSON.parse(
      readFileSync(resolve(rootDir, 'packages/create-theokit/package.json'), 'utf-8'),
    )
    expect(theo.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(create.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('root package.json should have changeset scripts', () => {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts.changeset).toBeDefined()
    expect(pkg.scripts['version-packages']).toBeDefined()
    expect(pkg.scripts.release).toBeDefined()
  })
})

describe('CHANGELOG.md', () => {
  it('theo CHANGELOG.md should exist', () => {
    expect(existsSync(resolve(rootDir, 'packages/theo/CHANGELOG.md'))).toBe(true)
  })

  it('theo CHANGELOG.md should mention the current package.json version', () => {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'packages/theo/package.json'), 'utf-8'))
    const content = readFileSync(resolve(rootDir, 'packages/theo/CHANGELOG.md'), 'utf-8')
    expect(content).toContain(pkg.version)
  })

  it('create-theo CHANGELOG.md should exist', () => {
    expect(existsSync(resolve(rootDir, 'packages/create-theokit/CHANGELOG.md'))).toBe(true)
  })

  it('create-theo CHANGELOG.md should mention the current package.json version', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(rootDir, 'packages/create-theokit/package.json'), 'utf-8'),
    )
    const content = readFileSync(resolve(rootDir, 'packages/create-theokit/CHANGELOG.md'), 'utf-8')
    expect(content).toContain(pkg.version)
  })
})
