import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { APP_IMPORTER, auditExitCode, auditScope, runAudit, theoclawAdvisories } from './audit-theoclaw.mjs'

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
const FIXTURE = JSON.parse(fixture('audit-two-importers.json'))
const LOCKFILE = fixture('lockfile-linked.yaml')
const SCOPE = auditScope(LOCKFILE)
const MIB = 1024 * 1024
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function advisory(module, severity, paths, version = '1.0.0') {
  return { module_name: module, severity, github_advisory_id: `GHSA-${module}`, findings: [{ version, paths }] }
}

function report(advisories) {
  return { advisories: Object.fromEntries(advisories.map((a, i) => [String(i + 1), a])) }
}

/** A spawn that records its call and answers with `result`. */
function fakeSpawn(result) {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { status: 1, signal: null, stdout: '', stderr: '', ...result }
  }
  return { spawn, calls }
}

function audit(result, readLockfile = () => LOCKFILE) {
  const out = []
  const err = []
  const reads = []
  const { spawn, calls } = fakeSpawn(result)
  const readFile = (path) => {
    reads.push(path)
    return readLockfile(path)
  }
  const write = (line) => out.push(line)
  const code = runAudit({ spawn, readFile, write, writeError: (line) => err.push(line) })
  return { code, out, err, calls, reads }
}

const finding = (paths, version = '1.0.0') => ({ version, paths })
const wellFormed = (overrides) => ({
  module_name: 'x',
  severity: 'low',
  github_advisory_id: 'GHSA-x',
  findings: [finding(['apps__theoclaw>x'])],
  ...overrides,
})

describe('theoclawAdvisories', () => {
  it('keeps an advisory reached through apps__theoclaw in the dev tree', () => {
    expect(theoclawAdvisories(FIXTURE, SCOPE)).toEqual([
      {
        severity: 'moderate',
        ghsa: 'GHSA-0000-vite-0001',
        module: 'vite',
        version: '7.3.5',
        path: 'apps__theoclaw>vitest>vite',
      },
    ])
  })

  it('drops an advisory reached only through packages__theo', () => {
    const kept = theoclawAdvisories(FIXTURE, SCOPE)
    expect(kept).toHaveLength(1)
    expect(kept.map((a) => a.module)).not.toContain('mermaid')
  })

  it('keeps an advisory on the importer itself', () => {
    expect(theoclawAdvisories(report([advisory('x', 'low', ['apps__theoclaw'])]), SCOPE)).toHaveLength(1)
  })

  it('drops a path whose importer only starts with the same letters', () => {
    expect(theoclawAdvisories(report([advisory('x', 'low', ['apps__theoclaw-web>x'])]), SCOPE)).toEqual([])
  })

  it('keeps an advisory reported under a workspace package TheoClaw links', () => {
    const kept = theoclawAdvisories(report([advisory('x', 'low', ['packages__agents>@theokit/sdk-tools>x'])]), SCOPE)
    expect(kept.map((a) => a.path)).toEqual(['packages__agents>@theokit/sdk-tools>x'])
  })

  it('keeps an advisory under a package linked through a linked package', () => {
    const kept = theoclawAdvisories(report([advisory('marked', 'low', ['packages__presenter>marked'])]), SCOPE)
    expect(kept).toHaveLength(1)
  })

  it('drops an advisory reached only through a linked package devDependency', () => {
    expect(theoclawAdvisories(report([advisory('vite', 'low', ['packages__agents>vitest>vite'])]), SCOPE)).toEqual([])
  })

  it('drops a package linked only from a linked package devDependencies', () => {
    expect(theoclawAdvisories(report([advisory('undici', 'low', ['packages__http>undici'])]), SCOPE)).toEqual([])
  })

  it('refuses an advisory whose findings are null when every other field is present', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ findings: null })]), SCOPE)).toThrow('advisory 1 is malformed')
  })

  it('refuses an advisory with no advisory id when every other field is present', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ github_advisory_id: undefined })]), SCOPE)).toThrow(
      'advisory 1 is malformed',
    )
  })

  it('refuses a finding whose version is not a string', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ findings: [finding(['apps__theoclaw>x'], 1)] })]), SCOPE)).toThrow(
      'advisory 1 is malformed',
    )
  })

  it('refuses an advisory with no severity when every other field is present', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ severity: undefined })]), SCOPE)).toThrow('advisory 1 is malformed')
  })

  it('refuses an advisory with no module name when every other field is present', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ module_name: undefined })]), SCOPE)).toThrow(
      'advisory 1 is malformed',
    )
  })

  it('refuses an advisory whose finding is null', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ findings: [null] })]), SCOPE)).toThrow('advisory 1 is malformed')
  })

  it('refuses a finding whose path is not a string', () => {
    expect(() => theoclawAdvisories(report([wellFormed({ findings: [finding([1])] })]), SCOPE)).toThrow(
      'advisory 1 is malformed',
    )
  })
})

describe('auditScope', () => {
  it('derives the importer from the tool location', () => {
    expect(APP_IMPORTER).toBe('apps/theoclaw')
  })

  it('refuses a link to a directory the lockfile has no importer for', () => {
    expect(() => auditScope(LOCKFILE.replace('  packages/presenter:', '  packages/gone:'))).toThrow(
      'packages/agents links packages/presenter, which is no importer in pnpm-lock.yaml',
    )
  })

  it('refuses a lockfile with no importer for the app', () => {
    expect(() => auditScope(LOCKFILE.replace('  apps/theoclaw:', '  apps/other:'))).toThrow(
      'no apps/theoclaw importer in pnpm-lock.yaml',
    )
  })

  it('refuses a lockfile version the reader was not written for', () => {
    expect(() => auditScope(LOCKFILE.replace("lockfileVersion: '9.0'", "lockfileVersion: '6.0'"))).toThrow(
      'pnpm-lock.yaml has lockfileVersion 6.0; this reader reads 9.0',
    )
  })

  it('refuses a lockfile with no lockfileVersion', () => {
    expect(() => auditScope(LOCKFILE.replace("lockfileVersion: '9.0'\n", ''))).toThrow(
      'pnpm-lock.yaml has lockfileVersion (none); this reader reads 9.0',
    )
  })

  it('refuses an importer dependency written inline, with no version line', () => {
    const inline = LOCKFILE.replace(
      "      '@theokit/agents':\n        specifier: workspace:*\n        version: link:../../packages/agents\n",
      "      '@theokit/agents': link:../../packages/agents\n",
    )
    expect(() => auditScope(inline)).toThrow('apps/theoclaw dependencies @theokit/agents has no version line in pnpm-lock.yaml')
  })

  it('refuses an importer section written as a flow mapping', () => {
    const flow = LOCKFILE.replace('  packages/http:\n    dependencies:\n', '  packages/http:\n    dependencies: {}\n    devDependencies:\n')
    expect(() => auditScope(flow)).toThrow('packages/http dependencies is not a block mapping in pnpm-lock.yaml')
  })

  it("admits every workspace package the app's manifest links in the repository lockfile", () => {
    const manifest = JSON.parse(readFileSync(`${REPO_ROOT}apps/theoclaw/package.json`, 'utf8'))
    const linked = Object.values({ ...manifest.dependencies, ...manifest.devDependencies }).filter((spec) =>
      spec.startsWith('workspace:'),
    )
    const scope = auditScope(readFileSync(`${REPO_ROOT}pnpm-lock.yaml`, 'utf8'))
    expect([...scope.keys()]).toEqual(
      expect.arrayContaining(['apps__theoclaw', 'packages__agents', 'packages__http', 'packages__presenter']),
    )
    expect(scope.size - 1).toBeGreaterThanOrEqual(linked.length)
  })
})

describe('auditExitCode', () => {
  it('exits 1 when any advisory is kept', () => {
    expect(auditExitCode([{}])).toBe(1)
  })

  it('exits 0 when none is kept', () => {
    expect(auditExitCode([])).toBe(0)
  })
})

describe('runAudit', () => {
  it('reads the lockfile at the repository root', () => {
    const { reads } = audit({ stdout: JSON.stringify(report([])) })
    expect(reads).toEqual([`${REPO_ROOT}pnpm-lock.yaml`])
  })

  it('exits 2 when the lockfile cannot be read', () => {
    const missing = () => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    }
    const { code, err } = audit({ stdout: JSON.stringify(report([])) }, missing)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('cannot read pnpm-lock.yaml: ENOENT: no such file')
  })

  it('exits 2 when the lockfile has no importer for the app', () => {
    const { code, err } = audit({ stdout: JSON.stringify(report([])) }, () => 'lockfileVersion: 9.0\n')
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('no apps/theoclaw importer')
  })

  it('prints an advisory reported under a linked workspace package and exits 1', () => {
    const { code, out } = audit({
      stdout: JSON.stringify(report([advisory('x', 'moderate', ['packages__agents>@theokit/sdk-tools>x'])])),
    })
    expect(code).toBe(1)
    expect(out).toEqual(['moderate GHSA-x x@1.0.0 packages__agents>@theokit/sdk-tools>x'])
  })

  it('runs pnpm audit --json from the repository root with a 64 MiB buffer', () => {
    const { calls } = audit({ stdout: JSON.stringify(report([])) })
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('pnpm')
    expect(calls[0].args).toEqual(['audit', '--json'])
    expect(calls[0].options).toMatchObject({ cwd: REPO_ROOT, maxBuffer: 64 * MIB })
  })

  it('prints one line per kept advisory and exits 1', () => {
    const { code, out } = audit({ stdout: JSON.stringify(FIXTURE) })
    expect(code).toBe(1)
    expect(out).toEqual(['moderate GHSA-0000-vite-0001 vite@7.3.5 apps__theoclaw>vitest>vite'])
  })

  it('exits 1 at a low severity', () => {
    const { code } = audit({ stdout: JSON.stringify(report([advisory('x', 'low', ['apps__theoclaw>x'])])) })
    expect(code).toBe(1)
  })

  it('exits 0 when pnpm audit reports advisories on other importers only', () => {
    const { code, out } = audit({
      status: 1,
      stdout: JSON.stringify(report([advisory('x', 'critical', ['packages__theo>x'])])),
    })
    expect(code).toBe(0)
    expect(out).toEqual([])
  })

  it('exits 2 when pnpm audit printed no JSON', () => {
    const { code, err } = audit({ status: 1, stdout: 'ERR', stderr: 'ERR_PNPM_AUDIT_BAD_RESPONSE' })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('exit 1')
    expect(err.join('\n')).toContain('ERR_PNPM_AUDIT_BAD_RESPONSE')
  })

  it('exits 2 when pnpm audit printed an empty stdout', () => {
    const { code, err } = audit({ status: 1, stdout: '', stderr: 'registry unreachable' })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('registry unreachable')
  })

  it('exits 2 naming the signal that killed pnpm audit', () => {
    const { code, err } = audit({ status: null, signal: 'SIGTERM', stdout: '' })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('SIGTERM')
  })

  it('exits 2 when the spawn itself fails', () => {
    const { code, err } = audit({ error: Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' }) })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('ENOENT')
  })

  it('exits 2 when the JSON has no advisories object', () => {
    const { code, err } = audit({ stdout: JSON.stringify({ error: { code: 'ENOAUDIT' } }) })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('no advisories object')
  })

  it('exits 2 when a kept advisory has no severity or advisory id', () => {
    const bare = { module_name: 'x', findings: [{ version: '1.0.0', paths: ['apps__theoclaw>x'] }] }
    const { code, err, out } = audit({ stdout: JSON.stringify({ advisories: { 1: bare } }) })
    expect(code).toBe(2)
    expect(out).toEqual([])
    expect(err.join('\n')).toContain('advisory 1 is malformed')
  })

  it('exits 2 when an advisory has a malformed shape', () => {
    const { code, err } = audit({ stdout: JSON.stringify({ advisories: { 1: null } }) })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('malformed')
  })

  it('parses a 5 MiB report', () => {
    const filler = report([advisory('vite', 'moderate', ['apps__theoclaw>vitest>vite'], '7.3.5')])
    filler.metadata = { padding: 'x'.repeat(5 * MIB) }
    const stdout = JSON.stringify(filler)
    expect(stdout.length).toBeGreaterThan(5 * MIB)
    const { code, out } = audit({ stdout })
    expect(code).toBe(1)
    expect(out).toHaveLength(1)
  })
})
