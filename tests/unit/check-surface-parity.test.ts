/**
 * T5.1 — the surface-parity gate's own behaviour, asserted rather than assumed.
 *
 * This gate is the structural fix of the `crossval-absorption-gaps` plan: the one change that does
 * not add a capability but makes every un-forwarded capability detectable. A gate nobody tests is a
 * gate whose green is a guess — and this one's whole job is to refuse to certify what it did not
 * read.
 *
 * The behaviours that matter are the ones that decide whether a PASS means anything:
 *
 *  - it walks the subpaths the manifest declares, not a hand-kept list that drifts;
 *  - it SKIPS a subpath with no SDK counterpart, and says so;
 *  - warn mode carries a sunset, past which it fails hard;
 *  - `auth` stays a hard error.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE = join(REPO_ROOT, 'scripts', 'check-surface-parity.mjs')

interface GateRun {
  readonly status: number
  readonly output: string
}

/**
 * `spawnSync` and not `execFileSync`: the gate writes its skips to stdout and its WARNs to stderr,
 * and `execFileSync` hands back only stdout on success — a helper that dropped half the output
 * would have made "no warning was printed" indistinguishable from "the helper could not see it".
 */
function runGate(env: NodeJS.ProcessEnv = {}): GateRun {
  const result = spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('check-surface-parity', () => {
  it('gate_enumerates_every_manifest_subpath', () => {
    const { status, output } = runGate()

    expect(status, output).toBe(0)
    // Every subpath is accounted for: decided, warned, or skipped-with-a-reason. Silence about one
    // would be the gate certifying a surface it never considered.
    expect(output).toMatch(/applicable subpath\(s\) decided/)
    expect(output).toContain('have no SDK counterpart')
  })

  it('a_subpath_without_an_sdk_counterpart_is_skipped_with_a_reason', () => {
    const { output } = runGate()

    expect(output).toContain('./session — the SDK publishes no subpath under this name')
  })

  it('warn_mode_names_its_sunset', () => {
    const { output } = runGate()

    // A warning with no date is how warn mode becomes permanent.
    expect(output).toMatch(/WARN: .*hard-fails from \d{4}-\d{2}-\d{2}/)
  })

  it('expired_warn_mode_fails_hard', () => {
    // The forcing function. Travel past every sunset and the gate must stop tolerating the deferral.
    const { status, output } = runGate({ SURFACE_PARITY_TODAY: '2099-01-01' })

    expect(status, 'an expired deferral still passed').toBe(1)
    expect(output).toMatch(/deferred until .* and that date has passed/)
  })

  it('auth_remains_a_hard_gate', () => {
    // The subpath the gate was born for keeps its full-severity contract while the others warm up.
    // Asserted by BEHAVIOUR: remove a decision and the gate must exit 1, rather than by grepping for
    // a line of source that a refactor could move while the guarantee quietly disappeared.
    const gate = readFileSync(GATE, 'utf8')
    const withoutOneDecision = gate.replace("    assertSecureModes: 're-exported',\n", '')
    expect(withoutOneDecision, 'the fixture edit did not apply').not.toBe(gate)

    // Beside the real gate, NOT in a temp dir: the script resolves the repo root relative to its own
    // location, so a copy anywhere else would fail to find the manifests and "exit 1" would prove
    // nothing about the decision it is supposed to be missing.
    const tampered = join(REPO_ROOT, 'scripts', `.parity-tampered-${String(process.pid)}.mjs`)
    writeFileSync(tampered, withoutOneDecision, 'utf8')
    try {
      const result = spawnSync(process.execPath, [tampered], { cwd: REPO_ROOT, encoding: 'utf8' })
      expect(result.status, 'an undecided auth symbol did not fail the gate').toBe(1)
      expect(`${result.stdout}${result.stderr}`).toContain('assertSecureModes')
    } finally {
      rmSync(tampered, { force: true })
    }
  })

  it('anti_vacuity_floor_is_present', () => {
    // A gate that reads nothing passes by VACUITY. The floor is what turns "found 0 symbols" into a
    // failure instead of a trivially-true "0 undecided".
    expect(readFileSync(GATE, 'utf8')).toContain('PISO_DE_SIMBOLOS')
  })
})
