import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * T7.3 — Community scaffolding linter.
 *
 * External contributors should not hit a blank wall when they want to
 * report a bug, propose a feature, or open a PR. This test ensures the
 * canonical OSS scaffolding files exist with the minimum required
 * shape — content is editorial, structure is enforced.
 *
 * EC-15: SECURITY.md must list GitHub Private Security Advisory FIRST
 * (works without MX records); a security@ email is secondary.
 */

const ROOT = resolve(__dirname, '../..')

function r(...parts: string[]): string {
  return resolve(ROOT, ...parts)
}

describe('T7.3 — file presence', () => {
  it('Given repo root, Then CONTRIBUTING.md exists', () => {
    expect(existsSync(r('CONTRIBUTING.md'))).toBe(true)
  })

  it('Given .github/ISSUE_TEMPLATE/, Then bug_report.yml exists', () => {
    expect(existsSync(r('.github/ISSUE_TEMPLATE/bug_report.yml'))).toBe(true)
  })

  it('Given .github/ISSUE_TEMPLATE/, Then feature_request.yml exists', () => {
    expect(existsSync(r('.github/ISSUE_TEMPLATE/feature_request.yml'))).toBe(true)
  })

  it('Given .github/ISSUE_TEMPLATE/, Then config.yml exists (disables blank issues)', () => {
    expect(existsSync(r('.github/ISSUE_TEMPLATE/config.yml'))).toBe(true)
  })

  it('Given .github/, Then PULL_REQUEST_TEMPLATE.md exists', () => {
    expect(existsSync(r('.github/PULL_REQUEST_TEMPLATE.md'))).toBe(true)
  })

  it('Given repo root, Then SECURITY.md exists', () => {
    expect(existsSync(r('SECURITY.md'))).toBe(true)
  })

  it('Given repo root, Then CODE_OF_CONDUCT.md exists', () => {
    expect(existsSync(r('CODE_OF_CONDUCT.md'))).toBe(true)
  })
})

describe('T7.3 — CONTRIBUTING references', () => {
  const md = (): string => readFileSync(r('CONTRIBUTING.md'), 'utf-8')

  it('Given CONTRIBUTING.md, Then every command in the gate exists as an npm script', () => {
    // The gate section used to name a shell script that no longer ships. Pinning the COMMANDS to
    // the manifest means the doc cannot drift into telling a contributor to run something that is
    // not there.
    // pnpm's own verbs are not npm scripts; only the repo-defined ones are being checked here.
    const PNPM_BUILTINS = new Set(['install', 'add', 'remove', 'update', 'exec', 'dlx', 'why'])
    const commands = [...md().matchAll(/^pnpm ([a-z:]+)$/gm)]
      .map((m) => m[1]!)
      .filter((c) => !PNPM_BUILTINS.has(c))
    expect(commands.length).toBeGreaterThanOrEqual(4)
    const scripts = Object.keys(
      (JSON.parse(readFileSync(r('package.json'), 'utf-8')) as { scripts: Record<string, string> })
        .scripts,
    )
    for (const command of commands) expect(scripts).toContain(command)
  })

  it('Given CONTRIBUTING.md, Then it points an upgrader at the breaking-change record', () => {
    // What this protects is the pointer, not a particular file: someone upgrading an app must not
    // have to guess where breaking changes are written down. The target moved when the internal
    // wiki was removed — the migration guides went with it, and the CHANGELOG is now the only
    // place that records a removal and names the version it landed in. Anchoring the match to the
    // word "upgrading" keeps this honest: a stray mention of the CHANGELOG elsewhere in the doc
    // would not satisfy it.
    expect(md()).toMatch(/upgrading[\s\S]{0,200}CHANGELOG\.md/)
  })

  it('Given CONTRIBUTING.md, Then it states the absence of a browser suite', () => {
    // There is no end-to-end harness. A contributor who assumes one exists will believe a
    // rendering change is covered when nothing exercised it.
    expect(md()).toMatch(/no browser suite/i)
  })
})

describe('T7.3 — issue templates are valid YAML with required fields', () => {
  it('Given bug_report.yml, Then parses + has name + description + body', () => {
    const yaml = readFileSync(r('.github/ISSUE_TEMPLATE/bug_report.yml'), 'utf-8')
    const parsed = parseYaml(yaml) as { name?: string; description?: string; body?: unknown[] }
    expect(parsed.name).toBeTruthy()
    expect(parsed.description).toBeTruthy()
    expect(Array.isArray(parsed.body)).toBe(true)
    expect((parsed.body ?? []).length).toBeGreaterThan(0)
  })

  it('Given feature_request.yml, Then parses + has name + body', () => {
    const yaml = readFileSync(r('.github/ISSUE_TEMPLATE/feature_request.yml'), 'utf-8')
    const parsed = parseYaml(yaml) as { name?: string; body?: unknown[] }
    expect(parsed.name).toBeTruthy()
    expect(Array.isArray(parsed.body)).toBe(true)
  })

  it('Given config.yml, Then blank_issues_enabled === false', () => {
    const yaml = readFileSync(r('.github/ISSUE_TEMPLATE/config.yml'), 'utf-8')
    const parsed = parseYaml(yaml) as { blank_issues_enabled?: boolean }
    expect(parsed.blank_issues_enabled).toBe(false)
  })
})

describe('T7.3 — EC-15 SECURITY.md disclosure ordering', () => {
  it('Given SECURITY.md, Then mentions GitHub Private Security Advisory BEFORE email', () => {
    const md = readFileSync(r('SECURITY.md'), 'utf-8')
    const advisoryIdx = md.search(/private security advisor[yi]/i)
    const emailIdx = md.search(/security@theokit\.dev|security@/i)
    expect(advisoryIdx).toBeGreaterThanOrEqual(0)
    if (emailIdx >= 0) {
      // If the email is mentioned at all, the advisory must come first.
      expect(advisoryIdx).toBeLessThan(emailIdx)
    }
  })

  it('Given SECURITY.md, Then mentions a supported version policy', () => {
    const md = readFileSync(r('SECURITY.md'), 'utf-8')
    expect(md).toMatch(/Supported Versions|supported.versions/i)
  })
})

describe('T7.3 — PR template has the right shape', () => {
  it('Given PULL_REQUEST_TEMPLATE.md, Then has Summary + Test plan sections', () => {
    const md = readFileSync(r('.github/PULL_REQUEST_TEMPLATE.md'), 'utf-8')
    expect(md).toMatch(/#+\s*Summary/i)
    expect(md).toMatch(/#+\s*Test plan|Testing/i)
  })

  it('Given PULL_REQUEST_TEMPLATE.md, Then references CHANGELOG.md', () => {
    const md = readFileSync(r('.github/PULL_REQUEST_TEMPLATE.md'), 'utf-8')
    expect(md).toMatch(/CHANGELOG/i)
  })
})
