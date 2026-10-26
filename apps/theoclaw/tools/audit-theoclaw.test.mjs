import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { auditExitCode, runAudit, theoclawAdvisories } from './audit-theoclaw.mjs'

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/audit-two-importers.json', import.meta.url)), 'utf8'),
)
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

function audit(result) {
  const out = []
  const err = []
  const { spawn, calls } = fakeSpawn(result)
  const code = runAudit({ spawn, write: (line) => out.push(line), writeError: (line) => err.push(line) })
  return { code, out, err, calls }
}

describe('theoclawAdvisories', () => {
  it('keeps an advisory reached through apps__theoclaw in the dev tree', () => {
    expect(theoclawAdvisories(FIXTURE)).toEqual([
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
    const kept = theoclawAdvisories(FIXTURE)
    expect(kept).toHaveLength(1)
    expect(kept.map((a) => a.module)).not.toContain('mermaid')
  })

  it('keeps an advisory on the importer itself', () => {
    expect(theoclawAdvisories(report([advisory('x', 'low', ['apps__theoclaw'])]))).toHaveLength(1)
  })

  it('drops a path whose importer only starts with the same letters', () => {
    expect(theoclawAdvisories(report([advisory('x', 'low', ['apps__theoclaw-web>x'])]))).toEqual([])
  })

  it('refuses an advisory whose findings are not an array', () => {
    expect(() => theoclawAdvisories({ advisories: { 1: { module_name: 'x', findings: null } } })).toThrow(
      'advisory 1 is malformed',
    )
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
