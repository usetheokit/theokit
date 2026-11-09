import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { auditConfiguration, fixFindings } from '../src/security-audit.js'
import { cleanScratch, harness, scratchDir } from './support/cli-harness.js'

afterEach(cleanScratch)

const TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789'

function configFile(lines: readonly string[], mode: number): { dir: string; path: string } {
  const dir = join(scratchDir(), 'theoclaw')
  mkdirSync(dir, { recursive: true })
  chmodSync(dir, 0o700)
  const path = join(dir, 'theoclaw.env')
  writeFileSync(path, `${lines.join('\n')}\n`)
  chmodSync(path, mode)
  return { dir, path }
}

const modeOf = (path: string): number => statSync(path).mode & 0o777

describe('theoclaw security audit', () => {
  it('reports a world-readable file, a wide directory, a public bind, an open DM policy and a weak token by id', () => {
    const { dir, path } = configFile(
      [`THEOCLAW_CONTROL_TOKEN="tk-9f3a"`, 'THEOCLAW_HOST="0.0.0.0"', 'THEOCLAW_PUBLIC_BIND="yes"', 'THEOCLAW_DM_POLICY="open"', 'THEOCLAW_SANDBOX="danger-full-access"'],
      0o644,
    )
    chmodSync(dir, 0o755)
    const findings = auditConfiguration({ THEOCLAW_CONFIG: path }, dir)
    expect(findings.map((f) => f.id).sort()).toEqual(['SA-001', 'SA-002', 'SA-003', 'SA-004', 'SA-005', 'SA-006'])
    expect(findings.filter((f) => f.fixable).map((f) => f.id).sort()).toEqual(['SA-001', 'SA-002'])
    expect(JSON.stringify(findings)).not.toContain("tk-9f3a")
  })

  it('a safe configuration has no finding', () => {
    const { path, dir } = configFile([`THEOCLAW_CONTROL_TOKEN="${TOKEN}"`, 'THEOCLAW_DM_POLICY="pairing"'], 0o600)
    expect(auditConfiguration({ THEOCLAW_CONFIG: path }, dir)).toEqual([])
  })

  it('a missing named file is refused, naming the path and never a value', () => {
    expect(() => auditConfiguration({ THEOCLAW_CONFIG: '/nonexistent/theoclaw.env' }, '/tmp')).toThrow(/\/nonexistent\/theoclaw\.env/)
  })

  it('--fix narrows the file and its own directory, leaves the rest reported, and a second run is clean of them', async () => {
    const { dir, path } = configFile([`THEOCLAW_CONTROL_TOKEN="${TOKEN}"`, 'THEOCLAW_DM_POLICY="open"'], 0o664)
    chmodSync(dir, 0o775)
    const h = harness()
    const env = { THEOCLAW_CONFIG: path }
    Object.assign(h.io.env, env)

    expect(await runCli(['security', 'audit'], h.io)).toBe(3)
    expect(h.stdout()).toContain('SA-001')
    expect(modeOf(path)).toBe(0o664)

    const fixed = harness()
    Object.assign(fixed.io.env, env)
    expect(await runCli(['security', 'audit', '--fix'], fixed.io)).toBe(3)
    expect(modeOf(path)).toBe(0o600)
    expect(modeOf(dir)).toBe(0o700)
    expect(fixed.stdout()).toContain('fixed SA-001')
    expect(fixed.stdout()).toContain('SA-004')
    expect(fixed.stdout()).not.toContain(TOKEN)

    expect(auditConfiguration(env, dir).map((f) => f.id)).toEqual(['SA-004'])
  })

  it('a clean file exits 0, and a bad verb or flag exits 2', async () => {
    const { path } = configFile([`THEOCLAW_CONTROL_TOKEN="${TOKEN}"`], 0o600)
    const h = harness()
    Object.assign(h.io.env, { THEOCLAW_CONFIG: path })
    expect(await runCli(['security', 'audit'], h.io)).toBe(0)
    expect(await runCli(['security', 'scan'], harness().io)).toBe(2)
    expect(await runCli(['security', 'audit', '--nope'], harness().io)).toBe(2)
  })

  it('fixFindings leaves a directory that is not TheoClaw\'s own alone', () => {
    const dir = scratchDir()
    chmodSync(dir, 0o755)
    const path = join(dir, 'x.env')
    writeFileSync(path, '')
    chmodSync(path, 0o600)
    expect(auditConfiguration({ THEOCLAW_CONFIG: path }, dir)).toEqual([])
    expect(fixFindings([], path)).toEqual([])
  })
})
