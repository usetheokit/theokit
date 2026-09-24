/**
 * What the OTLP probe is allowed to say when it cannot even LOAD the thing it measures.
 *
 * B-303 — `pnpm probe:otlp` from a clean checkout exited 1 twice over: first because `@theokit/sdk`
 * was not installed, then because `@theokit/presenter`'s `dist` had never been built. The probe's
 * header defines exit 1 as *"the run produced no span, the collector refused the payload, or the
 * transport never reached it"*, so an operator following the documented invocation on a fresh clone
 * was told a collector had refused a payload that was never built — and sent to the collector
 * instead of to `pnpm install`.
 *
 * The classification is the whole product here, which is why it is unit-tested rather than left to
 * the subprocess case in `probe-otlp-exit-contract.test.ts`. The two gaps are fixed by DIFFERENT
 * commands, and the probe's own header states the rule a single message would break: *"a shared exit
 * code is not a shared diagnosis, and naming the wrong one sends the reader to the wrong system"*.
 *
 * ONE CASE TAKES ITS ERROR FROM NODE rather than building one. Every other case here hands the
 * classifier an error object shaped the way the two measured crashes were shaped — and a fixture is
 * a claim about Node's behaviour, not a reading of it. If `ERR_MODULE_NOT_FOUND` stopped carrying
 * `url`, or stopped quoting the specifier, every hand-built case would stay green while the probe
 * misreported both crashes. `Given a real failed import` is the case that reads the instrument.
 */
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { classifyImportFailure } from '../../scripts/lib/probe-preconditions.js'

/** The error Node raises for a bare specifier it cannot resolve — no `url`, the name quoted. */
function packageNotFound(specifier: string): Error {
  const error = new Error(
    `Cannot find package '${specifier}' imported from /repo/packages/x/src/i.ts`,
  )
  return Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' })
}

/** The error Node raises for a file path it cannot resolve — `url` carried alongside the message. */
function fileNotFound(path: string): Error {
  const error = new Error(`Cannot find module '${path}' imported from /repo/packages/x/src/i.ts`)
  return Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND', url: `file://${path}` })
}

/**
 * A throwaway tree shaped like this monorepo: `packages/<name>` holding a manifest and no `dist`.
 *
 * Real directories rather than a mocked `fs`, because the question the classifier asks is a
 * filesystem question — is the package that failed to resolve one of THIS repository's workspace
 * packages — and it asks it through `realpath`, which a string fixture cannot answer.
 */
function workspace(...names: string[]): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'probe-precond-'))
  for (const name of names) {
    const dir = join(root, 'packages', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@theokit/${name}`, main: './dist/index.js' }),
    )
  }
  return root
}

describe('classifyImportFailure — which precondition was not met', () => {
  it('Given an uninstalled dependency, Then names it and prescribes pnpm install', () => {
    const gap = classifyImportFailure(packageNotFound('@theokit/sdk'), workspace('agents'))

    expect(gap?.kind).toBe('dependencies')
    expect(gap?.fix).toBe('pnpm install')
    expect(gap?.specifier).toBe('@theokit/sdk')
  })

  it('Given a workspace sibling whose dist was never built, Then prescribes pnpm build:packages', () => {
    const root = workspace('presenter')
    const missing = join(root, 'packages', 'presenter', 'dist', 'index.js')

    const gap = classifyImportFailure(fileNotFound(missing), root)

    expect(gap?.kind).toBe('workspace-build')
    expect(gap?.fix).toBe('pnpm build:packages')
    // The package, so the reader knows WHICH sibling, and the file, so they can see it is an output.
    expect(gap).toMatchObject({ pkg: '@theokit/presenter' })
    expect(gap?.specifier).toContain('dist')
  })

  /**
   * The shape the measured crash actually arrived in. pnpm links a workspace dependency into the
   * consumer's own `node_modules`, so the path Node reports is not under `packages/presenter/` at
   * all — it is `packages/agents/node_modules/@theokit/presenter/dist/index.js`. Reading the path as
   * text would classify this as an uninstalled dependency and send the operator to `pnpm install`,
   * which cannot build anything.
   */
  it('Given the sibling reached through a pnpm workspace link, Then it is still a build gap', () => {
    const root = workspace('agents', 'presenter')
    const links = join(root, 'packages', 'agents', 'node_modules', '@theokit')
    mkdirSync(links, { recursive: true })
    symlinkSync(join(root, 'packages', 'presenter'), join(links, 'presenter'), 'dir')

    const gap = classifyImportFailure(
      fileNotFound(join(links, 'presenter', 'dist', 'index.js')),
      root,
    )

    expect(gap?.kind).toBe('workspace-build')
    expect(gap).toMatchObject({ pkg: '@theokit/presenter' })
  })

  /**
   * A third-party package also ships a `dist/`, and a missing one there is a broken install rather
   * than an unbuilt sibling. Without this case, `path.includes('/dist/')` passes every test above
   * and tells an operator with a half-installed tree to run a build that will fail the same way.
   */
  it('Given a missing dist inside a third-party dependency, Then it is an install gap', () => {
    const root = workspace('agents')
    const dep = join(root, 'node_modules', 'some-dep')
    mkdirSync(dep, { recursive: true })
    writeFileSync(join(dep, 'package.json'), JSON.stringify({ name: 'some-dep' }))

    const gap = classifyImportFailure(fileNotFound(join(dep, 'dist', 'index.js')), root)

    expect(gap?.kind).toBe('dependencies')
    expect(gap?.fix).toBe('pnpm install')
  })

  /**
   * The negative case, and the one that matters most. A module that RESOLVED and then threw is a
   * defect in this repository, and reporting it as a missing precondition would tell the reader to
   * run `pnpm install` against a bug — the same wrong-system misdirection B-303 records, pointed the
   * other way. `null` means the probe rethrows and the operator gets the stack.
   */
  it('Given an error the module itself threw, Then no precondition is claimed', () => {
    expect(
      classifyImportFailure(new TypeError('x is not a function'), workspace('agents')),
    ).toBeNull()
  })

  it('Given a non-Error rejection, Then no precondition is claimed', () => {
    expect(classifyImportFailure('boom', workspace('agents'))).toBeNull()
  })

  it('Given a real failed import, Then Node ERR_MODULE_NOT_FOUND is recognised', async () => {
    const root = workspace('agents')
    let caught: unknown
    try {
      await import(join(root, 'packages', 'agents', 'dist', 'nothing-here.js'))
    } catch (error) {
      caught = error
    }

    // The instrument, read rather than assumed: whatever Node threw must classify, and must classify
    // as the build gap, because the path IS inside a workspace package of `root`.
    expect(caught).toBeDefined()
    expect(existsSync(join(root, 'packages', 'agents', 'dist'))).toBe(false)
    const gap = classifyImportFailure(caught, root)
    expect(gap).not.toBeNull()
    expect(gap?.kind).toBe('workspace-build')
  })
})
