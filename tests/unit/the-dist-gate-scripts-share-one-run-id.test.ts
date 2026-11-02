import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * B-700 — every script that runs the dist gate before vitest hands both one run id.
 *
 * The build helper keys "dist validated this run" on `THEOKIT_TEST_RUN_ID` (falling back to the
 * parent pid, which the gate and a vitest worker never share). So the variable must reach BOTH the
 * gate and vitest, which an `export` does and an inline assignment (`X=$$ pnpm test:dist-gate &&
 * vitest run`) does not: the inline form scopes the value to the gate alone.
 *
 * Each script's text runs under `/bin/sh -c` with `pnpm` and `vitest` replaced on `PATH` by stubs
 * that record the id they inherited. The child env sets `THEOKIT_TEST_RUN_ID` to '' so the value
 * this run itself exported cannot reach the stubs and make an inline assignment pass (EC-1).
 */
const PACKAGE_JSON = resolve(__dirname, '../../package.json')
const GATE_THEN_VITEST = 'test:dist-gate &&'

const sandboxes: string[] = []

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The ids the `pnpm` stub and then the `vitest` stub saw, one per line, in call order. */
function idsSeenBy(scriptText: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'theo-dist-gate-script-'))
  sandboxes.push(dir)
  const seen = join(dir, 'seen')
  const stub = `#!/bin/sh\nprintf '%s\\n' "$THEOKIT_TEST_RUN_ID" >> "${seen}"\nexit 0\n`
  writeFileSync(join(dir, 'pnpm'), stub, { mode: 0o755 })
  writeFileSync(join(dir, 'vitest'), stub, { mode: 0o755 })

  execFileSync('/bin/sh', ['-c', scriptText], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      THEOKIT_TEST_RUN_ID: '',
    },
    timeout: 10_000,
  })

  // Split on newlines and drop only the trailing one: an empty id is a line, and it is the line
  // the negative control asserts.
  const lines = readFileSync(seen, 'utf8').split('\n')
  return lines.slice(0, -1)
}

function gateRunningScripts(): [string, string][] {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { scripts: Record<string, string> }
  return Object.entries(pkg.scripts).filter(([, text]) => text.includes(GATE_THEN_VITEST))
}

describe('the dist gate scripts share one run id', () => {
  it('test_every_dist_gate_script_hands_the_gate_and_vitest_one_run_id', () => {
    const scripts = gateRunningScripts()
    // test, test:watch, test:types, test:coverage: an empty selection must not pass.
    expect(scripts.length).toBeGreaterThanOrEqual(4)

    for (const [name, text] of scripts) {
      const seen = idsSeenBy(text)
      expect(seen, `${name}: expected one call to the gate and one to vitest`).toHaveLength(2)
      const [gate, vitest] = seen
      expect(gate, `${name}: the gate saw no run id`).not.toBe('')
      expect(vitest, `${name}: vitest saw a different run id from the gate`).toBe(gate)
    }
  })

  it('test_an_inline_assignment_does_not_reach_vitest', () => {
    // The negative control: the form this test exists to refuse. Without it, a selection that
    // passed for any reason would look like a passing export.
    const seen = idsSeenBy('THEOKIT_TEST_RUN_ID=$$ pnpm test:dist-gate && vitest run')
    expect(seen).toHaveLength(2)
    const [gate, vitest] = seen
    expect(gate).not.toBe('')
    expect(vitest).toBe('')
  })
})
