/**
 * The probe's `--ingest` is user input at a CLI boundary, and its diagnostics are the whole product:
 * this script exists to say what it could NOT measure, so a message naming the wrong cause is the
 * failure it was written to prevent.
 *
 * Driven as a subprocess because the module runs the whole probe at import — there is no exported
 * surface to call. The interface is therefore the process: its arguments, its streams and its exit
 * code, which is what an operator meets and what the header makes promises about.
 */
import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

/**
 * Runs the probe with `args` and returns its exit code with both streams, never throwing on non-zero.
 *
 * `stdout` is carried as well as `stderr` because exit 0 now has to SHOW what it observed. A code
 * alone cannot distinguish an earned pass from the unconditional one B-294 recorded.
 */
async function probe(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      'npx',
      ['tsx', 'scripts/probe-otlp-delivery.ts', ...args],
      {
        cwd: process.cwd(),
        timeout: 120_000,
      },
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('probe-otlp-delivery exit contract', () => {
  // A missing scheme is the likeliest typo. Before this case the probe answered it with the guard's
  // own message — "answers below 400 … on a path it does not serve" — sending the reader to debug a
  // collector when the fault is in their flag. Exit 2 was right; the sentence was not.
  it('names the flag, not the collector, when --ingest is not a URL', async () => {
    const { code, stderr } = await probe(['--ingest', '127.0.0.1:4318/v1/traces'])
    expect(code).toBe(2)
    expect(stderr).toContain('--ingest')
    expect(stderr).toContain('NOT MEASURED')
    expect(stderr).not.toContain('answers below 400')
  }, 130_000)
})

/**
 * B-294 — every exit code the header documents, driven through the only interface the probe has.
 *
 * A receiver stands in for the collector, and it is a real HTTP server: the probe's control POSTs to a
 * path it does not serve and must be refused, then the exporter POSTs the span for real. Nothing about
 * the probe is stubbed — what changes between the exit-0 and the exit-1 case is one status the server
 * answers, which is exactly the difference the probe was failing to read.
 *
 * Measured before the fix, against the exit-1 receiver: the span was refused with 404 and the probe
 * exited 0, printing the epilogue that sends the operator to read back a span the collector threw
 * away. That is the defect, and it is what the second case below pins.
 */
describe('probe-otlp-delivery — the documented exit codes are reachable', () => {
  /**
   * An HTTP server that refuses everything except `acceptPath`, which it answers with `acceptStatus`.
   *
   * Refusing the unknown path is what lets the probe's own control pass, so the run gets as far as
   * exporting. A receiver that accepted everything would be rejected by the control instead — which
   * is the `permissive` case, exercised separately below.
   */
  async function receiver(acceptPath: string | null, acceptStatus = 200) {
    const seen: string[] = []
    const server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        const status = req.url === acceptPath ? acceptStatus : 404
        seen.push(`${String(req.method)} ${String(req.url)} -> ${String(status)}`)
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return {
      url: `http://127.0.0.1:${String(port)}/v1/traces`,
      seen,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    }
  }

  it('Given a collector that accepts the span, Then exit 0', async () => {
    const collector = await receiver('/v1/traces', 200)
    try {
      const { code, stdout } = await probe(['--ingest', collector.url])
      expect(code).toBe(0)
      // The evidence is printed, not merely implied by the code: a reader must be able to tell an
      // earned exit 0 from an unconditional one, which is the whole of B-294.
      expect(stdout).toMatch(/accepted/i)
      expect(collector.seen.some((l) => l.includes('/v1/traces -> 200'))).toBe(true)
    } finally {
      await collector.close()
    }
  }, 130_000)

  it('Given a collector that refuses the span, Then exit 1 rather than a green exit 0', async () => {
    // The measured defect. `/v1/traces` answers 404 while an unknown path answers 404 too, so the
    // control is satisfied and the delivery is refused — and the probe used to exit 0 here.
    const collector = await receiver(null)
    try {
      const { code, stderr } = await probe(['--ingest', collector.url])
      expect(code).toBe(1)
      expect(stderr).toContain('404')
      expect(collector.seen.some((l) => l.includes('/v1/traces -> 404'))).toBe(true)
    } finally {
      await collector.close()
    }
  }, 130_000)

  it('Given nothing listening, Then exit 2 names the unreachable endpoint', async () => {
    // Port 1 on loopback: privileged, and nothing binds it. "Could not measure" must stay distinct
    // from "measured and failed", which is why this is 2 and the case above is 1.
    const { code, stderr } = await probe(['--ingest', 'http://127.0.0.1:1/v1/traces'])
    expect(code).toBe(2)
    expect(stderr).toContain('NOT MEASURED')
    expect(stderr).toMatch(/nothing answered/i)
  }, 130_000)

  it('Given a receiver that accepts everything, Then exit 2 — the control refuses to measure', async () => {
    // A success against a receiver that cannot say no would say nothing at all. This is the condition
    // the probe's control was written for, and it must outrank the delivery check: the run never gets
    // far enough to export.
    const permissive = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => permissive.listen(0, '127.0.0.1', resolve))
    const { port } = permissive.address() as AddressInfo
    try {
      const { code, stderr } = await probe([
        '--ingest',
        `http://127.0.0.1:${String(port)}/v1/traces`,
      ])
      expect(code).toBe(2)
      expect(stderr).toMatch(/answers below 400/)
    } finally {
      await new Promise<void>((resolve) => permissive.close(() => resolve()))
    }
  }, 130_000)
})

/**
 * B-303 — a precondition the probe needs and does not have must not be reported as a refused delivery.
 *
 * Measured from a clean worktree, twice: `pnpm probe:otlp` raised `ERR_MODULE_NOT_FOUND` for
 * `@theokit/sdk` with nothing installed, then for `@theokit/presenter/dist/index.js` with nothing
 * built, and BOTH ended at exit 1 — the code this probe's header reserves for *"the run produced no
 * span, the collector refused the payload, or the transport never reached it"*. The operator was sent
 * to the collector instead of to `pnpm install`.
 *
 * ## Why a copy of the probe in a throwaway tree
 *
 * The state under test is "a module the probe imports cannot be resolved", and the only way to create
 * it against the real tree is to remove an installed dependency or a sibling's `dist` — which breaks
 * every other suite on the machine, and would make these cases pass or fail depending on whether
 * somebody had run `pnpm build:packages`. The probe resolves its imports relative to its own file and
 * its repository root from `import.meta.url`, so a copy in a throwaway tree resolves everything
 * inside that tree. The cases are deterministic and say nothing about this checkout.
 *
 * What is real: the current bytes of `scripts/probe-otlp-delivery.ts`, a real subprocess, Node's own
 * resolution failure, and the exit code an operator meets. Each staged failure is given the SHAPE the
 * matching crash had — a bare package specifier for the uninstalled case, a path into a sibling's
 * `dist` for the unbuilt one — because the classification turns on exactly that difference, and a
 * stand-in of the wrong shape would exercise the wrong branch.
 */
describe('probe-otlp-delivery — a missing precondition is not a refused delivery', () => {
  /**
   * A tree holding a copy of the probe, its libs, and a `packages/agents/src/index.ts` whose single
   * import is `failingImport`. That import is the first thing the probe loads, so it is what fails.
   *
   * `{"type": "module"}` at the root is not decoration: without it Node reads the copied `.ts` as CJS
   * and esbuild refuses the probe's top-level await. The first version of this helper omitted it and
   * all three cases failed at exit 1 — the very code under test — for a reason that had nothing to do
   * with the probe. A stand-in has to fail for the reason being measured or it measures the stand-in.
   */
  function stagedProbe(failingImport: string, ...workspacePackages: string[]): string {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'probe-contract-'))
    mkdirSync(join(root, 'scripts'), { recursive: true })
    cpSync('scripts/probe-otlp-delivery.ts', join(root, 'scripts', 'probe-otlp-delivery.ts'))
    cpSync('scripts/lib', join(root, 'scripts', 'lib'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'staged', type: 'module' }))

    const agents = join(root, 'packages', 'agents', 'src')
    mkdirSync(agents, { recursive: true })
    writeFileSync(join(agents, 'index.ts'), `import '${failingImport}'\n`)

    for (const name of workspacePackages) {
      const dir = join(root, 'packages', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: `@theokit/${name}`, main: './dist/index.js' }),
      )
    }
    return join(root, 'scripts', 'probe-otlp-delivery.ts')
  }

  /** The staged copy, run through this repository's own tsx so no download can be involved. */
  async function runStaged(script: string, args: string[] = []) {
    try {
      const { stdout, stderr } = await run('node_modules/.bin/tsx', [script, ...args], {
        cwd: process.cwd(),
        timeout: 120_000,
      })
      return { code: 0, stdout, stderr }
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string }
      return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
    }
  }

  /** The uninstalled case, in crash one's shape: a bare specifier nothing provides. */
  const uninstalled = () => stagedProbe('@theokit/sdk')
  /** The unbuilt case, in crash two's shape: a path into a workspace sibling's build output. */
  const unbuilt = () => stagedProbe('../../presenter/dist/index.js', 'presenter')

  it('Given a dependency that is not installed, Then exit 2 prescribes pnpm install', async () => {
    const { code, stderr } = await runStaged(uninstalled())

    expect(code).toBe(2)
    expect(stderr).toContain('@theokit/sdk')
    expect(stderr).toContain('pnpm install')
    expect(stderr).toContain('NOT MEASURED')
    // The sentence an operator used to be given for this state, and the reason they went to the
    // collector. Exit 1 was the defect; a message about a refusal would be the same defect at exit 2.
    expect(stderr).not.toMatch(/refused|no span/i)
  }, 130_000)

  it('Given a workspace sibling that was never built, Then exit 2 prescribes pnpm build:packages', async () => {
    const { code, stderr } = await runStaged(unbuilt())

    expect(code).toBe(2)
    expect(stderr).toContain('@theokit/presenter')
    expect(stderr).toContain('pnpm build:packages')
    expect(stderr).toContain('NOT MEASURED')
  }, 130_000)

  /**
   * Which cause wins when two are true at once, pinned deterministically.
   *
   * `--ingest` here is not a URL, so the endpoint control has a cause of its own and contacts nothing.
   * The precondition must still be what is reported: whether the subject can be LOADED precedes
   * whether the instrument can be TRUSTED, and an operator on a clean checkout who is told about their
   * flag will fix the flag and meet the same wall. Move the loader below the control and this case
   * fails while the two above keep passing — they would only notice through whichever port happened
   * to be free.
   */
  it('Given a bad --ingest as well, Then the precondition still wins', async () => {
    const { code, stderr } = await runStaged(uninstalled(), ['--ingest', 'not-a-url'])

    expect(code).toBe(2)
    expect(stderr).toContain('pnpm install')
    // The control's own sentence for this flag, which must not be what the reader is handed here.
    expect(stderr).not.toContain('could not be read as a URL')
  }, 130_000)

  /**
   * The pass-through, which the two cases above cannot see.
   *
   * They prove a FAILED load is reported; neither proves a successful one still reaches the rest of
   * the probe. The imports were static until this item made them dynamic, and a loader that reported
   * gaps correctly while dropping a binding or short-circuiting the sequence would keep both cases
   * green. Here every module resolves — stubs, because the control runs before any of them is
   * called — and the probe must get past the loader to its own endpoint control and answer with the
   * control's cause, not a precondition.
   *
   * It is also the only case in this file that says anything about the happy path without a built
   * workspace, which is what `pnpm build:packages` costs on a loaded machine.
   */
  it('Given every module resolves, Then the probe proceeds to its endpoint control', async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'probe-contract-'))
    mkdirSync(join(root, 'scripts'), { recursive: true })
    cpSync('scripts/probe-otlp-delivery.ts', join(root, 'scripts', 'probe-otlp-delivery.ts'))
    cpSync('scripts/lib', join(root, 'scripts', 'lib'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'staged', type: 'module' }))
    for (const [rel, source] of [
      ['packages/agents/src/index.ts', 'export const AgentBuilder = {}\n'],
      [
        'packages/theo/src/server/agent/mount-agent.ts',
        'export const mountAgent = () => undefined\n',
      ],
      [
        'packages/theo/src/server/observability-bootstrap.ts',
        'export const createObservabilityPluginFromConfig = () => undefined\n' +
          'export const getObservabilityAdapter = () => undefined\n',
      ],
    ] as const) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), source)
    }

    // Port 1 on loopback: privileged, nothing binds it, so the control has a cause of its own.
    const { code, stderr } = await runStaged(join(root, 'scripts', 'probe-otlp-delivery.ts'), [
      '--ingest',
      'http://127.0.0.1:1/v1/traces',
    ])

    expect(code).toBe(2)
    expect(stderr).toMatch(/nothing answered/i)
    // The loader is transparent when nothing is missing: it must not speak for a gap there is none of.
    expect(stderr).not.toContain('pnpm install')
    expect(stderr).not.toContain('pnpm build:packages')
  }, 130_000)

  it('Given either gap, Then neither uses exit 1 and neither prescribes the other command', async () => {
    const [install, build] = await Promise.all([runStaged(uninstalled()), runStaged(unbuilt())])

    // The item's whole claim: exit 1 means a delivery was measured and failed, and neither of these
    // measured anything. Asserting `not.toBe(1)` pins the property rather than the number.
    expect(install.code).not.toBe(1)
    expect(build.code).not.toBe(1)
    // And the two are told apart, which one shared sentence naming both commands would not do.
    expect(install.stderr).not.toContain('pnpm build:packages')
    expect(build.stderr).not.toContain('pnpm install')
  }, 130_000)
})
