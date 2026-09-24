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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  /**
   * B-298. The declared-types stage is the third stage, and it is the one case in this hook where
   * "a break must NOT reach develop" is the WRONG sentence: the build above reported success, and
   * what is wrong is a local, gitignored artifact that never reaches the remote.
   *
   * Measured 2026-09-24: a `dist` with 201 `.js` and 0 `.d.ts` makes `tsc -p packages/tauri` exit 2
   * with TS7016 located at `packages/tauri/src/sidecar.ts` — a consumer file that did not change.
   * Telling the developer their code is broken here would be the same misattribution the stage was
   * added to remove.
   */
  it('does not call an incomplete DTS artifact a break, because the source is not implicated', () => {
    stubPnpm('check:dts-complete', 1)
    const { code, out } = runHook()

    expect(code).not.toBe(0)
    expect(out).toMatch(/missing its declared types/u)
    expect(out, 'the developer must not go looking for a defect in their own source').toMatch(
      /Your source is not implicated/u,
    )
    expect(out).not.toMatch(/A break must NOT reach develop/u)
  })

  it('still reports the declared-types check being KILLED as a kill, having verified nothing', () => {
    // The load-bearing negative for the branch above: without it, "never say killed" satisfies that
    // test and the stage stops distinguishing a check that died from one that found something.
    stubPnpm('check:dts-complete', 143)
    const { code, out } = runHook()

    expect(code).not.toBe(0)
    expect(out).toMatch(/declared-types check was KILLED/u)
    expect(out).toMatch(/NOTHING was verified/u)
    expect(out).not.toMatch(/Your source is not implicated/u)
  })

  it('tells a developer whose build was killed that a poisoned dist may be left behind', () => {
    // `clean: true` removes the previous declarations before the DTS worker writes new ones, so a
    // kill there leaves JS with no types — and dist/ is gitignored, so nothing else will mention it.
    stubPnpm('build:packages', 143)
    const { out } = runHook()

    expect(out).toMatch(/POISONED dist/u)
    expect(out).toMatch(/check:dts-complete/u)
  })

  /**
   * Measured 2026-09-24 by capping a real build's heap rather than signalling anything: a DTS
   * *worker thread* that exhausts its heap raises `ERR_WORKER_OUT_OF_MEMORY` on the parent, and tsup
   * exits **1**. With `NODE_OPTIONS=--max-old-space-size=256` on `packages/http` that run took its
   * `dist` from 10 `.d.ts` to 0 — tsup's `tsup:clean` plugin wipes the declarations at rollup's
   * `buildStart`, and the worker died before writing their replacements.
   *
   * So exit 1 poisons the dist exactly as a signal does, and the hook told nobody: the poisoned-dist
   * note lived only in the `> 128` branch, and `report_stage_failure` exits before
   * `check:dts-complete` can run. The one case that leaves a poisoned dist was the one never warned
   * about.
   *
   * `check_dts_complete` is also NOT reached by a plain exit-1 failure for a cause B-298 already
   * measured: an unbuilt workspace dependency gives `DTS Build error` + TS2307 and leaves 201 `.js`
   * with 0 `.d.ts`. Two measured routes to a poisoned dist, both through exit 1.
   */
  it('tells a developer whose build FAILED that a poisoned dist may be left behind too', () => {
    stubPnpm('build:packages', 1)
    const { out } = runHook()

    expect(out).toMatch(/POISONED dist/u)
    expect(out).toMatch(/check:dts-complete/u)
    // Still a failure, never relabelled as a kill — the negative the sibling test pins.
    expect(out).not.toMatch(/KILLED/u)
  })

  it('does not mention a poisoned dist when no build ran', () => {
    // The load-bearing negative. Without it, printing the note unconditionally satisfies the test
    // above, and a formatting failure starts advising a dist nothing touched. `format:check` is the
    // first stage and returns before `build:packages` is invoked at all.
    stubPnpm('format:check', 1)
    const { out } = runHook()

    expect(out).toMatch(/format check failed/u)
    expect(out).not.toMatch(/POISONED dist/u)
  })

  it('passes when both stages pass', () => {
    stubPnpm('nothing-breaks-here', 1)
    const { code, out } = runHook()

    expect(code).toBe(0)
    expect(out).toMatch(/pre-push gates passed/u)
  })
})

/**
 * B-241's second Definition-of-done bullet, at the layer the fix actually chose.
 *
 * The bullet asks that "a commit that stages an unformatted file cannot complete". It cannot be met
 * at commit time and should not be: `lint-staged` runs `prettier --write`, so the hook FIXES the
 * file and exits 0 — measured 2026-09-22 by staging a deliberately unformatted file and running
 * `.githooks/pre-commit`, which reformatted it and returned 0. Refusing there would be worse UX for
 * the same outcome.
 *
 * What let three unformatted files into the repository is the row the item's own verdict records:
 * `git -c core.hooksPath=<a directory with no hooks> commit` runs no hook and succeeds, silently.
 * Nothing at commit time can close that, because the bypass is the commit-time mechanism itself.
 * So the gate lives in `pre-push`, and these pin it there.
 */
describe('the pre-push hook checks formatting, and checks it first (B-241)', () => {
  const source = (): string => readFileSync(HOOK, 'utf8')

  it('test_format_check_is_one_of_the_stages', () => {
    expect(
      source(),
      'the pre-push hook does not run `pnpm format:check`, so an unformatted file reaches the remote ' +
        'whenever the commit-time hook was skipped — which is exactly how three of them did',
    ).toContain('pnpm format:check')
  })

  it('test_format_check_runs_before_the_expensive_stages', () => {
    // Line numbers of the INVOCATIONS, not positions of the strings. `pnpm build:packages` appears
    // first inside an `echo` of the escape-hatch advice at the top of the hook, 76 lines above the
    // line that runs it — so comparing raw string offsets compared a message against a command and
    // reported the order backwards. Measured 2026-09-22 when this assertion failed on a hook whose
    // order was already right.
    const lines = source().split('\n')
    const invocation = (command: string): number =>
      lines.findIndex((line) => line.trimStart().startsWith(`pnpm ${command} ||`))

    const format = invocation('format:check')
    const build = invocation('build:packages')
    const typecheck = invocation('typecheck:only')

    expect(format, 'no `pnpm format:check` invocation to order').toBeGreaterThan(-1)
    expect(build, 'no `pnpm build:packages` invocation to order against').toBeGreaterThan(-1)
    expect(typecheck, 'no `pnpm typecheck:only` invocation to order against').toBeGreaterThan(-1)
    // 13s against roughly 90s for the two below it. Ordering is not cosmetic: a formatting refusal
    // that arrives after a ninety-second build is a refusal people route around.
    expect(
      format,
      'format:check runs after the build or the typecheck, so the cheapest refusal costs the most',
    ).toBeLessThan(Math.min(build, typecheck))
  })
})
