/**
 * The pre-push gate distinguishes a stage that FAILED from one that was KILLED.
 *
 * The hook already carries that distinction, at length, and explains why it matters: exit codes
 * above 128 are `128 + signal`, so 137 is SIGKILL and 143 is SIGTERM, and neither means the code is
 * broken — it means something reached in and stopped the process. Reporting that as "build failed"
 * sends a developer looking for a defect that does not exist and trains them to reach for
 * `--no-verify` on a message that will one day be true.
 *
 * The distinction never ran. `set -e` sits above it, so a non-zero `pnpm build:packages` ended the
 * script on that line and `build_status=$?` — and every branch below it — was unreachable. Measured
 * on 2026-08-30: with `earlyoom` at its SIGTERM threshold (`sending SIGTERM to process … VmRSS 1794
 * MiB`, swap 100% full), a push printed the raw `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … build: tsup`
 * and nothing else. I went looking for a broken build. Nothing was broken and nothing was verified.
 *
 * A guard whose whole purpose is one branch, with that branch unreachable, is the shape the repo
 * names elsewhere: a gate that reads as enforcement and enforces nothing.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '../../.githooks/pre-push')

describe('pre-push reports a killed stage as killed', () => {
  let dir: string
  let bin: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pre-push-'))
    bin = join(dir, 'bin')
    mkdirSync(bin)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * A `pnpm` that exits with `code` for the named script and 0 for anything else, so a scenario can
   * break exactly one stage and leave the other honest.
   */
  function stubPnpm(script: string, code: number): void {
    const path = join(bin, 'pnpm')
    writeFileSync(
      path,
      `#!/usr/bin/env bash\nif [ "$1" = "${script}" ]; then\n  echo "stub: ${script} exiting ${code}" >&2\n  exit ${code}\nfi\nexit 0\n`,
    )
    chmodSync(path, 0o755)
  }

  function runHook(): { code: number; out: string } {
    try {
      // The rule below is right about the general case and inapplicable here: prepending a
      // writable directory to PATH is not an accident, it IS the fixture. The hook calls `pnpm` by
      // name, so a stub can only reach it that way, and the directory is one mkdtemp created and
      // afterEach removes. Naming the real reason rather than borrowing the sibling scripts'
      // "toolchain binary, fixed argv", which would be false of this call.
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- the writable PATH entry is the fixture
      const out = execFileSync('bash', [HOOK], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // `node` must stay reachable: the hook gates on its major version before anything else.
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          CI: '',
          GITHUB_ACTIONS: '',
        },
      })
      return { code: 0, out }
    } catch (err) {
      const e = err as { status: number; stdout?: string; stderr?: string }
      return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  it('names SIGTERM and says nothing was verified when the build is killed (143)', () => {
    stubPnpm('build:packages', 143)
    const { code, out } = runHook()

    expect(code).not.toBe(0)
    expect(out).toMatch(/KILLED/u)
    expect(out).toMatch(/SIGTERM/u)
    expect(out, 'the developer must not go looking for a defect').toMatch(/NOTHING was verified/u)
  })

  it('names the OOM killer when the build is SIGKILLed (137)', () => {
    stubPnpm('build:packages', 137)
    const { out } = runHook()

    expect(out).toMatch(/KILLED/u)
    expect(out).toMatch(/OOM killer/u)
  })

  it('still reports a real build failure as a failure', () => {
    // The load-bearing negative. Without it, "always say killed" satisfies the two above and the
    // gate stops reporting the break it exists to catch.
    stubPnpm('build:packages', 1)
    const { code, out } = runHook()

    expect(code).not.toBe(0)
    expect(out).toMatch(/package build failed/u)
    expect(out).not.toMatch(/KILLED/u)
  })

  it('applies the same distinction to the typecheck stage', () => {
    // Two stages, one helper — and the second call site is as unreachable as the first was.
    stubPnpm('typecheck:only', 143)
    const { code, out } = runHook()

    expect(code).not.toBe(0)
    expect(out).toMatch(/typecheck was KILLED/u)
  })

  it('passes when both stages pass', () => {
    stubPnpm('nothing-breaks-here', 1)
    const { code, out } = runHook()

    expect(code).toBe(0)
    expect(out).toMatch(/pre-push gates passed/u)
  })
})
